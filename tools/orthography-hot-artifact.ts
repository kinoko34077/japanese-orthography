import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { canonicalizeOrthographyKnowledge, type OrthographyKnowledgeGraph } from './orthography-knowledge-model.ts';
import { resolveProjectionPolicy, type OrthographyProfilePolicy } from './orthography-policy.ts';
import { compileRuleOrder, projectOrthography, type ProjectionPolicy } from './orthography-projection.ts';

// ARCH-V2 H (#172): compile the canonical v2 knowledge graph into a deterministic, source-locked hot
// artifact (interned columnar tables + provenance table + profile-specific rule order + optional
// pre-expanded projections). The artifact is derived, never a second authority: its digest is
// re-checked against its own inflated content, and pre-expansion equals on-demand projection.

const hot = createRequire(import.meta.url)('../runtime/orthography-hot-runtime.js') as {
  verifyHotArtifact(artifact: unknown): void;
  inflateHotArtifact(artifact: unknown): InflatedHotArtifact;
  SCHEMA: Record<string, string>;
  ENUMS: Record<string, string[]>;
};

export interface OrthographyHotArtifact {
  schemaVersion: '2';
  kind: 'japanese-orthography-hot-runtime';
  canonicalGraphSha256: string;
  sourceSetDigest: string;
  profileDigest: string;
  profileId: string;
  lexicalNamespaceId: string;
  schema: Record<string, string>;
  enums: Record<string, string[]>;
  strings: string[];
  sources: Record<string, unknown>[];
  facts: Record<string, unknown[]>;
  rules: Record<string, unknown[]>;
  bindings: Record<string, unknown[]>;
  provenance: Record<string, unknown[]>;
  projected: Record<string, unknown[]>;
  order: Record<string, unknown[]>;
  /** resolved ProjectionPolicy (JSON); `provenance` is the #172 provenanceRefs table and
   *  `projected` / `order` are the pre-expanded indexes */
  policy: string;
}

export interface InflatedHotArtifact {
  graph: OrthographyKnowledgeGraph;
  ruleOrder: string[];
  policy: ProjectionPolicy;
  projectedReadings: Record<string, { surface: string; reading: string | null }>;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as object).sort(cmp).map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  return value;
};

/** Digest of the knowledge content the hot artifact carries (the migration ledger stays cold). */
export function knowledgeDigest(graph: OrthographyKnowledgeGraph): string {
  const c = canonicalizeOrthographyKnowledge({ ...graph, dispositions: [] });
  return sha(JSON.stringify({ lexicalNamespaceId: c.lexicalNamespaceId, sources: c.sources, facts: c.facts, rules: c.rules, bindings: c.bindings }));
}

export function buildOrthographyHotArtifact(input: OrthographyKnowledgeGraph, profile: OrthographyProfilePolicy): OrthographyHotArtifact {
  const graph = canonicalizeOrthographyKnowledge(input);
  const policy = resolveProjectionPolicy(profile, graph);
  const strings: string[] = [];
  const index = new Map<string, number>();
  const s = (value: string) => {
    let at = index.get(value);
    if (at === undefined) { at = strings.length; strings.push(value); index.set(value, at); }
    return at;
  };
  const opt = (value: string | undefined) => (value === undefined ? -1 : s(value));
  const list = (values: readonly string[]) => values.map(s);
  const optList = (values: readonly string[] | undefined) => (values === undefined ? -1 : list(values));
  const en = (name: string, value: string | undefined) => {
    if (value === undefined) return -1;
    const at = hot.ENUMS[name]!.indexOf(value);
    if (at < 0) throw new Error(`unknown ${name} ${value}`);
    return at;
  };
  const provenanceRows = new Map<string, number>();
  const provenance = { sourceRefs: [] as number[][], evidenceRefs: [] as number[][] };
  const prov = (item: { sourceRefs: string[]; evidenceRefs: string[] }) => {
    const key = JSON.stringify([item.sourceRefs, item.evidenceRefs]);
    let at = provenanceRows.get(key);
    if (at === undefined) {
      at = provenance.sourceRefs.length;
      provenance.sourceRefs.push(list(item.sourceRefs));
      provenance.evidenceRefs.push(list(item.evidenceRefs));
      provenanceRows.set(key, at);
    }
    return at;
  };
  const column = <T>(items: readonly T[], pick: (item: T) => unknown) => items.map(pick);

  const derivedId = (f: OrthographyKnowledgeGraph['facts'][number]) => `fact:${f.kind}:${f.surface ?? ''}|${f.reading ?? ''}|${f.target ?? ''}`;
  const facts = {
    id: column(graph.facts, (f) => (f.id === derivedId(f) ? -1 : s(f.id))),
    kind: column(graph.facts, (f) => en('factKind', f.kind)),
    surface: column(graph.facts, (f) => opt(f.surface)),
    reading: column(graph.facts, (f) => opt(f.reading)),
    basisReading: column(graph.facts, (f) => opt(f.basisReading)),
    target: column(graph.facts, (f) => opt(f.target)),
    lexicalRefs: column(graph.facts, (f) => list(f.lexicalRefs)),
    tags: column(graph.facts, (f) => optList(f.tags)),
    periodRefs: column(graph.facts, (f) => optList(f.periodRefs)),
    origin: column(graph.facts, (f) => en('origin', f.origin)),
    derivedFrom: column(graph.facts, (f) => optList(f.derivedFrom)),
    derivationMechanism: column(graph.facts, (f) => en('derivationMechanism', f.derivationMechanism)),
    provenance: column(graph.facts, prov)
  };
  const ruleIndex = new Map(graph.rules.map((r, i) => [r.id, i]));
  const rules = {
    id: column(graph.rules, (r) => s(r.id)),
    class: column(graph.rules, (r) => en('ruleClass', r.class)),
    directionality: column(graph.rules, (r) => en('directionality', r.directionality)),
    lossiness: column(graph.rules, (r) => en('lossiness', r.lossiness)),
    from: column(graph.rules, (r) => list(r.from)),
    to: column(graph.rules, (r) => list(r.to)),
    dependencies: column(graph.rules, (r) => list(r.dependencies)),
    predicate: column(graph.rules, (r) => (r.predicate === undefined ? -1 : s(JSON.stringify(sortKeys(r.predicate))))),
    origin: column(graph.rules, (r) => en('origin', r.origin)),
    derivedFrom: column(graph.rules, (r) => optList(r.derivedFrom)),
    derivationMechanism: column(graph.rules, (r) => en('derivationMechanism', r.derivationMechanism)),
    provenance: column(graph.rules, prov)
  };
  const bindings = {
    id: column(graph.bindings, (b) => s(b.id)),
    ruleId: column(graph.bindings, (b) => ruleIndex.get(b.ruleId)!),
    lexicalRefs: column(graph.bindings, (b) => list(b.lexicalRefs)),
    contextRefs: column(graph.bindings, (b) => optList(b.contextRefs)),
    provenance: column(graph.bindings, prov)
  };

  // optional pre-expansion: forward projection of every historical reading fact under the profile
  const projected = { fact: [] as number[], surface: [] as number[], reading: [] as number[] };
  graph.facts.forEach((fact, i) => {
    if (!fact.periodRefs?.includes('period:historical-kana') || fact.reading === undefined || fact.surface === undefined) return;
    const result = projectOrthography({ lexicalIdentity: null, surface: fact.surface, reading: fact.reading, morphology: null, factIds: [], retainedDistinctions: {} }, graph, policy).state;
    projected.fact.push(i);
    projected.surface.push(s(result.surface));
    projected.reading.push(opt(result.reading ?? undefined));
  });

  return {
    schemaVersion: '2',
    kind: 'japanese-orthography-hot-runtime',
    canonicalGraphSha256: knowledgeDigest(graph),
    sourceSetDigest: sha(JSON.stringify(graph.sources)),
    profileDigest: sha(JSON.stringify(sortKeys(profile))),
    profileId: profile.profileId,
    lexicalNamespaceId: graph.lexicalNamespaceId,
    schema: { ...hot.SCHEMA },
    enums: structuredClone(hot.ENUMS),
    strings,
    sources: graph.sources.map((source) => ({ ...source })),
    facts,
    rules,
    bindings,
    provenance,
    projected,
    order: { rule: compileRuleOrder(graph, policy).map((id) => ruleIndex.get(id)!) },
    policy: JSON.stringify(sortKeys(policy))
  };
}

export function inflateHotArtifact(artifact: OrthographyHotArtifact): InflatedHotArtifact {
  return hot.inflateHotArtifact(artifact);
}

/** Structural verification plus the source lock: the inflated content must hash to the declared digest. */
export function inflateOrVerifyHotArtifact(artifact: OrthographyHotArtifact): void {
  const inflated = hot.inflateHotArtifact(artifact);
  if (knowledgeDigest(inflated.graph) !== artifact.canonicalGraphSha256) throw new Error('canonical graph digest mismatch');
  if (sha(JSON.stringify(inflated.graph.sources)) !== artifact.sourceSetDigest) throw new Error('source set digest mismatch');
}

/** Map a hot table row back to its canonical source/evidence ids (diagnostics). */
export function provenanceOf(artifact: OrthographyHotArtifact, kind: 'fact' | 'rule' | 'binding', row: number): { sourceRefs: string[]; evidenceRefs: string[] } {
  const table = (kind === 'fact' ? artifact.facts : kind === 'rule' ? artifact.rules : artifact.bindings) as Record<string, number[]>;
  const at = table.provenance![row];
  if (at === undefined) throw new RangeError(`${kind} row ${row} out of range`);
  const p = artifact.provenance as Record<string, number[][]>;
  return { sourceRefs: p.sourceRefs![at]!.map((i) => artifact.strings[i]!), evidenceRefs: p.evidenceRefs![at]!.map((i) => artifact.strings[i]!) };
}
