import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTarSimpleExactCorpus } from '../tools/tar-simple-exact.ts';
import { normalizeAcceptedOrthographySources } from '../tools/orthography-source-normalization.ts';
import { withProfileRules } from '../tools/orthography-policy.ts';
import { compileRuleIR } from '../tools/rule-ir.ts';

const corpusPromise = validateTarSimpleExactCorpus(process.cwd());

test('TAR simple-exact corpus freezes all 3,135 #285 FAIL cases as 3,132 TAR-origin relations', async () => {
  const corpus = await corpusPromise;
  assert.equal(corpus.records.length, 3132);
  assert.equal(corpus.accounting.baselineFailCases, 3135);
  assert.equal(corpus.accounting.uniqueRelations, 3132);
  assert.equal(corpus.accounting.uniqueInputs, 3132);
  assert.equal(corpus.accounting.conflictingInputs, 0);
  assert.equal(corpus.accounting.duplicateCaseExcess, 3);
  assert.deepEqual([...new Set(corpus.records.map((record: any) => record.origin))], ['tar']);
  assert.equal(corpus.records.reduce((sum: number, record: any) => sum + record.sourceCaseIds.length, 0), 3135);
  assert.ok(corpus.records.every((record: any) => record.sourceRefs.length > 0));
});

test('representative TAR exact relations retain their selected outputs', async () => {
  const corpus = await corpusPromise;
  const output = (input: string) => corpus.records.find((record: any) => record.from === input)?.to;
  assert.equal(output('与'), '與');
  assert.equal(output('Ａ'), 'A');
  assert.equal(output('アイスクリーム'), '冰菓子');
  assert.equal(output('企画'), '企劃');
  assert.equal(output('Bluetooth'), '靑齒');
});

test('all TAR simple-exact rules lower through Rule IR only for kinotch-fixed', async () => {
  const { graph } = await normalizeAcceptedOrthographySources(process.cwd());
  const ir = compileRuleIR(withProfileRules(graph));
  const rules = ir.rules.filter((rule) => rule.ruleId.startsWith('rule:tar:simple-exact:'));
  assert.equal(rules.length, 3132);
  for (const rule of rules) {
    assert.equal(rule.kind, 'profile-style');
    assert.equal(rule.stage, 'profile');
    assert.equal(rule.scope, 'anywhere');
    assert.equal(rule.origin, 'tar');
    assert.deepEqual(rule.enabledBy, ['kinotch-fixed']);
    assert.equal(rule.branches.length, 1);
  }
});
