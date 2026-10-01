import { createHash } from 'node:crypto';
import {
  BROWSER_PACK_COMPILER_VERSION,
  BROWSER_PACK_EXTERNAL_OFFSET_UNIT,
  BROWSER_PACK_MANIFEST_KIND,
  BROWSER_PACK_SCHEMA_VERSION,
  BROWSER_PACK_SECTION_KINDS,
  browserPackSectionId,
  sealBrowserPackManifest,
  type BrowserPackManifestV1,
  type BrowserPackProfileDescriptor,
  type BrowserPackSectionDescriptor,
  type BrowserPackSectionKind,
  type BrowserPackShardDescriptor
} from './browser-pack-model.ts';
import { encodeSection, StringTable } from './browser-pack-encoding.ts';
import { knowledgeDigest } from './orthography-hot-artifact.ts';
import { canonicalizeOrthographyKnowledge, FACT_KINDS, KNOWLEDGE_ORIGINS, RULE_CLASSES, RULE_DIRECTIONALITIES, RULE_LOSSINESS, type OrthographyFact, type OrthographyKnowledgeGraph } from './orthography-knowledge-model.ts';
import { resolveProjectionPolicy, type OrthographyProfilePolicy } from './orthography-policy.ts';

// BrowserPack B (#185 B): compile accepted v2 knowledge into the profile-neutral, source-locked,
// sectioned binary pack fixed by unit A. Knowledge is partitioned by lookup key into shards whose
// facts, lexical index, provenance index and lazy detail payload share one partition and one
// shard-local string pool (A finding #3: no cross-shard string fan-out). Rules, bindings and the
// shard directory are small and eager; each profile contributes only a policy descriptor.

export const BROWSER_PACK_SHARD_KEY = 'surface';
export const DEFAULT_SHARD_BUDGET_BYTES = 256 * 1024;

/** Fact flag bits carried in the knowledge rows (details stay in lazy detail shards). */
export const FACT_FLAGS = { historical: 1, modern: 2, candidate: 4, contextual: 8, safety: 16, ateji: 32 } as const;
/** role of a fact row inside its shard: listed under its own surface, or under a relation target. */
export const FACT_ROLES = { surface: 0, target: 1 } as const;

export interface BrowserPackBuild {
  manifest: BrowserPackManifestV1;
  files: Map<string, Uint8Array>;
}

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as object).sort(cmp).map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]));
  return value;
};
const enumIndex = (values: readonly string[], value: string | undefined, fallback = 0) => (value === undefined ? fallback : Math.max(0, values.indexOf(value)));

function factFlags(fact: OrthographyFact): number {
  let flags = 0;
  if (fact.periodRefs?.includes('period:historical-kana')) flags |= FACT_FLAGS.historical;
  if (fact.periodRefs?.includes('period:modern')) flags |= FACT_FLAGS.modern;
  for (const tag of fact.tags ?? []) {
    if (tag === 'candidate') flags |= FACT_FLAGS.candidate;
    // contextual only when a context constraint is attached; a pack tag alone is not a constraint
    if (tag.startsWith('context:')) flags |= FACT_FLAGS.contextual;
    if (tag.startsWith('safety:')) flags |= FACT_FLAGS.safety;
    if (tag === 'ateji') flags |= FACT_FLAGS.ateji;
  }
  return flags;
}

interface Entry { key: string; factIndex: number; role: number }

function partition(entries: readonly Entry[], facts: readonly OrthographyFact[], budget: number): Entry[][] {
  const shards: Entry[][] = [];
  let current: Entry[] = [];
  let bytes = 0;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;
    const fact = facts[entry.factIndex]!;
    // never split one key across shards: a lookup key must map to exactly one shard
    const keyStarts = i === 0 || entries[i - 1]!.key !== entry.key;
    if (keyStarts && bytes >= budget && current.length) { shards.push(current); current = []; bytes = 0; }
    current.push(entry);
    bytes += 48 + (fact.surface?.length ?? 0) * 3 + (fact.reading?.length ?? 0) * 3 + (fact.target?.length ?? 0) * 3
      + JSON.stringify([fact.lexicalRefs, fact.sourceRefs, fact.evidenceRefs, fact.tags ?? []]).length;
  }
  if (current.length) shards.push(current);
  return shards;
}

export interface CompileOptions { shardBudgetBytes?: number; terminology?: unknown }

export function compileBrowserPack(input: OrthographyKnowledgeGraph, profiles: readonly OrthographyProfilePolicy[], options: CompileOptions = {}): BrowserPackBuild {
  const graph = canonicalizeOrthographyKnowledge(input);
  const files = new Map<string, Uint8Array>();
  const sections: BrowserPackSectionDescriptor[] = [];
  const add = (kind: BrowserPackSectionKind, body: Uint8Array, extra: { shard?: BrowserPackShardDescriptor; profileId?: string; rowCount?: number; requires?: string[] } = {}) => {
    const sectionId = browserPackSectionId(kind, { shard: extra.shard, profileId: extra.profileId });
    const spec = BROWSER_PACK_SECTION_KINDS[kind];
    const path = `${sectionId.replace(/[@/]/g, '-')}.${spec.encoding === 'json' ? 'json' : 'bin'}`;
    files.set(path, body);
    sections.push({
      sectionId, kind, path, encoding: spec.encoding, loading: spec.loading, byteLength: body.byteLength, sha256: sha(body),
      ...(extra.rowCount !== undefined ? { rowCount: extra.rowCount } : {}),
      ...(extra.shard ? { shard: extra.shard } : {}),
      ...(extra.profileId ? { profileId: extra.profileId } : {}),
      ...(extra.requires?.length ? { requires: extra.requires } : {})
    });
    return sectionId;
  };
  const json = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(sortKeys(value))}\n`);

  // ---- knowledge shards (on-demand) + aligned detail shards (lazy) ----------------------------
  const entries: Entry[] = [];
  graph.facts.forEach((fact, factIndex) => {
    const key = fact.surface ?? fact.reading;
    if (key !== undefined) entries.push({ key, factIndex, role: FACT_ROLES.surface });
    if (fact.kind === 'form_relation' && fact.target !== undefined && fact.target !== key) entries.push({ key: fact.target, factIndex, role: FACT_ROLES.target });
  });
  entries.sort((a, b) => cmp(a.key, b.key) || a.factIndex - b.factIndex || a.role - b.role);
  const shards = partition(entries, graph.facts, options.shardBudgetBytes ?? DEFAULT_SHARD_BUDGET_BYTES);
  const directory = { index: [] as number[], from: [] as string[], to: [] as string[], rows: [] as number[], keys: [] as number[], maxKeyLength: [] as number[] };

  shards.forEach((shardEntries, index) => {
    const shard: BrowserPackShardDescriptor = { key: BROWSER_PACK_SHARD_KEY, index, count: shards.length, from: shardEntries[0]!.key, to: shardEntries[shardEntries.length - 1]!.key };
    const pool = new StringTable();
    const kind: number[] = [], surface: number[] = [], reading: number[] = [], target: number[] = [], flags: number[] = [], origin: number[] = [], role: number[] = [], factIndex: number[] = [];
    const detail = new StringTable();
    const factId: number[] = [], lexicalRefs: number[][] = [], tags: number[][] = [], sourceRefs: number[][] = [], evidenceRefs: number[][] = [];
    const postings = new Map<string, number[]>();
    shardEntries.forEach((entry, row) => {
      const fact = graph.facts[entry.factIndex]!;
      kind.push(enumIndex(FACT_KINDS, fact.kind));
      surface.push(pool.id(fact.surface));
      reading.push(pool.id(fact.reading));
      target.push(pool.id(fact.target));
      flags.push(factFlags(fact));
      origin.push(enumIndex(KNOWLEDGE_ORIGINS, fact.origin));
      role.push(entry.role);
      factIndex.push(entry.factIndex);
      factId.push(detail.id(fact.id));
      lexicalRefs.push(fact.lexicalRefs.map((r) => detail.id(r)));
      tags.push((fact.tags ?? []).map((t) => detail.id(t)));
      sourceRefs.push(fact.sourceRefs.map((r) => detail.id(r)));
      evidenceRefs.push(fact.evidenceRefs.map((r) => detail.id(r)));
      postings.set(entry.key, [...(postings.get(entry.key) ?? []), row]);
    });
    const keys = [...postings.keys()].sort(cmp);
    const keyIds = keys.map((k) => pool.id(k));
    const poolId = add('string-pool', encodeSection([{ name: 'strings', kind: 'strings', values: pool.values }]), { shard, rowCount: pool.values.length });
    const factsId = add('facts', encodeSection([
      { name: 'kind', kind: 'scalar', values: kind }, { name: 'surface', kind: 'scalar', values: surface }, { name: 'reading', kind: 'scalar', values: reading },
      { name: 'target', kind: 'scalar', values: target }, { name: 'flags', kind: 'scalar', values: flags }, { name: 'origin', kind: 'scalar', values: origin },
      { name: 'role', kind: 'scalar', values: role }, { name: 'factIndex', kind: 'scalar', values: factIndex }
    ]), { shard, rowCount: shardEntries.length, requires: [poolId] });
    add('lexical-index', encodeSection([
      { name: 'key', kind: 'scalar', values: keyIds },
      { name: 'rows', kind: 'list', values: keys.map((k) => postings.get(k)!) }
    ]), { shard, rowCount: keys.length, requires: [factsId] });
    add('provenance-index', encodeSection([
      { name: 'factIndex', kind: 'scalar', values: factIndex },
      { name: 'detailRow', kind: 'scalar', values: shardEntries.map((_, row) => row) }
    ]), { shard, rowCount: shardEntries.length, requires: [factsId] });
    add('detail-shard', encodeSection([
      { name: 'strings', kind: 'strings', values: detail.values }, { name: 'factId', kind: 'scalar', values: factId },
      { name: 'lexicalRefs', kind: 'list', values: lexicalRefs }, { name: 'tags', kind: 'list', values: tags },
      { name: 'sourceRefs', kind: 'list', values: sourceRefs }, { name: 'evidenceRefs', kind: 'list', values: evidenceRefs }
    ]), { shard, rowCount: shardEntries.length, requires: [factsId] });
    directory.index.push(index);
    directory.from.push(shard.from);
    directory.to.push(shard.to);
    directory.rows.push(shardEntries.length);
    directory.keys.push(keys.length);
    // the lexical scan window is derived from the indexed keys, never a fixed cap (#154 H4)
    directory.maxKeyLength.push(Math.max(...keys.map((k) => k.length)));
  });

  // ---- eager tables ------------------------------------------------------------------------------
  {
    const s = new StringTable();
    const from = directory.from.map((v) => s.id(v));
    const to = directory.to.map((v) => s.id(v));
    add('shard-directory', encodeSection([
      { name: 'strings', kind: 'strings', values: s.values }, { name: 'shardKey', kind: 'scalar', values: directory.index.map(() => s.id(BROWSER_PACK_SHARD_KEY)) },
      { name: 'index', kind: 'scalar', values: directory.index }, { name: 'from', kind: 'scalar', values: from }, { name: 'to', kind: 'scalar', values: to },
      { name: 'rows', kind: 'scalar', values: directory.rows }, { name: 'keys', kind: 'scalar', values: directory.keys },
      { name: 'maxKeyLength', kind: 'scalar', values: directory.maxKeyLength }
    ]), { rowCount: directory.index.length });
  }
  const ruleRow = new Map(graph.rules.map((r, i) => [r.id, i]));
  {
    const s = new StringTable();
    add('rules', encodeSection([
      { name: 'id', kind: 'scalar', values: graph.rules.map((r) => s.id(r.id)) },
      { name: 'class', kind: 'scalar', values: graph.rules.map((r) => enumIndex(RULE_CLASSES, r.class)) },
      { name: 'directionality', kind: 'scalar', values: graph.rules.map((r) => enumIndex(RULE_DIRECTIONALITIES, r.directionality)) },
      { name: 'lossiness', kind: 'scalar', values: graph.rules.map((r) => enumIndex(RULE_LOSSINESS, r.lossiness)) },
      { name: 'from', kind: 'list', values: graph.rules.map((r) => r.from.map((v) => s.id(v))) },
      { name: 'to', kind: 'list', values: graph.rules.map((r) => r.to.map((v) => s.id(v))) },
      { name: 'dependencies', kind: 'list', values: graph.rules.map((r) => r.dependencies.map((v) => s.id(v))) },
      { name: 'predicate', kind: 'scalar', values: graph.rules.map((r) => (r.predicate === undefined ? 0 : s.id(JSON.stringify(sortKeys(r.predicate))))) },
      { name: 'origin', kind: 'scalar', values: graph.rules.map((r) => enumIndex(KNOWLEDGE_ORIGINS, r.origin)) },
      { name: 'sourceRefs', kind: 'list', values: graph.rules.map((r) => r.sourceRefs.map((v) => s.id(v))) },
      { name: 'evidenceRefs', kind: 'list', values: graph.rules.map((r) => r.evidenceRefs.map((v) => s.id(v))) },
      { name: 'strings', kind: 'strings', values: s.values }
    ]), { rowCount: graph.rules.length });
  }
  {
    const s = new StringTable();
    add('bindings', encodeSection([
      { name: 'id', kind: 'scalar', values: graph.bindings.map((b) => s.id(b.id)) },
      { name: 'rule', kind: 'scalar', values: graph.bindings.map((b) => ruleRow.get(b.ruleId)!) },
      { name: 'lexicalRefs', kind: 'list', values: graph.bindings.map((b) => b.lexicalRefs.map((v) => s.id(v))) },
      { name: 'contextRefs', kind: 'list', values: graph.bindings.map((b) => (b.contextRefs ?? []).map((v) => s.id(v))) },
      { name: 'sourceRefs', kind: 'list', values: graph.bindings.map((b) => b.sourceRefs.map((v) => s.id(v))) },
      { name: 'evidenceRefs', kind: 'list', values: graph.bindings.map((b) => b.evidenceRefs.map((v) => s.id(v))) },
      { name: 'strings', kind: 'strings', values: s.values }
    ]), { rowCount: graph.bindings.length, requires: ['rules'] });
  }
  add('terminology', json(options.terminology ?? { schemaVersion: '1', kind: 'browser-pack-terminology', terms: {} }));

  // ---- profiles: policy descriptors only ----------------------------------------------------------
  const descriptors: BrowserPackProfileDescriptor[] = profiles.map((profile) => {
    const policySectionId = add('profile-policy', json({ profile, policy: resolveProjectionPolicy(profile, graph) }), { profileId: profile.profileId });
    return { profileId: profile.profileId, profileDigest: sha(JSON.stringify(sortKeys(profile))), policySectionId };
  });

  const manifest = sealBrowserPackManifest({
    schemaVersion: BROWSER_PACK_SCHEMA_VERSION,
    kind: BROWSER_PACK_MANIFEST_KIND,
    compilerVersion: BROWSER_PACK_COMPILER_VERSION,
    canonicalGraphSha256: knowledgeDigest(graph),
    sourceSetDigest: sha(JSON.stringify(graph.sources)),
    lexicalNamespaceId: graph.lexicalNamespaceId,
    profiles: descriptors,
    sections,
    runtimeContract: { schemaVersion: BROWSER_PACK_SCHEMA_VERSION, externalOffsetUnit: BROWSER_PACK_EXTERNAL_OFFSET_UNIT }
  });
  return { manifest, files };
}
