import assert from 'node:assert/strict';
import test from 'node:test';

test('#342 decoded typed postings retain exact filter order without a detached JS array', () => {
  const packed = new Uint32Array([18, 3, 18, 27, 42, 3]);
  const view = packed.subarray(1, 5);
  assert.equal(view.buffer, packed.buffer, 'the posting is a zero-copy view');
  assert.deepEqual([...view], [3, 18, 27, 42]);
  for (const allowed of [new Set([18, 27]), new Set([3, 42]), new Set<number>()]) {
    const expected = [...view].filter((id) => allowed.has(id));
    const observed = view.filter((id) => allowed.has(id));
    assert.deepEqual([...observed], expected, 'candidate filtering must preserve order and duplicates');
  }
});

test('#342 a posting view remains stable under read-only scans', () => {
  const backing = new Uint32Array([2, 10, 5, 7, 2]);
  const view = backing.subarray(1, 4);
  const original = [...backing];
  const result = [];
  for (const programId of view) result.push(programId);
  assert.deepEqual(result, [10, 5, 7]);
  assert.deepEqual([...backing], original);
});
