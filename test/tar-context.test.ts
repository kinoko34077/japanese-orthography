import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTarContextCorpus } from '../tools/tar-context.ts';

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
