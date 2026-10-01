import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyFullSizeSokuonPreference,
  expandIterationMarks,
  expandSpanIteration,
  foldKanaScript,
  renderIterationMarks,
  renderKanaScript,
  renderSpanIteration
} from '../tools/kana-orthography.ts';
import { KANA_CONVENTION_RULES, kanaConventionGraph } from '../tools/kana-rule-normalization.ts';
import { projectOrthography, type CanonicalOrthographyState } from '../tools/orthography-projection.ts';
import { validateOrthographyKnowledge } from '../tools/orthography-knowledge-model.ts';
import { normalizeAcceptedOrthographySources } from '../tools/orthography-source-normalization.ts';

const state = (reading: string, surface = '・'): CanonicalOrthographyState => ({
  lexicalIdentity: null, surface, reading, morphology: null, factIds: [], retainedDistinctions: {}
});
const modern = { period: 'modern' };

test('canonical ぢ and じ both project to modern じ while retained identity differs', () => {
  const graph = kanaConventionGraph();
  assert.deepEqual(validateOrthographyKnowledge(graph), []);
  const di = projectOrthography(state('はなぢ', '鼻血'), graph, modern);
  const zi = projectOrthography(state('はじ', '恥'), graph, modern);
  assert.equal(di.state.reading, 'はなじ');
  assert.equal(zi.state.reading, 'はじ');
  assert.equal(di.state.retainedDistinctions.reading, 'はなぢ');
  assert.equal(zi.state.retainedDistinctions.reading, undefined);
  const du = projectOrthography(state('みかづき'), graph, modern);
  assert.equal(du.state.reading, 'みかずき');
  assert.equal(du.state.retainedDistinctions.reading, 'みかづき');
  // ゐ/ゑ modernization runs from an already-established historical state only
  assert.equal(projectOrthography(state('ゐなか'), graph, modern).state.reading, 'いなか');
  // historical projection leaves the fine-grained state untouched
  assert.equal(projectOrthography(state('はなぢ'), graph, { period: 'historical' }).state.reading, 'はなぢ');
});

test('an external bare modern じ is never historically resolved by forward rules', () => {
  const graph = kanaConventionGraph();
  const result = projectOrthography(state('はじ'), graph, modern);
  assert.equal(result.state.reading, 'はじ');
  assert.equal(result.authority, 'identity');
  // no blanket inverse substitution exists in the rule set
  for (const rule of KANA_CONVENTION_RULES) {
    const pairs = rule.to.length === 1 ? rule.from.map((f) => [f, rule.to[0]]) : rule.from.map((f, i) => [f, rule.to[i]]);
    for (const [from, to] of pairs) assert.ok(!(['じ', 'ず', 'い', 'え'].includes(from!) && ['ぢ', 'づ', 'ゐ', 'ゑ'].includes(to!)), `${rule.id}: ${from}->${to}`);
  }
});

test('kana convention rules are ledgered first-class rules', async () => {
  const { graph } = await normalizeAcceptedOrthographySources(process.cwd());
  for (const rule of KANA_CONVENTION_RULES) assert.ok(graph.rules.some((r) => r.id === rule.id), rule.id);
  assert.equal(graph.dispositions.filter((d) => d.sourceRecordId.startsWith('derivation/kana-conventions#')).length, KANA_CONVENTION_RULES.length);
});

// --- frozen copies of the accepted Phase-4.7B behaviour (oracle for the wrappers) ---------------
const legacy = {
  fold: (v: string, f: boolean) => (f ? [...v].map((c) => (c === 'ヽ' ? 'ゝ' : c === 'ヾ' ? 'ゞ' : c >= 'ァ' && c <= 'ヶ' ? String.fromCodePoint(c.codePointAt(0)! - 0x60) : c)).join('') : v),
  sokuon: (v: string, same: boolean) => (same ? v.replaceAll('っ', 'つ').replaceAll('ッ', 'ツ') : v)
};
const SAMPLES = ['カタカナ', 'ひらがな', 'ヽヾゝゞ', 'まッた', 'がっこう', 'ヴァイオリン', 'ゐヰゑヱ', 'ー・。', 'ヷ'];

test('wrappers on the v2 rule path reproduce the accepted script fold and full-size sokuon behaviour', () => {
  for (const sample of SAMPLES) {
    for (const flag of [true, false]) {
      assert.equal(foldKanaScript(sample, { scriptFoldable: flag }), legacy.fold(sample, flag), `${sample} fold ${flag}`);
      assert.equal(applyFullSizeSokuonPreference(sample, { sameHistoricalRepresentation: flag }), legacy.sokuon(sample, flag), `${sample} sokuon ${flag}`);
    }
    assert.equal(renderKanaScript(renderKanaScript(sample, 'katakana'), 'hiragana'), renderKanaScript(sample, 'hiragana'));
  }
  // script-significant Katakana is bypassed when folding is not licensed
  assert.equal(foldKanaScript('カタカナ', { scriptFoldable: false }), 'カタカナ');
});

test('iteration rendering/expansion round-trips and keeps the accepted boundary errors', () => {
  for (const [expanded, rendered] of [['時時', '時々'], ['ここ', 'こゝ'], ['すず', 'すゞ'], ['ココ', 'コヽ'], ['スズ', 'スヾ']] as const) {
    assert.equal(renderIterationMarks(expanded), rendered);
    assert.equal(expandIterationMarks(rendered), expanded);
  }
  assert.equal(renderIterationMarks('時時', { boundaryOffsets: [1] }), '時時');
  assert.throws(() => expandIterationMarks('々'), /Iteration mark 々 cannot appear at render-unit start/);
  assert.throws(() => expandIterationMarks('時々', { boundaryOffsets: [1] }), /cannot appear at render-unit start/);
  assert.throws(() => expandIterationMarks('いろ〳〵'), /Span iteration marks require an explicit repeated span/);
  assert.equal(renderSpanIteration('いろいろ', 'いろ'), 'いろ〳〵');
  assert.equal(expandSpanIteration('いろ〳〵', 'いろ'), 'いろいろ');
  assert.throws(() => expandSpanIteration('〳〵', 'いろ'), /cannot appear at render-unit start/);
  assert.throws(() => expandSpanIteration('かな〳〵', 'いろ'), /does not follow the declared repeated span/);
});
