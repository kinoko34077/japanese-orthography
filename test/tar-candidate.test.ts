import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTarCandidateCorpus } from '../tools/tar-candidate.ts';
import { normalizeAcceptedOrthographySources } from '../tools/orthography-source-normalization.ts';
import { KINOTCH_PROFILE, withProfileRules } from '../tools/orthography-policy.ts';
import { compileRuleIR } from '../tools/rule-ir.ts';

const corpusPromise = validateTarCandidateCorpus(process.cwd());

test('TAR candidate corpus freezes all 165 cases with zero drop', async () => {
  const corpus = await corpusPromise;
  assert.equal(corpus.records.length, 165);
  assert.equal(corpus.accounting.explicitAlternativeCases, 44);
  assert.equal(corpus.accounting.conflictSourceCases, 120);
  assert.equal(corpus.accounting.conflictGroups, 60);
  assert.equal(corpus.accounting.executableCandidateCases, 164);
  assert.equal(corpus.accounting.reviewRequiredCases, 1);
  assert.equal(corpus.accounting.dropped, 0);
  assert.equal(new Set(corpus.records.map((record: any) => record.sourceCaseId)).size, 165);
  assert.ok(corpus.records.every((record: any) => record.origin === 'tar' && record.sourceRefs.length > 0));
});

test('same-input conflict groups preserve both source intents without selecting a winner', async () => {
  const corpus = await corpusPromise;
  const group = (input: string) => corpus.groups.find((row: any) => row.input === input);
  assert.deepEqual(new Set(group('ごらん')?.outputs), new Set(['御覽', '御覧']));
  assert.deepEqual(new Set(group('ひらがな')?.outputs), new Set(['平假名', '平仮名']));
  assert.deepEqual(new Set(group('消却')?.outputs), new Set(['銷卻', '銷却']));
  assert.deepEqual(new Set(group('発酵')?.outputs), new Set(['醱酵', '醗酵']));
  for (const row of corpus.groups) {
    assert.equal(row.sourceCaseIds.length, 2);
    assert.equal(row.outputs.length, 2);
  }
});

test('explicit alternatives retain source order and typed applicability', async () => {
  const corpus = await corpusPromise;
  const records = corpus.records as any[];
  const nao = records.find((record) => record.from === 'なお' && record.expectedOutputs.length === 2);
  const tada = records.find((record) => record.from === 'ただ' && record.expectedOutputs.length === 3);
  const meguru = records.find((record) => record.from === 'めぐる' && record.expectedOutputs.length === 2);
  assert.deepEqual(nao?.expectedOutputs, ['尚', '猶']);
  assert.deepEqual(tada?.expectedOutputs, ['徒', '唯', '只']);
  assert.equal(tada?.conditions?.current?.pos, '接続詞');
  assert.deepEqual(meguru?.expectedOutputs, ['巡る', '廻る']);
  assert.equal(meguru?.ruleType, 'verb');
  assert.equal(meguru?.matchTarget, 'basic_form');
});

test('empty replacement intent is preserved as review-required and is not executable', async () => {
  const corpus = await corpusPromise;
  const deletion = (corpus.records as any[]).find((record) => record.from === 'おんぷ');
  assert.equal(deletion?.candidateKind, 'review-empty-output');
  assert.equal(deletion?.runtimeDisposition, 'review-required');
  assert.deepEqual(deletion?.expectedOutputs, []);
  assert.match(deletion?.sourceCaseId ?? '', /90-review-needed\.json/);
});


test('104 TAR candidate Rules lower to 216 candidate branches only for kinotch-fixed', async () => {
  const { graph } = await normalizeAcceptedOrthographySources(process.cwd());
  const ir = compileRuleIR(withProfileRules(graph));
  const rules = ir.rules.filter((rule) => rule.ruleId.startsWith('rule:tar:candidate'));
  assert.equal(rules.length, 104);
  assert.equal(rules.reduce((sum, rule) => sum + rule.branches.length, 0), 216);
  for (const rule of rules) {
    assert.equal(rule.kind, 'profile-style');
    assert.equal(rule.stage, 'profile');
    assert.equal(rule.scope, 'whole-token');
    assert.equal(rule.origin, 'tar');
    assert.deepEqual(rule.enabledBy, [KINOTCH_PROFILE.profileId]);
    assert.ok(rule.branches.length >= 2);
    assert.ok(rule.branches.every((branch) => branch.candidate));
  }

  const gorann = rules.find((rule) => rule.input === 'ごらん');
  assert.deepEqual(new Set(gorann?.branches.map((branch) => branch.output)), new Set(['御覽', '御覧']));

  const tada = rules.find((rule) => rule.input === 'ただ');
  assert.deepEqual(tada?.branches.map((branch) => branch.output), ['徒', '唯', '只']);
  const tadaContext = tada?.predicate?.tokenContext as any;
  assert.equal(tadaContext?.conditions?.current?.pos, '接続詞');

  const meguru = rules.find((rule) => rule.input === 'めぐる');
  assert.deepEqual(meguru?.branches.map((branch) => branch.output), ['巡る', '廻る']);
  assert.equal(meguru?.predicate?.tokenContext?.ruleType, 'verb');
  assert.equal(meguru?.predicate?.tokenContext?.matchTarget, 'basic_form');

  const deletion = graph.dispositions.find((entry) =>
    entry.disposition === 'excluded_with_reason'
    && entry.reason?.includes('empty replacement/deletion intent'));
  assert.ok(deletion);
  assert.match(deletion!.sourceRecordId, /tar:candidate:/);
  assert.equal(rules.some((rule) => rule.input === 'おんぷ'), false);
});
