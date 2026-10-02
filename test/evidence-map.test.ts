import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { lexicalLayer } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION } from '../tools/browser-pack-model.ts';
import { transcodeToV3 } from '../tools/browser-pack-v3.ts';
import { buildEvidence } from '../tools/evidence-map.ts';
import { canonicalizeOrthographyKnowledge } from '../tools/orthography-knowledge-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { compileRuleIR } from '../tools/rule-ir.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from '../tools/symbol-registry.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';

// #211 G — evidence separated from the hot runtime (#208 §10–§11, acceptance D).
const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');
const { expandDetail } = require('../runtime/browser-diagnostic-contract.js');

const registry = JSON.parse(await readFile(new URL(`../${SYMBOL_REGISTRY}`, import.meta.url), 'utf8')) as SymbolRegistry;
const graph = canonicalizeOrthographyKnowledge(adapterFixture());
const ir = compileRuleIR(adapterFixture());
const v2 = compileBrowserPack(adapterFixture(), [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  shardBudgetBytes: 2048, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION, layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
});
const v3 = transcodeToV3(v2, registry, { evidence: { graph, ir } });
const pack = await openBrowserPack(v3.manifest, async (s: { path: string }) => v3.files.get(s.path)!);

test('every Program traces to canonical evidence and every canonical id resolves to source records', () => {
  const { entries, programs } = buildEvidence(graph, ir);
  assert.equal(programs.length, ir.rules.length);
  assert.equal(entries.length, graph.facts.length + graph.rules.length + graph.bindings.length);
  for (const e of entries) assert.ok(e.sourceRecords.length > 0 && e.sourceSnapshots.length > 0, e.canonicalId);
  const covered = new Set(entries.flatMap((e) => e.programs));
  for (let p = 0; p < programs.length; p += 1) assert.ok(covered.has(p), `Program ${p} is reachable from evidence`);
});

test('a canonical id without any source fails the build closed', () => {
  const broken = structuredClone(graph);
  broken.facts.push({ id: 'fact:literal_form:幽霊||', kind: 'literal_form', lexicalRefs: [], surface: '幽霊', sourceRefs: ['src:nowhere'], evidenceRefs: [] });
  assert.throws(() => buildEvidence(broken, ir), /neither a source record nor a registered source/);
});

test('the hot pack keeps handles only; cold evidence resolves lazily with the human-readable type', async () => {
  const hot = v3.manifest.sections.filter((s) => s.loading !== 'lazy').map((s) => s.kind);
  assert.ok(!hot.includes('evidence-map') && !hot.includes('program-evidence') && !hot.includes('detail-shard'));
  assert.ok(!v3.manifest.sections.some((s) => s.kind === 'provenance-index'), 'the unused provenance index is gone');
  const entry = await pack.loadEvidence('fact:form_relation:擡頭||台頭');
  assert.deepEqual([entry.kind, entry.periodRefs, entry.sourceSnapshots], ['fact', ['period:historical-kana'], ['src:fixture']]);
  const program = await pack.loadProgramEvidence(entry.programs[0]);
  assert.equal(program.evidenceType, 'contextual_kanji');
  assert.ok(program.canonicalIds.includes('fact:form_relation:擡頭||台頭'));
  assert.equal(await pack.loadEvidence('fact:nothing||'), null);
});

test('span details carry the recovered evidence (sources, dispositions, Programs and their type)', async () => {
  const lexical = createBrowserLexicalRuntime(pack);
  const raw = await transformWithResolver(pack, lexical, '台頭', 'historical', {});
  const detail = await expandDetail(pack, raw, '0');
  const evidence = detail.acceptedCandidates[0].evidence;
  assert.equal(evidence.canonicalId, 'fact:form_relation:擡頭||台頭');
  assert.ok(evidence.programs.some((p: any) => p.evidenceType === 'contextual_kanji' && p.kind === 'contextual'));
});

test('the committed v3 lock carries the evidence sections and no provenance index', async () => {
  const m = JSON.parse(await readFile(new URL('../data/browser-pack-v3/manifest.json', import.meta.url), 'utf8'));
  const kinds = new Set(m.sections.map((s: { kind: string }) => s.kind));
  assert.ok(kinds.has('evidence-map') && kinds.has('program-evidence') && !kinds.has('provenance-index'));
  for (const s of m.sections) if (s.kind === 'evidence-map' || s.kind === 'program-evidence') assert.equal(s.loading, 'lazy');
});
