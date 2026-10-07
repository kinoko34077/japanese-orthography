import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateTarContextCorpus } from '../tools/tar-context.ts';
import { normalizeAcceptedOrthographySources } from '../tools/orthography-source-normalization.ts';
import { withProfileRules } from '../tools/orthography-policy.ts';
import { compileRuleIR } from '../tools/rule-ir.ts';
import { compilePrograms, createVM } from '../tools/rule-program-compiler.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from '../tools/symbol-registry.ts';

const corpusPromise = validateTarContextCorpus(process.cwd());

test('TAR context corpus freezes all 670 typed source cases with zero drop', async () => {
  const corpus = await corpusPromise;
  assert.equal(corpus.records.length, 670);
  assert.equal(corpus.accounting.sourceCases, 670);
  assert.equal(corpus.accounting.dropped, 0);
  assert.equal(corpus.accounting.axisCounts.matchOptions, 288);
  assert.equal(corpus.accounting.axisCounts.matchTarget, 40);
  assert.equal(corpus.accounting.axisCounts.sequence, 10);
  assert.equal(corpus.accounting.axisCounts.ruleType, 43);
  assert.ok(corpus.accounting.axisCounts.conditions > 0);
  assert.deepEqual([...new Set(corpus.records.map((record: any) => record.origin))], ['tar']);
  assert.equal(new Set(corpus.records.map((record: any) => record.sourceCaseId)).size, 670);
  assert.ok(corpus.records.every((record: any) => record.sourceRefs.length > 0));
});

test('representative context rules retain distinct typed semantics', async () => {
  const corpus = await corpusPromise;
  const find = (from: string, to: string) =>
    corpus.records.filter((record: any) => record.from === from && record.to === to);

  assert.equal(find('よう', '様')[0]?.conditions?.current?.pos, '名詞');
  assert.equal(find('まま', '儘')[0]?.conditions?.current?.pos1, '非自立');
  assert.equal(find('まま', '間々')[0]?.conditions?.current?.pos, '副詞');
  assert.equal(find('なる', '成る')[0]?.matchTarget, 'basic_form');
  assert.equal(find('なる', '成る')[0]?.ruleType, 'verb');
  assert.ok(Array.isArray(find('面倒ごと', '面倒事')[0]?.sequence));
});

test('all 670 TAR context records lower to kinotch-fixed profile Rules with typed predicates', async () => {
  const { graph } = await normalizeAcceptedOrthographySources(process.cwd());
  const ir = compileRuleIR(withProfileRules(graph));
  const rules = ir.rules.filter((rule) => rule.ruleId.startsWith('rule:tar:context:'));
  assert.equal(rules.length, 670);
  for (const rule of rules) {
    assert.equal(rule.kind, 'profile-style');
    assert.equal(rule.stage, 'profile');
    assert.equal(rule.scope, 'whole-token');
    assert.equal(rule.origin, 'tar');
    assert.deepEqual(rule.enabledBy, ['kinotch-fixed']);
    assert.ok(rule.predicate?.tokenContext);
    assert.equal(rule.branches.length, 1);
  }
});

test('Rule Program TEST_PRED preserves TAR POS/basic-form/sequence semantics fail-closed', async () => {
  const registry = JSON.parse(await readFile(new URL(`../${SYMBOL_REGISTRY}`, import.meta.url), 'utf8')) as SymbolRegistry;
  const rule = (id: string, input: string, output: string, tokenContext: Record<string, unknown>) => ({
    ruleId: id,
    kind: 'profile-style',
    stage: 'profile',
    direction: 'to-modern',
    channel: 'surface',
    scope: 'whole-token',
    input,
    branches: [{ output, candidate: false, canonicalId: id }],
    lexicalScope: [],
    predicate: { tokenContext },
    dependsOn: [],
    enabledBy: ['kinotch-fixed'],
    sourceRefs: ['migrations/tar/context-rules.json'],
    evidenceRefs: [id],
    canonicalIds: [id],
    evidenceType: 'tar-context-test',
    origin: 'tar'
  });
  const rules: any[] = [
    rule('rule:tar:test:mama-noun', 'まま', '儘', {
      from: 'まま', conditions: { current: { pos: '名詞', pos1: '非自立' } }
    }),
    rule('rule:tar:test:mama-adverb', 'まま', '間々', {
      from: 'まま', conditions: { current: { pos: '副詞' } }
    }),
    rule('rule:tar:test:you', 'よう', '様', {
      from: 'よう', conditions: { current: { pos: '名詞', pos1: '非自立' } }
    }),
    rule('rule:tar:test:naru', 'なる', '成る', {
      from: 'なる', ruleType: 'verb', matchTarget: 'basic_form',
      conditions: { current: { basic: 'なる', pos: '動詞', pos1: '自立' } }
    }),
    rule('rule:tar:test:mendougoto', '面倒ごと', '面倒事', {
      from: '面倒ごと',
      sequence: [{ pos: '名詞', surface: '面倒' }, { pos: '名詞', surface: 'ごと' }]
    })
  ];
  const ir: any = { rules, order: rules.map((r) => r.ruleId), digest: 'tar-context-test' };
  const programs = compilePrograms(ir, registry, () => null);
  const vm = createVM(programs, registry);
  vm.verify();
  const run = (input: string, tokenWindow: any) => {
    const seq = programs.pool.idOf.get(input);
    assert.notEqual(seq, undefined);
    const ids = programs.index.get(`profile|to-modern|surface|${seq}`) ?? [];
    return ids.flatMap((id) => vm.run(id, { profileId: 'kinotch-fixed', context: { tokenWindow } }).edges.map((edge: { output: string }) => edge.output));
  };
  const token = (surface: string, basic: string, pos: string, pos1 = '') => ({
    surface_form: surface, basic_form: basic, pos, pos_detail_1: pos1,
    pos_detail_2: '', pos_detail_3: '', conjugated_type: '', conjugated_form: '', reading: ''
  });

  assert.deepEqual(run('まま', { tokens: [token('まま', 'まま', '名詞', '非自立')], index: 0 }), ['儘']);
  assert.deepEqual(run('まま', { tokens: [token('まま', 'まま', '副詞')], index: 0 }), ['間々']);
  assert.deepEqual(run('よう', { tokens: [token('よう', 'よう', '名詞', '非自立')], index: 0 }), ['様']);
  assert.deepEqual(run('よう', { tokens: [token('よう', 'よう', '助動詞')], index: 0 }), []);
  assert.deepEqual(run('なる', { tokens: [token('なる', 'なる', '動詞', '自立')], index: 0 }), ['成る']);
  assert.deepEqual(run('なる', { tokens: [token('なる', 'なる', '名詞')], index: 0 }), []);
  assert.deepEqual(run('面倒ごと', {
    tokens: [token('面倒', '面倒', '名詞'), token('ごと', 'ごと', '名詞')],
    index: 0
  }), ['面倒事']);
  assert.deepEqual(run('面倒ごと', {
    tokens: [token('面倒', '面倒', '形容詞'), token('ごと', 'ごと', '名詞')],
    index: 0
  }), []);
});
