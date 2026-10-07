import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { compileBrowserPack, type BrowserPackBuild } from './browser-pack-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION, serializeBrowserPackManifest, validateBrowserPackManifest, verifyBrowserPackSections } from './browser-pack-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE, withProfileRules } from './orthography-policy.ts';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';
import { jmdictLexemeMorphology, lexicalLayer, mergeMorphology, unidicLexemeMorphology } from './browser-pack-lexical-compiler.ts';
import { loadJmdictIntake } from './jmdict-intake.ts';
import type { UniDicSourceSlice } from './lexical-compiler.ts';
import { BROWSER_RESOLVER_PARITY_REPORT, browserCoreParity } from './browser-resolver-parity.ts';
import { assertV3Equivalent, transcodeToV3 } from './browser-pack-v3.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from './symbol-registry.ts';
import { CAPABILITY_PROBES } from './measure-browser-capability-utilization.ts';
import { compileRuleIR } from './rule-ir.ts';
import { canonicalizeOrthographyKnowledge } from './orthography-knowledge-model.ts';
import { normalizeCheckoutText } from './verification-text.ts';
import { SINO_READING_CLASS_FLAGS, type SinoComponentIndexRow } from './sino-component-index.ts';

// BrowserPack B (#185 B): build the pack from the accepted v2 knowledge.
//   npm run generate:browser-pack            -> data/browser-pack/ (manifest committed, bodies ignored)
//   npm run validate:browser-pack            -> recompiles and requires the committed manifest lock
export const BROWSER_PACK_DIR = 'data/browser-pack';
export const BROWSER_PACK_MANIFEST = `${BROWSER_PACK_DIR}/manifest.json`;
export const BROWSER_PACK_COMPILED_REPORT = 'data/reports/browser-pack-v1-compiled.json';

export const BROWSER_PACK_V2_DIR = 'data/browser-pack-v2';
export const BROWSER_PACK_V2_MANIFEST = `${BROWSER_PACK_V2_DIR}/manifest.json`;
export const BROWSER_PACK_V2_COMPILED_REPORT = 'data/reports/browser-pack-v2-compiled.json';
export const BROWSER_PACK_V3_DIR = 'data/browser-pack-v3';
export const BROWSER_RESOLVER_PARITY_REPORT_V3 = 'data/reports/browser-resolver-parity-v3.json';
export const BROWSER_PACK_V3_MANIFEST = `${BROWSER_PACK_V3_DIR}/manifest.json`;
export const BROWSER_PACK_V3_COMPILED_REPORT = 'data/reports/browser-pack-v3-compiled.json';

/** BrowserPack v3 (#211 F): the v2 build transcoded to symbol-encoded hot strings. */
export async function buildAcceptedBrowserPackV3(rootDir: string, graph?: AcceptedGraph): Promise<BrowserPackBuild> {
  const registry = JSON.parse(await readFile(resolve(rootDir, SYMBOL_REGISTRY), 'utf8')) as SymbolRegistry;
  const g = graph ?? (await normalizeAcceptedOrthographySources(rootDir)).graph;
  const fullGraph = withProfileRules(g);
  return transcodeToV3(await buildAcceptedBrowserPackV2(rootDir, g), registry, { evidence: { graph: canonicalizeOrthographyKnowledge(fullGraph), ir: compileRuleIR(fullGraph) } });
}
const PROFILES = [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE];

type AcceptedGraph = Awaited<ReturnType<typeof normalizeAcceptedOrthographySources>>['graph'];

const SINO_CLASS_SOURCE = 'phase46e-sino-reading-class';
const SINO_TABLE_SOURCE = 'phase46e-sino-table';
const SINO_CATCH_ALL = 'phase46e-sino-table:row:179:catch-all';

type SinoArtifactRelation = {
  character?: string;
  modernReading?: string;
  context?: string | null;
  historicalReadings?: string[];
  readingClasses?: string[];
  sourceRefs?: string[];
  evidenceRefs?: string[];
};

function classFlags(classes: readonly string[]): number {
  return classes.reduce((flags, name) => flags | (SINO_READING_CLASS_FLAGS[name as keyof typeof SINO_READING_CLASS_FLAGS] ?? 0), 0);
}

async function sinoComponentProjection(rootDir: string, graph: AcceptedGraph): Promise<Pick<NonNullable<Parameters<typeof compileBrowserPack>[2]>, 'sinoComponentRows' | 'omitRuleIds' | 'omitBindingIds'>> {
  const artifact = JSON.parse(await readFile(resolve(rootDir, 'data/historical/sino/phase46e-sino-kana.json'), 'utf8')) as { componentRelations: SinoArtifactRelation[] };
  const rows: SinoComponentIndexRow[] = [];
  for (const relation of artifact.componentRelations) {
    const classes = relation.readingClasses ?? [];
    const evidenceRefs = relation.evidenceRefs ?? [];
    if (!relation.character || !relation.modernReading || relation.context != null || relation.historicalReadings?.length !== 1
      || relation.historicalReadings[0] !== relation.modernReading || classes.length === 0
      || !evidenceRefs.some((ref) => ref.startsWith(`${SINO_CLASS_SOURCE}:`)) || !evidenceRefs.includes(SINO_CATCH_ALL)) continue;
    rows.push({
      character: relation.character,
      modernReading: relation.modernReading,
      classFlags: classFlags(classes),
      sourceRefs: [SINO_CLASS_SOURCE, SINO_TABLE_SOURCE],
      evidenceRefs: [...new Set(evidenceRefs)].sort()
    });
  }
  rows.sort((a, b) => (a.character < b.character ? -1 : a.character > b.character ? 1 : 0)
    || (a.modernReading < b.modernReading ? -1 : a.modernReading > b.modernReading ? 1 : 0));
  const syntheticBindingIds = new Set(graph.bindings.filter((binding) => binding.sourceRefs.includes(SINO_CLASS_SOURCE)).map((binding) => binding.id));
  const regularRuleIds = new Set(graph.bindings.filter((binding) => !syntheticBindingIds.has(binding.id)).map((binding) => binding.ruleId));
  const syntheticRuleIds = new Set(graph.bindings.filter((binding) => syntheticBindingIds.has(binding.id)).map((binding) => binding.ruleId));
  const omitRuleIds = new Set([...syntheticRuleIds].filter((id) => !regularRuleIds.has(id)));
  return { sinoComponentRows: rows, omitRuleIds, omitBindingIds: syntheticBindingIds };
}

async function acceptedInputs(rootDir: string, graph?: AcceptedGraph) {
  const g = graph ?? (await normalizeAcceptedOrthographySources(rootDir)).graph;
  const fullGraph = withProfileRules(g);
  const sino = await sinoComponentProjection(rootDir, fullGraph);
  // TAR migration rules execute through BrowserPack v3 Rule Programs. Keeping the same
  // rules in the legacy v1/v2 canonical rule table duplicates runtime authority and
  // makes the eager rules section scale with the migration corpus. Keep the full graph
  // for identity/evidence and v3 IR compilation, but omit TAR rows from legacy tables.
  const tarRuleIds = new Set(fullGraph.rules.filter((rule) => rule.origin === 'tar').map((rule) => rule.id));
  const omitRuleIds = new Set([...(sino.omitRuleIds ?? []), ...tarRuleIds]);
  let terminology: unknown;
  try { terminology = JSON.parse(await readFile(resolve(rootDir, 'site/terminology-ja.json'), 'utf8')); } catch { terminology = undefined; }
  return { graph: fullGraph, options: { ...(terminology === undefined ? {} : { terminology }), ...sino, omitRuleIds } };
}

export async function buildAcceptedBrowserPack(rootDir: string, graph?: AcceptedGraph): Promise<BrowserPackBuild> {
  const inputs = await acceptedInputs(rootDir, graph);
  return compileBrowserPack(inputs.graph, PROFILES, inputs.options);
}

/** BrowserPack v2 (#196 B): v1 sections plus the lexeme-centric lexical layer. */
export async function buildAcceptedBrowserPackV2(rootDir: string, graph?: AcceptedGraph): Promise<BrowserPackBuild> {
  const inputs = await acceptedInputs(rootDir, graph);
  const { extract } = await loadJmdictIntake(rootDir);
  const unidic = JSON.parse(await readFile(resolve(rootDir, 'data/lexical/sources/unidic-cwj-202512-first-slice.json'), 'utf8')) as UniDicSourceSlice;
  const identities = new Set(inputs.graph.facts.flatMap((f) => f.lexicalRefs));
  const morphology = mergeMorphology(jmdictLexemeMorphology(extract), unidicLexemeMorphology(unidic, identities));
  return compileBrowserPack(inputs.graph, PROFILES, { ...inputs.options, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION, layers: [lexicalLayer({ morphology })] });
}

export function compiledReport(build: BrowserPackBuild) {
  const byLoading: Record<string, { sections: number; bytes: number; gzipBytes: number }> = {};
  const byKind: Record<string, { sections: number; bytes: number; gzipBytes: number }> = {};
  for (const section of build.manifest.sections) {
    const body = build.files.get(section.path)!;
    const gz = gzipSync(body, { level: 9 }).length;
    for (const [table, key] of [[byLoading, section.loading], [byKind, section.kind]] as const) {
      const row = (table[key] ??= { sections: 0, bytes: 0, gzipBytes: 0 });
      row.sections += 1; row.bytes += body.byteLength; row.gzipBytes += gz;
    }
  }
  const shards = build.manifest.sections.filter((s) => s.kind === 'facts');
  return {
    schemaVersion: '1',
    kind: `browser-pack-v${build.manifest.compilerVersion}-compiled`,
    owner: { '1': 'japanese-orthography#185 B', '2': 'japanese-orthography#196 B', '3': 'japanese-orthography#211 F' }[build.manifest.compilerVersion] ?? 'unknown',
    packDigest: build.manifest.packDigest,
    canonicalGraphSha256: build.manifest.canonicalGraphSha256,
    totals: Object.values(byLoading).reduce((t, r) => ({ sections: t.sections + r.sections, bytes: t.bytes + r.bytes, gzipBytes: t.gzipBytes + r.gzipBytes }), { sections: 0, bytes: 0, gzipBytes: 0 }),
    byLoading: Object.fromEntries(Object.entries(byLoading).sort()),
    byKind: Object.fromEntries(Object.entries(byKind).sort()),
    shards: { count: shards.length, largestFactsBytes: Math.max(...shards.map((s) => s.byteLength)) },
    baseline: { aReport: 'data/reports/browser-pack-v1-measurements.json', v2HotArtifactModernBytes: 60965586 }
  };
}

async function emit(rootDir: string, build: BrowserPackBuild, dirRel: string, manifestRel: string, reportRel: string, check: boolean) {
  const manifestText = serializeBrowserPackManifest(build.manifest);
  validateBrowserPackManifest(JSON.parse(manifestText));
  verifyBrowserPackSections(build.manifest, new Map(build.manifest.sections.map((s) => [s.sectionId, build.files.get(s.path)!])));
  const reportText = `${JSON.stringify(compiledReport(build), null, 2)}
`;
  if (check) {
    if (normalizeCheckoutText(await readFile(resolve(rootDir, manifestRel), 'utf8')) !== manifestText) throw new Error(`stale ${manifestRel}; run npm run generate:browser-pack`);
    if (normalizeCheckoutText(await readFile(resolve(rootDir, reportRel), 'utf8')) !== reportText) throw new Error(`stale ${reportRel}`);
    console.log(`BrowserPack ${build.manifest.compilerVersion} manifest OK: ${build.manifest.sections.length} sections, pack ${build.manifest.packDigest}`);
    return;
  }
  const dir = resolve(rootDir, dirRel);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [path, body] of build.files) await writeFile(resolve(dir, path), body);
  await writeFile(resolve(dir, 'manifest.json'), manifestText);
  await writeFile(resolve(rootDir, reportRel), reportText);
  console.log(`wrote ${dirRel}: ${build.manifest.sections.length} sections, pack ${build.manifest.packDigest}`);
}

if (process.argv[1]?.endsWith('generate-browser-pack.ts')) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const check = process.argv.includes('--check');
  const { graph } = await normalizeAcceptedOrthographySources(rootDir);
  await emit(rootDir, await buildAcceptedBrowserPack(rootDir, graph), BROWSER_PACK_DIR, BROWSER_PACK_MANIFEST, BROWSER_PACK_COMPILED_REPORT, check);
  const v2 = await buildAcceptedBrowserPackV2(rootDir, graph);
  await emit(rootDir, v2, BROWSER_PACK_V2_DIR, BROWSER_PACK_V2_MANIFEST, BROWSER_PACK_V2_COMPILED_REPORT, check);
  // #196 D: browser resolver adapter vs accepted core resolver (fails on any unclassified difference)
  const parity = await browserCoreParity(rootDir, v2);
  const parityText = `${JSON.stringify(parity, null, 2)}
`;
  if (parity.summary.mismatches > 0) throw new Error(`browser/core resolver parity: ${parity.summary.mismatches} unclassified mismatch(es): ${parity.cases.filter((c) => c.difference === 'MISMATCH').map((c) => c.input).join(', ')}`);
  if (check) {
    if (normalizeCheckoutText(await readFile(resolve(rootDir, BROWSER_RESOLVER_PARITY_REPORT), 'utf8')) !== parityText) throw new Error(`stale ${BROWSER_RESOLVER_PARITY_REPORT}; run npm run generate:browser-pack`);
    console.log(`browser/core parity OK: ${parity.summary.identical} identical, ${parity.summary.classified} classified`);
  } else {
    await writeFile(resolve(rootDir, BROWSER_RESOLVER_PARITY_REPORT), parityText);
  }
  // #211 F: BrowserPack v3 (symbol-encoded hot strings) must be semantically identical to v2
  const registry = JSON.parse(await readFile(resolve(rootDir, SYMBOL_REGISTRY), 'utf8')) as SymbolRegistry;
  const fullGraph = withProfileRules(graph);
  const v3 = transcodeToV3(v2, registry, { evidence: { graph: canonicalizeOrthographyKnowledge(fullGraph), ir: compileRuleIR(fullGraph) } });
  await emit(rootDir, v3, BROWSER_PACK_V3_DIR, BROWSER_PACK_V3_MANIFEST, BROWSER_PACK_V3_COMPILED_REPORT, check);
  const compared = await assertV3Equivalent(v2, v3, CAPABILITY_PROBES.map((p) => p.text));
  console.log(`BrowserPack v3 ≡ v2 on ${compared} probe conversions`);
  // #211 I: browser/core parity on v3 must classify every case exactly as on v2
  const parityV3 = await browserCoreParity(rootDir, v3);
  if (JSON.stringify(parityV3.cases) !== JSON.stringify(parity.cases)) throw new Error('browser/core parity differs between v3 and v2');
  const parityV3Text = `${JSON.stringify(parityV3, null, 2)}
`;
  if (check) {
    if (normalizeCheckoutText(await readFile(resolve(rootDir, BROWSER_RESOLVER_PARITY_REPORT_V3), 'utf8')) !== parityV3Text) throw new Error(`stale ${BROWSER_RESOLVER_PARITY_REPORT_V3}; run npm run generate:browser-pack`);
  } else {
    await writeFile(resolve(rootDir, BROWSER_RESOLVER_PARITY_REPORT_V3), parityV3Text);
  }
}
