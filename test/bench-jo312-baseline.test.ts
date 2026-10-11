import assert from 'node:assert/strict';
import test from 'node:test';
import { makeSyntheticText, runBoundedBaseline, sha256, summarizeTimes } from '../tools/bench-jo312-baseline.ts';

test('#314 synthetic corpus has exact UTF-16 length, stable checksum and explicit alternative text', () => {
  const a = makeSyntheticText(1000);
  const b = makeSyntheticText(1000);
  const different = makeSyntheticText(1000, true);
  assert.equal(a.length, 1000);
  assert.equal(a, b);
  assert.equal(sha256(a), sha256(b));
  assert.notEqual(sha256(a), sha256(different));
  assert.ok(a.includes('もちろん 学校'));
  assert.throws(() => makeSyntheticText(0), /invalid/);
  assert.throws(() => makeSyntheticText(100001), /invalid/);
  assert.throws(() => makeSyntheticText(1.5), /invalid/);
});

test('#314 p95 is a genuine quantile only for provided repeated observations', () => {
  assert.deepEqual(summarizeTimes([5, 1, 3, 2, 4]), { observations: 5, medianMs: 3, p95Ms: 5 });
  assert.throws(() => summarizeTimes([]), /invalid/);
  assert.throws(() => summarizeTimes([NaN]), /invalid/);
});

test('#314 bounded harness refuses unbounded cases before starting any subprocess', () => {
  assert.throws(() => runBoundedBaseline([100001]), /invalid/);
  assert.throws(() => runBoundedBaseline([0]), /invalid/);
  assert.throws(() => runBoundedBaseline([1000], 'unknown'), /invalid/);
  assert.throws(() => runBoundedBaseline([1000], 'kinotch-fixed', 100), /invalid/);
  assert.throws(() => runBoundedBaseline([1000], 'kinotch-fixed', 2000, 100000), /invalid/);
});
