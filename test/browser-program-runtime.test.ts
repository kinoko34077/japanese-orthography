import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { lexicalLayer } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION } from '../tools/browser-pack-model.ts';
import { transcodeToV3 } from '../tools/browser-pack-v3.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from '../tools/symbol-registry.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';
import { canonicalizeOrthographyKnowledge } from '../tools/orthography-knowledge-model.ts';
import { compileRuleIR } from '../tools/rule-ir.ts';

const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserProgramRuntime } = require('../runtime/browser-program-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');

const graph = canonicalizeOrthographyKnowledge(adapterFixture());
const registry = JSON.parse(await readFile(new URL(`../${SYMBOL_REGISTRY}`, import.meta.url), 'utf8')) as SymbolRegistry;
const v2 = compileBrowserPack(graph, [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION,
  layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
});
const v3 = transcodeToV3(v2, registry, { evidence: { graph, ir: compileRuleIR(graph) } });
const necessaryGraph = adapterFixture();
necessaryGraph.facts.push(
  { id: 'fact:literal_form:必要|lexeme:必要/ひつよう', kind: 'literal_form', lexicalRefs: ['lexeme:必要/ひつよう'], surface: '必要', periodRefs: ['period:modern'], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] },
  { id: 'fact:literal_reading:必要|ひつよう|lexeme:必要/ひつよう', kind: 'literal_reading', lexicalRefs: ['lexeme:必要/ひつよう'], surface: '必要', reading: 'ひつよう', periodRefs: ['period:modern'], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] }
);
necessaryGraph.rules.push({ id: 'rule:sino:えう>よう', class: 'diachronic', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['えう'], to: ['よう'], dependencies: [], predicate: { channel: 'reading' }, sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] });
necessaryGraph.bindings.push({ id: 'binding:sino:要:えう>よう@phase46e-reading-class', ruleId: 'rule:sino:えう>よう', lexicalRefs: ['symbol:要'], contextRefs: [], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] });
const necessaryCanonical = canonicalizeOrthographyKnowledge(necessaryGraph);
const necessaryV2 = compileBrowserPack(necessaryCanonical, [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION,
  layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })],
  sinoComponentRows: [{ character: '必', modernReading: 'ひつ', classFlags: 4, sourceRefs: ['phase46e-sino-reading-class'], evidenceRefs: ['phase46e-sino-reading-class:必:ひつ'] }]
});
const necessaryV3 = transcodeToV3(necessaryV2, registry, { evidence: { graph: necessaryCanonical, ir: compileRuleIR(necessaryCanonical) } });

const profileAnywhereGraph = adapterFixture();
profileAnywhereGraph.rules.push({
  id: 'rule:fixture:profile-anywhere',
  class: 'orthographic',
  directionality: 'forward_only',
  lossiness: 'lossless',
  from: ['校'],
  to: ['學'],
  dependencies: [],
  predicate: { channel: 'surface' },
  origin: 'project_defined',
  sourceRefs: ['src:fixture'],
  evidenceRefs: ['ev:fixture']
});
const profileAnywhereCanonical = canonicalizeOrthographyKnowledge(profileAnywhereGraph);
const profileAnywhereV2 = compileBrowserPack(profileAnywhereCanonical, [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION,
  layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
});
const profileAnywhereV3 = transcodeToV3(profileAnywhereV2, registry, {
  evidence: { graph: profileAnywhereCanonical, ir: compileRuleIR(profileAnywhereCanonical) }
});

test('BrowserPack v3 carries the shared hot Rule Program sections and executes by SequenceId', async () => {
  const kinds = new Set(v3.manifest.sections.map((section) => section.kind));
  for (const kind of ['sequence-pool', 'rule-programs', 'rule-program-index', 'rule-predicates', 'rule-lexeme-sets', 'rule-runtime-meta'] as const) {
    assert.ok(kinds.has(kind), `missing ${kind}`);
  }
  const pack = await openBrowserPack(v3.manifest, async (section: { path: string }) => v3.files.get(section.path)!);
  const runtime = await createBrowserProgramRuntime(pack);
  const result = runtime.run({ stage: 'orthographic', direction: 'to-historical', channel: 'surface', text: '学', profileId: 'historical' });
  assert.deepEqual(result.edges.map((edge: { output: string }) => edge.output), ['學']);
  assert.deepEqual(result.executedProgramIds, [28]);
  assert.equal(result.edges[0].programs.at(-1), 28);
  const direct = runtime.run({ stage: 'lexical', direction: 'reconstruct', channel: 'reading', text: 'ドイツ', profileId: 'modern' });
  assert.deepEqual(direct.edges.map((edge: { output: string }) => edge.output), ['独乙', '独逸']);
  assert.deepEqual(direct.executedProgramIds, [0]);
});

test('transformText passes lexical hypotheses to scoped Rule Programs', async () => {
  const pack = await openBrowserPack(v3.manifest, async (section: { path: string }) => v3.files.get(section.path)!);
  const runtime = await createBrowserProgramRuntime(pack);
  const lexical = createBrowserLexicalRuntime(pack);
  await lexical.prepare('学校');
  const school = lexical.lookupSurfaceSync('学校');
  const result = runtime.transformText('学校', 'historical', {
    stages: ['diachronic'], directions: ['to-historical'], channels: ['reading'],
    lexemesFor: () => new Set(school.map((candidate: { lexemeId: number }) => candidate.lexemeId))
  });
  assert.ok(result.candidates.some((candidate: { output: string }) => candidate.output === 'がくかう'));
  assert.ok(result.trace.executedProgramIds.length > 0);
});

test('profile-stage Rule Programs preserve explicit anywhere scope through runtime arbitration', async () => {
  const pack = await openBrowserPack(profileAnywhereV3.manifest, async (section: { path: string }) => profileAnywhereV3.files.get(section.path)!);
  const runtime = await createBrowserProgramRuntime(pack);
  const observation = runtime.transformText('校', 'kinotch-fixed', {
    stages: ['profile'], directions: ['to-modern'], channels: ['surface']
  });
  const candidate = observation.candidates.find((entry: { output: string }) => entry.output === '學');
  assert.ok(candidate);
  assert.equal(candidate.policy, 'anywhere');

  const service = createTransformService({ openPack: async () => pack, executionMode: 'vm-authoritative' });
  const kinotch = await service.handle({ type: 'transform', requestId: 'scope-kinotch', text: '校', profileId: 'kinotch-fixed', renderMode: 'plain' });
  const modern = await service.handle({ type: 'transform', requestId: 'scope-modern', text: '校', profileId: 'modern', renderMode: 'plain' });
  assert.equal(kinotch.type, 'result', kinotch.message);
  assert.equal(kinotch.result.renderedText, '學');
  assert.equal(modern.type, 'result', modern.message);
  assert.equal(modern.result.renderedText, '校');
});

test('worker defaults to VM-authoritative output after the parity gate', async () => {
  const pack = await openBrowserPack(v3.manifest, async (section: { path: string }) => v3.files.get(section.path)!);
  const service = createTransformService({ openPack: async () => pack });
  const result = await service.handle({ type: 'transform', requestId: 'r6', text: '学', profileId: 'historical', renderMode: 'plain' });
  assert.equal(result.type, 'result');
  assert.equal(result.result.executionMode, 'vm-authoritative');
  assert.equal(result.result.renderedText, '學');
  assert.deepEqual(result.result.programTrace.executedProgramIds, [28]);
  assert.deepEqual(result.result.programTrace.runs.map((run: { stage: string; direction: string; channel: string }) => [run.stage, run.direction, run.channel]), [['orthographic', 'to-historical', 'surface']]);
});

test('vm-authoritative worker output is assembled from the real Rule Program scan', async () => {
  const pack = await openBrowserPack(v3.manifest, async (section: { path: string }) => v3.files.get(section.path)!);
  const service = createTransformService({ openPack: async () => pack, executionMode: 'vm-authoritative' });
  const result = await service.handle({ type: 'transform', requestId: 'vm-r6', text: '学', profileId: 'historical', renderMode: 'plain' });
  assert.equal(result.type, 'result', result.message);
  assert.equal(result.result.renderedText, '學');
  assert.equal(result.result.executionMode, 'vm-authoritative');
  assert.deepEqual(result.result.programTrace.executedProgramIds, [28]);
  assert.equal(result.result.spans[0].authority, 'source_rule');
});

test('vm-authoritative renders whole explicit Ruby from Rule Program reading evidence', async () => {
  const pack = await openBrowserPack(v3.manifest, async (section: { path: string }) => v3.files.get(section.path)!);
  const service = createTransformService({ openPack: async () => pack, executionMode: 'vm-authoritative' });
  const result = await service.handle({ type: 'transform', requestId: 'vm-ruby', text: '学校', profileId: 'historical', renderMode: 'ruby-whole-explicit' });
  assert.equal(result.type, 'result', result.message);
  assert.equal(result.result.renderedText, '｜學校《がくかう》');
  assert.equal(result.result.spans[0].certainty, 'unique');
  assert.equal(result.result.spans[0].authority, 'source_rule');
});

test('vm-authoritative preserves all four Ruby render modes through the shared serializer', async () => {
  const pack = await openBrowserPack(v3.manifest, async (section: { path: string }) => v3.files.get(section.path)!);
  const service = createTransformService({ openPack: async () => pack, executionMode: 'vm-authoritative' });
  const expected = new Map([
    ['ruby-whole-explicit', '｜學校《がくかう》'],
    ['ruby-whole-implicit', '學校《がくかう》'],
    ['ruby-components-explicit', '｜學校《がくかう》'],
    ['ruby-components-implicit', '學校《がくかう》']
  ]);
  for (const [renderMode, renderedText] of expected) {
    const result = await service.handle({ type: 'transform', requestId: `vm-ruby-${renderMode}`, text: '学校', profileId: 'historical', renderMode });
    assert.equal(result.type, 'result', result.message);
    assert.equal(result.result.renderedText, renderedText);
  }
});

test('parity mode compares legacy and Rule Program Ruby rendering with one VM observation', async () => {
  const pack = await openBrowserPack(v3.manifest, async (section: { path: string }) => v3.files.get(section.path)!);
  const service = createTransformService({ openPack: async () => pack, executionMode: 'parity' });
  const result = await service.handle({ type: 'transform', requestId: 'parity-ruby', text: '学校', profileId: 'historical', renderMode: 'ruby-whole-explicit' });
  assert.equal(result.type, 'result', result.message);
  assert.equal(result.result.programParity.equivalent, true);
  assert.equal(result.result.programParity.legacyRenderedText, '｜學校《がくかう》');
  assert.equal(result.result.programParity.programRenderedText, '｜學校《がくかう》');
  assert.equal(result.result.programParity.authority, 'legacy');
});

test('vm-authoritative reconstructs 必要 from compact class evidence and symbol-scoped Rule Programs', async () => {
  const pack = await openBrowserPack(necessaryV3.manifest, async (section: { path: string }) => necessaryV3.files.get(section.path)!);
  const service = createTransformService({ openPack: async () => pack, executionMode: 'vm-authoritative' });
  const result = await service.handle({ type: 'transform', requestId: 'vm-necessary', text: '必要', profileId: 'historical', renderMode: 'ruby-whole-explicit' });
  assert.equal(result.type, 'result', result.message);
  assert.equal(result.result.renderedText, '｜必要《ひつえう》');
  assert.equal(result.result.spans[0].authority, 'source_rule');
  assert.equal(result.result.spans[0].certainty, 'unique');
});
