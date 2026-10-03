import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { canonicalizeOrthographyKnowledge } from '../tools/orthography-knowledge-model.ts';
import { withProfileRules } from '../tools/orthography-policy.ts';
import { compilePrograms, createVM, RULE_PROGRAM_SUMMARY } from '../tools/rule-program-compiler.ts';
import { compileRuleIR, RULE_STAGES } from '../tools/rule-ir.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from '../tools/symbol-registry.ts';
import { lexicalFixture } from './fixtures/browser-pack-fixture.ts';

// #211 E — compact Rule ISA + VM (#208 §8, acceptance C).
const require = createRequire(import.meta.url);
const { OP } = require('../runtime/rule-program-vm.js');
const { createSymbolizer } = require('../runtime/symbol-registry-runtime.js');

const registry = JSON.parse(await readFile(new URL(`../${SYMBOL_REGISTRY}`, import.meta.url), 'utf8')) as SymbolRegistry;
const P = { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] };
const graph = (() => {
  const g = withProfileRules(lexicalFixture());
  g.facts.push(
    { id: 'fact:literal_reading:学校|がくかう|', kind: 'literal_reading', lexicalRefs: ['lexeme:学校/がっこう'], surface: '学校', reading: 'がくかう', periodRefs: ['period:historical-kana'], tags: ['whole-word'], ...P }
  );
  g.rules.push(
    { id: 'rule:sino:はふ>ほう', class: 'diachronic', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['はふ'], to: ['ほう'], dependencies: [], predicate: { channel: 'reading' }, ...P },
    { id: 'rule:sino:ほふ>ほう', class: 'diachronic', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['ほふ'], to: ['ほう'], dependencies: [], predicate: { channel: 'reading' }, ...P },
    { id: 'rule:char:學>学', class: 'orthographic', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['學'], to: ['学'], dependencies: [], predicate: { channel: 'surface' }, ...P }
  );
  g.bindings.push(
    { id: 'binding:sino:法:はふ>ほう@none', ruleId: 'rule:sino:はふ>ほう', lexicalRefs: ['symbol:法'], ...P },
    { id: 'binding:sino:法:ほふ>ほう@仏教用語', ruleId: 'rule:sino:ほふ>ほう', lexicalRefs: ['symbol:法'], contextRefs: ['context:usage:仏教用語'], ...P }
  );
  return canonicalizeOrthographyKnowledge(g);
})();
const ir = compileRuleIR(graph);
const refs = [...new Set(graph.facts.flatMap((f) => f.lexicalRefs))].sort();
const lexemeIds = new Map(refs.map((r, i) => [r, i]));
const programs = compilePrograms(ir, registry, (ref) => lexemeIds.get(ref) ?? null);
const vm = createVM(programs, registry);
const symbolizer = createSymbolizer(registry);
const lookup = (stage: string, direction: string, channel: string, text: string) => programs.index.get(`${stage}|${direction}|${channel}|${programs.pool.idOf.get(text)}`) ?? [];
const evidenceOf = (trace: number[]) => trace.map((p) => programs.evidence[p]!.ruleId);
const outputs = (r: { edges: Array<{ output: string; candidate: boolean }> }) => r.edges.map((e) => `${e.output}${e.candidate ? '?' : ''}`).sort();

test('the program set verifies (opcodes, operand ranges, END) and carries no type-name strings', () => {
  vm.verify();
  for (let p = 0; p < programs.count; p += 1) for (const word of programs.code[p]!) assert.equal(typeof word, 'number');
  assert.ok(programs.direct.filter(Boolean).length > 0 && programs.direct.some((d) => !d), 'both direct postings and bytecode exist');
});

test('exact one-step: ドイツ -> 独逸 / 独乙 candidates (direct posting), traced to canonical facts', () => {
  const [p] = lookup('lexical', 'reconstruct', 'reading', 'ドイツ');
  assert.equal(programs.direct[p!], true);
  const r = vm.run(p, { profileId: 'historical' });
  assert.deepEqual(outputs(r), ['独乙?', '独逸?']);
  assert.ok(programs.evidence[p!]!.canonicalIds.every((id) => id.startsWith('fact:literal_reading:')));
});

test('context/semantic candidates: みる -> 見る / 観る / 診る … stay candidates', () => {
  const [p] = lookup('lexical', 'reconstruct', 'reading', 'みる');
  const out = outputs(vm.run(p, { profileId: 'historical' }));
  for (const form of ['見る?', '観る?', '診る?']) assert.ok(out.includes(form), form);
});

test('productive chain: binding groups preserve omitted, null, qualified, and unrelated context semantics', () => {
  const programsFor = lookup('diachronic', 'to-historical', 'reading', 'ほう');
  const law = symbolizer.idOf('法');
  const omitted = Symbol('omitted');
  const run = (context: Record<string, unknown> | null | typeof omitted = omitted) => programsFor.map((p) => vm.run(p, {
    profileId: 'historical', symbol: law, ...(context === omitted ? {} : { context })
  })).filter((r) => r.edges.length);
  const plain = run();
  const bindingRuns = plain.filter((r) => evidenceOf(r.trace)[0]!.startsWith('binding:'));
  assert.deepEqual(bindingRuns.map((r) => outputs(r)).flat().sort(), ['はふ', 'ほふ']);
  assert.deepEqual(bindingRuns.map((r) => evidenceOf(r.edges[0]!.programs)).sort(), [
    ['binding:sino:法:はふ>ほう@none', 'rule:sino:はふ>ほう'],
    ['binding:sino:法:ほふ>ほう@仏教用語', 'rule:sino:ほふ>ほう']
  ].sort());
  const unqualified = run(null).filter((r) => evidenceOf(r.trace)[0]!.startsWith('binding:'));
  assert.deepEqual(unqualified.map((r) => outputs(r)).flat(), ['はふ']);
  const buddhist = run({ usage: '仏教用語' }).filter((r) => evidenceOf(r.trace)[0]!.startsWith('binding:'));
  assert.deepEqual(buddhist.map((r) => outputs(r)).flat(), ['ほふ']);
  const otherContext = run({ usage: '未知' }).filter((r) => evidenceOf(r.trace)[0]!.startsWith('binding:'));
  assert.equal(otherContext.length, 0);
  const other = programsFor.map((p) => vm.run(p, { profileId: 'historical', symbol: symbolizer.idOf('学') })).filter((r) => r.edges.length && evidenceOf(r.trace)[0]!.startsWith('binding:'));
  assert.equal(other.length, 0, 'a binding never applies to another character');
});

test('profile exact/style: こと -> ヿ and 分かる -> 分る only under KiNoTch', () => {
  for (const [from, to] of [['こと', 'ヿ'], ['分かる', '分る']]) {
    const [p] = lookup("profile", "to-modern", "surface", from!);
    assert.equal(programs.code[p!]![0], OP.TEST_PROFILE);
    assert.deepEqual(outputs(vm.run(p, { profileId: 'kinotch-fixed' })), [to]);
    assert.deepEqual(vm.run(p, { profileId: 'historical' }).edges, []);
  }
});

test('multi-step: 学校 -> 學校 -> ｜學校《がくかう》 through programs of three stages, every step traceable', () => {
  const steps: string[] = [];
  // orthographic stage, per symbol (deterministic character programs)
  let surface = '';
  for (const atom of symbolizer.symbolize('学校').map((t: number | string) => (typeof t === 'number' ? symbolizer.atomOf(t) : t))) {
    const [p] = lookup('orthographic', 'to-historical', 'surface', atom);
    if (p === undefined) { surface += atom; continue; }
    const r = vm.run(p, { profileId: 'historical' });
    surface += r.edges[0]!.output;
    steps.push(...evidenceOf(r.trace));
  }
  // diachronic stage: the historical reading of the written form, scoped to its lexeme
  const [readingProgram] = lookup('diachronic', 'to-historical', 'reading', '学校');
  const reading = vm.run(readingProgram, { profileId: 'historical', lexemes: new Set([lexemeIds.get('lexeme:学校/がっこう')!]) });
  steps.push(...evidenceOf(reading.trace));
  assert.equal(vm.run(readingProgram, { profileId: 'historical', lexemes: new Set([lexemeIds.get('lexeme:楽校/がっこう')!]) }).edges.length, 0, 'lexeme-scoped');
  assert.equal(vm.run(readingProgram, { profileId: 'historical', lexemes: new Set([lexemeIds.get('lexeme:学校/がっこう')!, lexemeIds.get('lexeme:楽校/がっこう')!]) }).edges.length, 0, 'partial unresolved hypotheses stay blocked');
  // render stage (late Ruby render)
  const rendered = `｜${surface}《${reading.edges[0]!.output}》`;
  assert.equal(surface, '學校');
  assert.equal(rendered, '｜學校《がくかう》');
  assert.deepEqual(steps.map((s) => s.split(':')[0]), ['rule', 'ir']);
  assert.ok(RULE_STAGES.indexOf('orthographic') > RULE_STAGES.indexOf('lexical'));
});

test('the verifier fails closed on bad opcodes, ranges, unknown calls and missing END', () => {
  const bad = (code: number[]) => {
    const p = { ...programs, direct: [false], code: [code], outputs: [[]], flags: [[]], count: 1 };
    return () => createVM(p as typeof programs, registry).verify();
  };
  assert.throws(bad([99, OP.END]), /unknown opcode/);
  assert.throws(bad([OP.EMIT, 10_000_000, 0, OP.END]), /unknown SequenceId/);
  assert.throws(bad([OP.CALL, 5, OP.END]), /unknown program/);
  assert.throws(bad([OP.EMIT, 0, 0]), /does not END/);
  assert.throws(bad([OP.TEST_PRED]), /truncated/);
});

test('the committed program summary describes the accepted knowledge', async () => {
  const summary = JSON.parse(await readFile(new URL(`../${RULE_PROGRAM_SUMMARY}`, import.meta.url), 'utf8'));
  assert.equal(summary.programs, summary.directPrograms + summary.bytecodePrograms);
  assert.ok(summary.directPrograms > 100000, 'exact one-step rules are lowered to direct postings');
  assert.ok(summary.sections.programs.bytes > 0 && summary.sections.pool.bytes > 0);
});
