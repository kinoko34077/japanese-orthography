import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildOrthographyHotArtifact, inflateHotArtifact, inflateOrVerifyHotArtifact, knowledgeDigest } from './orthography-hot-artifact.ts';
import { canonicalizeOrthographyKnowledge } from './orthography-knowledge-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE, resolveProjectionPolicy, withProfileRules } from './orthography-policy.ts';
import { projectOrthography } from './orthography-projection.ts';
import { restoreOrthography } from './orthography-restoration.ts';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';

// ARCH-V2 H (#172): real measurements of the v2 canonical graph and hot artifacts.
export const ORTHOGRAPHY_V2_MEASUREMENTS = 'data/reports/orthography-v2-measurements.json';

const size = (text: string) => ({ bytes: Buffer.byteLength(text), gzipBytes: gzipSync(text, { level: 9 }).length });

async function main(): Promise<void> {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const { graph: normalized } = await normalizeAcceptedOrthographySources(rootDir);
  const graph = withProfileRules(normalized);
  const canonical = canonicalizeOrthographyKnowledge(graph);
  const knowledgeText = JSON.stringify({ lexicalNamespaceId: canonical.lexicalNamespaceId, sources: canonical.sources, facts: canonical.facts, rules: canonical.rules, bindings: canonical.bindings });
  const hotArtifacts: Record<string, unknown> = {};
  let modernText = '';
  for (const [name, profile] of [['modern', MODERN_PROFILE], ['historical', HISTORICAL_PROFILE], ['kinotch', KINOTCH_PROFILE]] as const) {
    const artifact = buildOrthographyHotArtifact(graph, profile);
    const text = JSON.stringify(artifact);
    if (name === 'modern') modernText = text;
    hotArtifacts[name] = { ...size(text), contentDigest: artifact.canonicalGraphSha256, profileDigest: artifact.profileDigest, projectedFacts: (artifact.projected.fact as unknown[]).length };
  }

  // informational performance observations
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  let t = performance.now();
  const parsed = JSON.parse(modernText);
  inflateOrVerifyHotArtifact(parsed);
  const inflated = inflateHotArtifact(parsed);
  const startupMs = performance.now() - t;
  const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / 2 ** 20;
  const policy = resolveProjectionPolicy(MODERN_PROFILE, inflated.graph);
  const historical = inflated.graph.facts.filter((f) => f.periodRefs?.includes('period:historical-kana') && f.reading && f.surface).slice(0, 2000);
  t = performance.now();
  for (const f of historical) projectOrthography({ lexicalIdentity: null, surface: f.surface!, reading: f.reading!, morphology: null, factIds: [], retainedDistinctions: {} }, inflated.graph, policy);
  const projectMs = performance.now() - t;
  const queries = historical.slice(0, 200);
  t = performance.now();
  for (const f of queries) restoreOrthography({ observedSurface: f.surface!, observedReading: inflated.projectedReadings[f.id]?.reading ?? null, lexicalCandidates: f.lexicalRefs, targetPolicy: policy }, inflated.graph);
  const restoreMs = performance.now() - t;

  const report = {
    schemaVersion: '1',
    kind: 'orthography-v2-measurements',
    owner: 'japanese-orthography#172',
    note: 'Sizes/digests are deterministic real compiled data; performance values are informational observations (machine-dependent). The v2 canonical graph holds all normalized sources (JMdict forms/readings, Phase-4.6 literal facts, shared rules, bindings) and is a different content set from the Phase-4.8 lexical entity graph.',
    canonicalGraph: { sha256: knowledgeDigest(graph), ...size(knowledgeText), ledgerDispositions: canonical.dispositions.length },
    counts: { facts: canonical.facts.length, rules: canonical.rules.length, bindings: canonical.bindings.length, sources: canonical.sources.length },
    hotArtifacts,
    baseline: { phase48: { canonicalLexicalGraphBytes: 115706438, compactLexicalGraphBytes: 40398937, hotRuntimeBytes: 21810629, sinoDagHotTablesBytes: 66990 } },
    performanceObserved: {
      node: process.version,
      hotStartupMs: Math.round(startupMs),
      hotHeapDeltaMb: Math.round(heapDeltaMb),
      projectionsPerSecond: Math.round(historical.length / (projectMs / 1000)),
      restorationsPerSecond: Math.round(queries.length / (restoreMs / 1000))
    }
  };
  await writeFile(resolve(rootDir, ORTHOGRAPHY_V2_MEASUREMENTS), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1]?.endsWith('measure-orthography-v2.ts')) await main();
