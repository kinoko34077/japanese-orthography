import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTarPatternCorpus } from '../tools/tar-pattern.ts';

test('TAR pattern corpus preserves all seven source cases with no silent drops', async () => {
  const corpus = await validateTarPatternCorpus(process.cwd());
  assert.equal(corpus.accounting.sourceCases, 7);
  assert.equal(corpus.accounting.wildcard, 6);
  assert.equal(corpus.accounting.regex, 1);
  assert.equal(corpus.accounting.dropped, 0);
  assert.equal(new Set(corpus.records.map((record) => record.sourceRuleId)).size, 7);
  assert.ok(corpus.records.every((record) => record.sourceEnabled && record.sourceCaseId.startsWith('tar:structured:')));
});

test('TAR pattern source keeps suffix wildcard and regex capture semantics distinct', async () => {
  const corpus = await validateTarPatternCorpus(process.cwd());
  const byFrom = (from: string) => corpus.records.find((record) => record.from === from);
  assert.deepEqual(byFrom('によ*')?.expectedPatterns, ['に依*', 'に因*']);
  assert.equal(byFrom('によ*')?.conditions && (byFrom('によ*')?.conditions as any).current.pos1, '格助詞');
  assert.deepEqual(byFrom('まず*')?.expectedPatterns, ['先ず*']);
  assert.equal((byFrom('まず*')?.conditions as any).current.pos, '副詞,接続詞');
  assert.equal(byFrom('(\\d{4})年(\\d{1,2})月(\\d{1,2})日')?.rawTo, '$1/$2/$3');
  assert.equal(byFrom('(\\d{4})年(\\d{1,2})月(\\d{1,2})日')?.regex, true);
});
