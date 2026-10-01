import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildOrthographyHotArtifact, type OrthographyHotArtifact } from './orthography-hot-artifact.ts';
import { canonicalizeOrthographyKnowledge, type OrthographyKnowledgeGraph } from './orthography-knowledge-model.ts';
import { MODERN_PROFILE, withProfileRules } from './orthography-policy.ts';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';
import { normalizeCheckoutText } from './verification-text.ts';

// ARCH-V2 I (#173): the v2 knowledge carried by a resolver bundle. The full v2 graph is normalized
// from every accepted source; the bundle carries the slice that can apply to the bundle's lexical
// surfaces (their facts, the characters' bindings and rules, and all convention rules), compiled
// into a source-locked hot artifact, plus a JMdict lexeme bridge from (surface, modern reading).

export const ORTHOGRAPHY_V2_BUNDLE_SECTION = 'data/runtime/orthography-v2-bundle-section.json';

export interface OrthographyV2BundleSection {
  schemaVersion: '1';
  kind: 'orthography-v2-bundle-section';
  scope: { surfaces: string[] };
  /** "surface\u0000modern reading" -> JMdict lexeme ids */
  lexemeBridge: Record<string, string[]>;
  hot: OrthographyHotArtifact;
}

export function scopeKnowledgeGraph(graph: OrthographyKnowledgeGraph, surfaces: readonly string[]): OrthographyKnowledgeGraph {
  const surfaceSet = new Set(surfaces);
  const symbols = new Set(surfaces.flatMap((s) => Array.from(s)));
  const keys = new Set([...surfaceSet, ...symbols]);
  const facts = graph.facts.filter((f) => (f.surface !== undefined && keys.has(f.surface)) || (f.target !== undefined && keys.has(f.target)));
  const bindings = graph.bindings.filter((b) => b.lexicalRefs.some((ref) => ref.startsWith('symbol:') && symbols.has(ref.slice('symbol:'.length))));
  const boundRuleIds = new Set(bindings.map((b) => b.ruleId));
  const everBound = new Set(graph.bindings.map((b) => b.ruleId));
  // unbound rules (conventions, character mappings, profile rules) apply by predicate; bound rules only via kept bindings
  const rules = graph.rules.filter((r) => boundRuleIds.has(r.id) || !everBound.has(r.id));
  const ruleIds = new Set(rules.map((r) => r.id));
  const usedSources = new Set([...facts, ...rules, ...bindings].flatMap((item) => item.sourceRefs));
  return canonicalizeOrthographyKnowledge({
    ...graph,
    sources: graph.sources.filter((s) => usedSources.has(String(s.sourceId))),
    facts,
    rules: rules.map((r) => ({ ...r, dependencies: r.dependencies.filter((d) => ruleIds.has(d)) })),
    bindings,
    dispositions: []
  });
}

export function buildOrthographyV2BundleSection(graph: OrthographyKnowledgeGraph, surfaces: readonly string[]): OrthographyV2BundleSection {
  const scoped = scopeKnowledgeGraph(withProfileRules(graph), surfaces);
  const lexemeBridge: Record<string, string[]> = {};
  for (const fact of scoped.facts) {
    if (fact.kind !== 'literal_reading' || !fact.periodRefs?.includes('period:modern') || fact.surface === undefined || fact.reading === undefined) continue;
    if (!surfaces.includes(fact.surface)) continue;
    const key = `${fact.surface}\u0000${fact.reading}`;
    lexemeBridge[key] = [...new Set([...(lexemeBridge[key] ?? []), ...fact.lexicalRefs])].sort();
  }
  return {
    schemaVersion: '1',
    kind: 'orthography-v2-bundle-section',
    scope: { surfaces: [...new Set(surfaces)].sort() },
    lexemeBridge: Object.fromEntries(Object.entries(lexemeBridge).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    hot: buildOrthographyHotArtifact(scoped, MODERN_PROFILE)
  };
}

export async function generateOrthographyV2BundleSection(rootDir: string): Promise<string> {
  const lexicalSource = JSON.parse(await readFile(resolve(rootDir, 'data/lexical/sources/unidic-cwj-202512-first-slice.json'), 'utf8'));
  const { graph } = await normalizeAcceptedOrthographySources(rootDir);
  const section = buildOrthographyV2BundleSection(graph, (lexicalSource.records as { surface: string }[]).map((r) => r.surface));
  return `${JSON.stringify(section)}\n`;
}

if (process.argv[1]?.endsWith('orthography-v2-bundle.ts')) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const text = await generateOrthographyV2BundleSection(rootDir);
  const path = resolve(rootDir, ORTHOGRAPHY_V2_BUNDLE_SECTION);
  if (process.argv.includes('--check')) {
    if (normalizeCheckoutText(await readFile(path, 'utf8')) !== text) throw new Error(`stale ${ORTHOGRAPHY_V2_BUNDLE_SECTION}; run npm run generate:orthography-v2-bundle`);
    console.log('orthography-v2 bundle section OK');
  } else {
    await writeFile(path, text);
    console.log(`wrote ${ORTHOGRAPHY_V2_BUNDLE_SECTION} (${text.length} chars)`);
  }
}
