import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { lexicalLayer, type LexicalMorphologyRow } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION } from '../tools/browser-pack-model.ts';
import { canonicalizeOrthographyKnowledge } from '../tools/orthography-knowledge-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_OKURIGANA_STYLE, KINOTCH_PROFILE, KINOTCH_STYLE_RULES, MODERN_PROFILE, resolveProjectionPolicy, withProfileRules } from '../tools/orthography-policy.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';

// #196 G — bounded KiNoTch semantic/style profile slice over the generic resolver.
const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');
const { summarize } = require('../runtime/browser-diagnostic-contract.js');

const P = { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] };
const MOD = ['period:modern'];
const forms = (id: string, reading: string, ...surfaces: string[]) => surfaces.flatMap((surface) => [
  { id: `fact:literal_form:${surface}|${id}`, kind: 'literal_form' as const, lexicalRefs: [id], surface, periodRefs: MOD, ...P },
  { id: `fact:literal_reading:${surface}|${reading}|${id}`, kind: 'literal_reading' as const, lexicalRefs: [id], surface, reading, periodRefs: MOD, ...P }
]);
const graph = (() => {
  const g = withProfileRules(adapterFixture());
  g.facts.push(
    ...forms('lexeme:分かる/わかる', 'わかる', '分かる', '分る'),
    ...forms('lexeme:当たる/あたる', 'あたる', '当たる', '当る'),
    { id: 'fact:form_relation:當たる||当たる', kind: 'form_relation', lexicalRefs: [], surface: '當たる', target: '当たる', periodRefs: ['period:historical-kana'], tags: ['lexical_historical_kanji'], ...P }
  );
  return canonicalizeOrthographyKnowledge(g);
})();
const jm = (pos: string[]): LexicalMorphologyRow[] => [{ source: 'jmdict', pos, conjugationType: null, conjugationForm: null, reading: null, lexicalOrigin: null }];
const build = compileBrowserPack(graph, [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  shardBudgetBytes: 2048, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION,
  layers: [lexicalLayer({ morphology: new Map([['lexeme:分かる/わかる', jm(['v5r', 'vi'])], ['lexeme:当たる/あたる', jm(['v5r', 'vi'])]]), lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
});
const pack = await openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!);
const lexical = createBrowserLexicalRuntime(pack);
const run = (text: string, profile: string) => transformWithResolver(pack, lexical, text, profile, {});

test('every style rule is one Phase-4.6F record classified kinotch_style and admitted (provenance lock)', async () => {
  const intake = JSON.parse(await readFile(new URL('../data/intake/phase46f-kinotch-profile.json', import.meta.url), 'utf8'));
  for (const { from, to, record } of KINOTCH_OKURIGANA_STYLE) {
    const r = intake.records.find((x: any) => x.id === record);
    assert.deepEqual([r?.responsibility, r?.disposition, r?.modernSurface, r?.historicalSurface], ['kinotch_style', 'admitted', from, to], record);
  }
  for (const rule of KINOTCH_STYLE_RULES) assert.equal(rule.origin, 'project_defined');
});

test('generic profiles do not claim 分かる -> 分る; KiNoTch enables it as project style', () => {
  const ids = KINOTCH_STYLE_RULES.map((r) => r.id);
  for (const profile of [HISTORICAL_PROFILE, MODERN_PROFILE]) {
    const disabled = resolveProjectionPolicy(profile, graph).disabledRuleIds ?? [];
    assert.ok(ids.every((id) => disabled.includes(id)), profile.profileId);
  }
  assert.ok(ids.every((id) => !(resolveProjectionPolicy(KINOTCH_PROFILE, graph).disabledRuleIds ?? []).includes(id)));
});

test('分かる: generic historical unchanged; KiNoTch 分る, also for inflections of the same lexeme', async () => {
  assert.equal((await run('分かる', 'historical')).renderedText, '分かる');
  const kinotch = await run('分かる', 'kinotch-fixed');
  assert.equal(kinotch.renderedText, '分る');
  assert.equal(summarize(kinotch).spans[0].authority, 'project_rule');
  assert.equal((await run('分からない', 'kinotch-fixed')).renderedText, '分らない');
  assert.equal((await run('分かります', 'kinotch-fixed')).renderedText, '分ります');
  assert.equal((await run('分からない', 'historical')).renderedText, '分からない');
});

test('style composes after semantics: a semantic change is never overridden by project style', async () => {
  assert.equal((await run('当たる', 'historical')).renderedText, '當たる');
  assert.equal((await run('当たる', 'kinotch-fixed')).renderedText, '當たる');
});

test('こと -> ヿ stays compatible; ドイツ keeps its candidate set (no admitted profile choice)', async () => {
  assert.equal((await run('こと', 'kinotch-fixed')).renderedText, 'ヿ');
  const germany = await run('ドイツ', 'kinotch-fixed');
  assert.equal(germany.renderedText, 'ドイツ');
  assert.deepEqual(germany.spans, []);
});
