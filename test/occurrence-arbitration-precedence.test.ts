import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { arbitrate } = require('../runtime/occurrence-arbitration.js');

const candidate = (key: string, start: number, end: number, output: string, precedence = 0) => ({
  key, start, end, output, policy: 'anywhere', precedence
});

test('higher precedence overlay suppresses an overlapping generic candidate', () => {
  const result = arbitrate({
    length: 2,
    lexical: null,
    candidates: [
      candidate('generic', 0, 2, '思ひ', 0),
      candidate('profile', 0, 2, '思', 1)
    ]
  });
  assert.deepEqual(result.accepted.map((entry: any) => entry.key), ['profile']);
  assert.ok(result.blocked.some((entry: any) => entry.candidate.key === 'generic' && entry.reason === 'shadowed_by_higher_precedence'));
  assert.equal(result.unresolved.length, 0);
});

test('longer exact intent wins over contained profile component intents', () => {
  const result = arbitrate({
    length: 4,
    lexical: null,
    candidates: [
      candidate('left', 0, 2, '有', 1),
      candidate('whole', 0, 4, '有〻', 1),
      candidate('right', 2, 4, '有', 1)
    ]
  });
  assert.deepEqual(result.accepted.map((entry: any) => entry.key), ['whole']);
  assert.equal(result.unresolved.length, 0);
});

test('identity overlay can preserve a full span against a shorter rewrite', () => {
  const result = arbitrate({
    length: 4,
    lexical: null,
    candidates: [
      candidate('whole-preserve', 0, 4, '御報告', 1),
      candidate('inner', 2, 3, '吿', 1)
    ]
  });
  assert.deepEqual(result.accepted.map((entry: any) => entry.key), ['whole-preserve']);
  assert.equal(result.accepted[0].output, '御報告');
});
