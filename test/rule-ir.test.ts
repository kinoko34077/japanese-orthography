import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { canonicalizeOrthographyKnowledge } from '../tools/orthography-knowledge-model.ts';
import { compileRuleIR, orderRules, RULE_IR_SUMMARY, RULE_STAGES, summarizeRuleIR, type IRRule } from '../tools/rule-ir.ts';
import { lexicalFixture } from './fixtures/browser-pack-fixture.ts';

// #211 D — Executable Rule IR (#208 §3–§4).
const P = { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] };
const graph = (() => {
  const g = lexicalFixture();
  const MOD = ['period:modern'];
  g.facts.push(
    { id: 'fact:literal_reading:学校|がくかう|', kind: 'literal_reading', lexicalRefs: ['lexeme:学校/がっこう'], surface: '学校', reading: 'がくかう', periodRefs: ['period:historical-kana'], tags: ['whole-word'], ...P },
    { id: 'fact:literal_form:分かる', kind: 'literal_form', lexicalRefs: ['lexeme:分かる/わかる'], surface: '分かる', periodRefs: MOD, ...P }
  );
  g.rules.push(
    { id: 'rule:sino:はふ>ほう', class: 'diachronic', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['はふ'], to: ['ほう'], dependencies: [], predicate: { channel: 'reading' }, ...P },
    { id: 'rule:char:學>学', class: 'orthographic', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['學'], to: ['学'], dependencies: [], predicate: { channel: 'surface' }, ...P }
  );
  g.bindings.push({ id: 'binding:sino:法:はふ>ほう@none', ruleId: 'rule:sino:はふ>ほう', lexicalRefs: ['symbol:法'], ...P });
  return canonicalizeOrthographyKnowledge(g);
})();
const ir = compileRuleIR(graph);
const find = (pred: (r: IRRule) => boolean) => ir.rules.filter(pred);

test('dictionary mappings are one-step exact rules; variants are branches (ドイツ -> 独逸 / 独乙, みる -> 見る / 観る / 診る)', () => {
  const [germany] = find((r) => r.kind === 'exact' && r.direction === 'reconstruct' && r.input === 'ドイツ');
  assert.deepEqual(germany!.branches.map((b) => b.output).sort(), ['独乙', '独逸']);
  assert.equal(germany!.stage, 'lexical');
  const [miru] = find((r) => r.direction === 'reconstruct' && r.input === 'みる');
  for (const form of ['見る', '観る', '診る']) assert.ok(miru!.branches.some((b) => b.output === form), form);
  assert.ok(miru!.branches.length >= 3, 'every lexical candidate is a branch; none is chosen');
});

test('productive rules are reusable nodes with binding-scoped instances (はふ -> ほう @ 法)', () => {
  const [node] = find((r) => r.ruleId === 'rule:sino:はふ>ほう');
  assert.deepEqual([node!.kind, node!.stage, node!.channel, node!.input, node!.branches.map((b) => b.output)], ['productive', 'diachronic', 'reading', 'ほう', ['はふ']]);
  const [binding] = find((r) => r.ruleId === 'binding:sino:法:はふ>ほう@none');
  assert.deepEqual([binding!.scope, binding!.lexicalScope, binding!.dependsOn], ['symbol', ['symbol:法'], ['rule:sino:はふ>ほう']]);
});

test('profile style rules run only where a profile enables them (こと -> ヿ, 分かる -> 分る)', () => {
  for (const [from, to] of [['こと', 'ヿ'], ['分かる', '分る']]) {
    const [rule] = find((r) => r.kind === 'profile-style' && r.input === from);
    assert.equal(rule!.branches[0]!.output, to);
    assert.deepEqual(rule!.enabledBy, ['kinotch-fixed']);
    assert.equal(rule!.origin, 'project_defined');
  }
});

test('学校: deterministic character rule, exact historical reading and contextual / preserve kinds are distinct rules', () => {
  const [char] = find((r) => r.kind === 'deterministic-char' && r.input === '学');
  assert.equal(char!.branches[0]!.output, '學');
  const [reading] = find((r) => r.kind === 'exact' && r.channel === 'reading' && r.direction === 'to-historical' && r.input === '学校');
  assert.equal(reading!.branches[0]!.output, 'がくかう');
  const [taifu] = find((r) => r.kind === 'contextual' && r.input === '台風');
  assert.deepEqual([taifu!.stage, taifu!.predicate, taifu!.branches[0]!.output], ['semantic', { constraint: 'constraint-taifu' }, '颱風']);
  const [shotei] = find((r) => r.kind === 'exact' && r.direction === 'to-historical' && r.input === '装丁');
  assert.deepEqual(shotei!.branches.map((b) => [b.output, b.candidate]), [['装幀', true], ['装釘', true]]);
});

test('every rule traces to canonical evidence; order is stage-monotonic; compilation is deterministic', () => {
  for (const r of ir.rules) assert.ok(r.canonicalIds.length && r.branches.length, r.ruleId);
  const stages = ir.rules.map((r) => RULE_STAGES.indexOf(r.stage));
  assert.deepEqual(stages, [...stages].sort((a, b) => a - b));
  const at = new Map(ir.order.map((id, i) => [id, i]));
  for (const r of ir.rules) for (const dep of r.dependsOn) assert.ok(at.get(dep)! < at.get(r.ruleId)!, `${dep} before ${r.ruleId}`);
  assert.equal(compileRuleIR(graph).digest, ir.digest);
});

test('the compiler fails closed on dangling dependencies, cycles and backward stage dependencies', () => {
  const base = (id: string, stage: IRRule['stage'], dependsOn: string[] = []): IRRule => ({
    ruleId: id, kind: 'productive', stage, direction: 'to-historical', channel: 'reading', scope: 'anywhere', input: 'x', branches: [{ output: 'y', candidate: false, canonicalId: id }],
    lexicalScope: [], predicate: null, origin: 'historically_attested', enabledBy: null, dependsOn, canonicalIds: [id], evidenceType: 't'
  });
  assert.throws(() => orderRules([base('a', 'diachronic', ['missing'])]), /unknown rule/);
  assert.throws(() => orderRules([base('a', 'diachronic', ['b']), base('b', 'diachronic', ['a'])]), /cycle/);
  assert.throws(() => orderRules([base('a', 'diachronic', ['b']), base('b', 'render')]), /later-stage/);
  const order = orderRules([base('b', 'diachronic', ['a']), base('a', 'diachronic'), base('c', 'lexical')]);
  assert.deepEqual([...order.keys()], ['c', 'a', 'b']);
});

test('the committed summary describes the accepted knowledge IR', async () => {
  const summary = JSON.parse(await readFile(new URL(`../${RULE_IR_SUMMARY}`, import.meta.url), 'utf8'));
  assert.equal(summary.rules, Object.values<number>(summary.byKind).reduce((a, b) => a + b, 0));
  assert.ok(summary.byKind.exact > 100000 && summary.byKind.productive > 2000);
  assert.ok(summary.multiBranchRules > 0);
  assert.equal(summarizeRuleIR(ir).rules, ir.rules.length);
});
