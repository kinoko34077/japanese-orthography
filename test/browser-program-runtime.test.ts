import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
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
const { createTransformService } = require('../runtime/browser-transform-worker.js');

const graph = canonicalizeOrthographyKnowledge(adapterFixture());
const registry = JSON.parse(await readFile(new URL(`../${SYMBOL_REGISTRY}`, import.meta.url), 'utf8')) as SymbolRegistry;
const v2 = compileBrowserPack(graph, [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION
});
const v3 = transcodeToV3(v2, registry, { evidence: { graph, ir: compileRuleIR(graph) } });

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

test('worker executes the hot VM beside the legacy route and returns actual ProgramIds', async () => {
  const pack = await openBrowserPack(v3.manifest, async (section: { path: string }) => v3.files.get(section.path)!);
  const service = createTransformService({ openPack: async () => pack });
  const result = await service.handle({ type: 'transform', requestId: 'r6', text: '学', profileId: 'historical', renderMode: 'plain' });
  assert.equal(result.type, 'result');
  assert.deepEqual(result.result.programTrace.executedProgramIds, [28]);
  assert.deepEqual(result.result.programTrace.runs.map((run: { stage: string; direction: string; channel: string }) => [run.stage, run.direction, run.channel]), [['orthographic', 'to-historical', 'surface']]);
});
