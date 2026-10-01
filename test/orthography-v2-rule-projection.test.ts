import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import type { OrthographyKnowledgeGraph, OrthographyRule } from '../tools/orthography-knowledge-model.ts';
import { compileRuleOrder, projectOrthography, type CanonicalOrthographyState } from '../tools/orthography-projection.ts';

const prov = { sourceRefs: ['src:test'], evidenceRefs: ['ev:test'] };
const rule = (id: string, extra: Partial<OrthographyRule> = {}): OrthographyRule => ({
  id, class: 'orthographic', directionality: 'forward_only', lossiness: 'lossless', from: ['x'], to: ['y'], dependencies: [], ...prov, ...extra
});

function graph(rules: OrthographyRule[], facts: OrthographyKnowledgeGraph['facts'] = []): OrthographyKnowledgeGraph {
  return {
    schemaVersion: '2', kind: 'japanese-orthography-knowledge-graph', lexicalNamespaceId: 'test',
    sources: [{ sourceId: 'src:test' }], facts, rules, bindings: [], dispositions: []
  };
}
const state = (surface: string, reading: string | null = null, extra: Partial<CanonicalOrthographyState> = {}): CanonicalOrthographyState => ({
  lexicalIdentity: null, surface, reading, morphology: null, factIds: [], retainedDistinctions: {}, ...extra
});

// 四つ仮名 merger (lossy) and a dependent render rule, plus a diachronic reading rule
const yotsugana = rule('rule:yotsugana-di', { lossiness: 'many_to_one', directionality: 'forward_infer_reverse', from: ['ぢ', 'じ'], to: ['じ'], predicate: { channel: 'reading' } });
const kau = rule('rule:sino:かう>こう', { class: 'diachronic', directionality: 'reverse_traversable', from: ['かう'], to: ['こう'], predicate: { channel: 'reading' } });
const render = rule('rule:render:katakana-z', { class: 'render', from: ['じ'], to: ['ジ'], dependencies: ['rule:yotsugana-di'], predicate: { channel: 'reading' } });

test('dependency and rule-class order beat storage order', () => {
  const forward = compileRuleOrder(graph([render, yotsugana, kau]), {});
  const reversed = compileRuleOrder(graph([kau, yotsugana, render]), {});
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward, ['rule:sino:かう>こう', 'rule:yotsugana-di', 'rule:render:katakana-z']);
  // an explicit dependency overrides class rank
  const early = rule('rule:render:early', { class: 'render' });
  const late = rule('rule:diachronic:late', { class: 'diachronic', dependencies: ['rule:render:early'] });
  assert.deepEqual(compileRuleOrder(graph([late, early]), {}), ['rule:render:early', 'rule:diachronic:late']);
});

test('dependency cycles fail closed', () => {
  const a = rule('rule:a', { dependencies: ['rule:b'] });
  const b = rule('rule:b', { dependencies: ['rule:a'] });
  assert.throws(() => compileRuleOrder(graph([a, b]), {}), /dependency cycle/);
});

test('disabled rules never fire and enabledRuleIds restricts the composition', () => {
  const g = graph([yotsugana, kau]);
  const off = projectOrthography(state('鼻血', 'はなぢ'), g, { disabledRuleIds: ['rule:yotsugana-di'] });
  assert.equal(off.state.reading, 'はなぢ');
  assert.ok(off.steps.every((s) => s.ruleId !== 'rule:yotsugana-di'));
  const only = compileRuleOrder(g, { enabledRuleIds: ['rule:sino:かう>こう'] });
  assert.deepEqual(only, ['rule:sino:かう>こう']);
});

test('predicate mismatch blocks with a reason', () => {
  const buddhist = rule('rule:ctx', { from: ['ほふ'], to: ['ほう'], predicate: { channel: 'reading', morphology: { usage: '仏教用語' } } });
  const periodBound = rule('rule:period', { from: ['ゐ'], to: ['い'], predicate: { channel: 'reading', period: 'modern' } });
  const result = projectOrthography(state('法', 'ほふゐ'), graph([buddhist, periodBound]), { period: 'historical' });
  assert.equal(result.state.reading, 'ほふゐ');
  assert.deepEqual(result.blockedRules, [
    { ruleId: 'rule:ctx', reason: 'predicate_mismatch:morphology' },
    { ruleId: 'rule:period', reason: 'predicate_mismatch:period' }
  ]);
  const ok = projectOrthography(state('法', 'ほふ', { morphology: { usage: '仏教用語' } }), graph([buddhist]), {});
  assert.equal(ok.state.reading, 'ほう');
});

test('many-to-one modernization changes the reading while retained distinctions survive', () => {
  const g = graph([yotsugana]);
  const di = projectOrthography(state('鼻血', 'はなぢ'), g, {});
  const zi = projectOrthography(state('恥', 'はぢ'.replace('ぢ', 'じ')), g, {});
  assert.equal(di.state.reading, 'はなじ');
  assert.equal(di.state.retainedDistinctions.reading, 'はなぢ');
  assert.equal(zi.state.reading, 'はじ');
  assert.equal(zi.state.retainedDistinctions.reading, undefined);
  assert.deepEqual(di.steps.map((s) => [s.ruleId, s.before.reading, s.after.reading]), [['rule:yotsugana-di', 'はなぢ', 'はなじ']]);
  assert.deepEqual(di.steps[0]!.evidenceRefs, ['ev:test']);
});

test('one-to-many rules cannot fire forward without a selection', () => {
  const split = rule('rule:split', { lossiness: 'one_to_many', from: ['う'], to: ['う', 'ふ'], predicate: { channel: 'reading' } });
  const result = projectOrthography(state('a', 'う'), graph([split]), {});
  assert.equal(result.state.reading, 'う');
  assert.deepEqual(result.blockedRules, [{ ruleId: 'rule:split', reason: 'one_to_many_requires_selection' }]);
});

test('a direct source fact coinciding with a generated result keeps stronger authority and both paths', () => {
  const fact = { id: 'fact:literal_reading:学校|がっこう|', kind: 'literal_reading' as const, lexicalRefs: ['lexeme:学校/がっこう'], surface: '学校', reading: 'がっこう', ...prov };
  const geminate = rule('rule:coda-gemination', { class: 'phonological', from: ['がくこう'], to: ['がっこう'], predicate: { channel: 'reading' } });
  const result = projectOrthography(state('学校', 'がくかう', { lexicalIdentity: 'lexeme:学校/がっこう' }), graph([kau, geminate], [fact]), {});
  assert.equal(result.state.reading, 'がっこう');
  assert.equal(result.authority, 'source_attested');
  assert.deepEqual(result.attestedBy, [fact.id]);
  assert.deepEqual(result.steps.map((s) => s.ruleId), ['rule:sino:かう>こう', 'rule:coda-gemination']);
  const unattested = projectOrthography(state('学校', 'がくかう'), graph([kau, geminate]), {});
  assert.equal(unattested.authority, 'generated');
});

test('browser/worker runtime projection is identical to the TS projection', async () => {
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile('runtime/orthography-projection-runtime.js', 'utf8'), sandbox);
  const g = graph([render, yotsugana, kau]);
  for (const s of [state('鼻血', 'はなぢ'), state('学校', 'がくかう'), state('恥', 'はじ')]) {
    for (const policy of [{}, { disabledRuleIds: ['rule:render:katakana-z'] }]) {
      assert.equal(JSON.stringify(sandbox.OrthographyProjectionRuntime.projectOrthography(s, g, policy)), JSON.stringify(projectOrthography(s, g, policy)));
    }
  }
});
