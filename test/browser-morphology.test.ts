import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { lexicalLayer, type LexicalMorphologyRow } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION } from '../tools/browser-pack-model.ts';
import { canonicalizeOrthographyKnowledge } from '../tools/orthography-knowledge-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';

// #196 F — morphology (JMdict POS / deinflection), Sino reconstruction, graded homophone evidence.
const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');
const Inflection = require('../runtime/browser-inflection.js');

const P = { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] };
const MOD = ['period:modern'];
const lexeme = (id: string, surface: string, reading: string) => [
  { id: `fact:literal_form:${surface}|${id}`, kind: 'literal_form' as const, lexicalRefs: [id], surface, periodRefs: MOD, ...P },
  { id: `fact:literal_reading:${surface}|${reading}|${id}`, kind: 'literal_reading' as const, lexicalRefs: [id], surface, reading, periodRefs: MOD, ...P }
];
const sinoRule = (historical: string, modern: string) => ({ id: `rule:sino:${historical}>${modern}`, class: 'diachronic' as const, directionality: 'reverse_traversable' as const, lossiness: 'lossless' as const, from: [historical], to: [modern], dependencies: [], predicate: { channel: 'reading' }, ...P });
const sinoBinding = (char: string, historical: string, modern: string, context?: string) => ({
  id: `binding:sino:${char}:${historical}>${modern}@${context ?? 'none'}`, ruleId: `rule:sino:${historical}>${modern}`, lexicalRefs: [`symbol:${char}`],
  ...(context ? { contextRefs: [`context:usage:${context}`] } : {}), ...P
});
const graph = (() => {
  const g = adapterFixture();
  g.facts.push(
    ...lexeme('lexeme:味わう/あじわう', '味わう', 'あじわう'), ...lexeme('lexeme:書く/かく', '書く', 'かく'),
    ...lexeme('lexeme:円周/えんしゅう', '円周', 'えんしゅう'), ...lexeme('lexeme:法律/ほうりつ', '法律', 'ほうりつ'),
    ...lexeme('lexeme:海松/みる', '海松', 'みる'), ...lexeme('lexeme:勉強/べんきょう', '勉強', 'べんきょう')
  );
  g.rules.push(sinoRule('ゑん', 'えん'), sinoRule('しう', 'しゅう'), sinoRule('はふ', 'ほう'), sinoRule('ほふ', 'ほう'), sinoRule('りつ', 'りつ'),
    { id: 'rule:char:圓>円', class: 'orthographic', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['圓'], to: ['円'], dependencies: [], predicate: { channel: 'surface' }, ...P });
  g.bindings.push(sinoBinding('円', 'ゑん', 'えん'), sinoBinding('周', 'しう', 'しゅう'), sinoBinding('法', 'はふ', 'ほう'), sinoBinding('法', 'ほふ', 'ほう', '仏教用語'), sinoBinding('律', 'りつ', 'りつ'));
  return canonicalizeOrthographyKnowledge(g);
})();
const jm = (pos: string[]): LexicalMorphologyRow[] => [{ source: 'jmdict', pos, conjugationType: null, conjugationForm: null, reading: null, lexicalOrigin: null }];
const morphology = new Map<string, LexicalMorphologyRow[]>([
  ['lexeme:味わう/あじわう', jm(['v5u', 'vt'])], ['lexeme:書く/かく', jm(['v5k', 'vt'])], ['lexeme:見る/みる', jm(['v1', 'vt'])], ['lexeme:診る/みる', jm(['v1', 'vt'])],
  ['lexeme:海松/みる', jm(['n'])], ['lexeme:円周/えんしゅう', jm(['n'])], ['lexeme:法律/ほうりつ', jm(['n'])], ['lexeme:勉強/べんきょう', jm(['n', 'vs'])]
]);
const build = compileBrowserPack(graph, [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  shardBudgetBytes: 2048, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION, layers: [lexicalLayer({ morphology, lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
});
const pack = await openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!);
const lexical = createBrowserLexicalRuntime(pack);
const run = (text: string, renderMode = 'plain') => transformWithResolver(pack, lexical, text, 'historical', { renderMode });
const whole = async (text: string, renderMode = 'plain') => {
  const raw = await run(text, renderMode);
  return { raw, unit: raw.units.find((u: any) => u.start === 0 && u.end === text.length)?.unit };
};

test('deinflection maps inflected surfaces to dictionary-form lexemes whose JMdict POS admits the rule', async () => {
  const { unit } = await whole('味わおう');
  assert.deepEqual([unit.kind, unit.lexicalIdentity, unit.reading], ['resolved', 'lexeme:味わう/あじわう', 'あじわおう']);
  assert.deepEqual(unit.morphology, { partOfSpeech: ['v5u', 'vt'], conjugationType: 'v5u', conjugationForm: '意志推量形' });
  for (const [text, reading, form] of <Array<[string, string, string]>>[['書きます', 'かきます', '連用形-一般+ます'], ['書かない', 'かかない', '未然形-一般+ない'], ['書いた', 'かいた', '連用形-音便+た'], ['勉強した', 'べんきょうした', '連用形-一般+た']]) {
    const u = (await whole(text)).unit;
    assert.deepEqual([u?.kind, u?.reading, u?.morphology?.conjugationForm], ['resolved', reading, form], text);
  }
  // a noun admits no verb inflection, and a rule never invents a lexeme
  assert.equal((await whole('円周した')).unit, undefined);
  assert.equal((await whole('書きおう')).unit, undefined);
});

test('the deinflection table is deterministic and every rule rewrites back to its base ending', () => {
  for (const rule of Inflection.rules) {
    const surface = `語${rule.inflected}`;
    assert.ok(Inflection.deinflect(surface).some((d: any) => d.pos === rule.pos && d.baseSurface === `語${rule.base}`), `${rule.pos} ${rule.inflected}`);
    assert.equal(Inflection.inflectReading(`ご${rule.base}`, rule), `ご${rule.inflected}`);
  }
  assert.ok(Inflection.admits(['n', 'vs'], { pos: 'vs' }) && !Inflection.admits(['n'], { pos: 'vs' }));
});

test('graded homophone evidence: reading -> candidates -> morphology filter; no storage-order winner', async () => {
  const miru = await whole('みる');
  assert.equal(miru.raw.renderedText, 'みる');
  assert.equal(miru.unit.kind, 'candidates');
  assert.deepEqual(miru.unit.lexicalCandidates.map((c: any) => c.lexicalIdentity).sort(), ['lexeme:海松/みる', 'lexeme:見る/みる', 'lexeme:診る/みる']);
  // an inflected kana form can only be a verb: the noun 海松 is filtered out by its POS
  const minai = await whole('みない');
  assert.equal(minai.unit.kind, 'candidates');
  assert.deepEqual(minai.unit.lexicalCandidates.map((c: any) => c.lexicalIdentity).sort(), ['lexeme:見る/みる', 'lexeme:診る/みる']);
  assert.equal(minai.raw.renderedText, 'みない');
});

test('Sino component reconstruction uses the accepted reconstructor over canonical bindings', async () => {
  const { raw, unit } = await whole('円周', 'ruby-whole-explicit');
  assert.equal(raw.renderedText, '｜圓周《ゑんしう》');
  assert.deepEqual([unit.historical.route, unit.historical.kana, unit.historical.disposition], ['sino', 'ゑんしう', 'AUTO']);
  // 法 (ほう) keeps the accepted はふ | ほふ ambiguity without usage context: candidates, no winner
  const law = await whole('法律', 'ruby-whole-explicit');
  assert.deepEqual([law.unit.historical.disposition, law.unit.historical.candidateReadings], ['CANDIDATES', ['はふりつ', 'ほふりつ']]);
  assert.ok(law.raw.spans.every((s: any) => s.state !== 'applied'), 'no candidate is applied');
});
