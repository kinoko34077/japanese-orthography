import assert from 'node:assert/strict';
import test from 'node:test';
import { stableSerialize } from '../tools/normalize.ts';
import { stableProfileSerialize } from '../tools/profile-normalize.ts';

test('canonical serializers use locale-independent UTF-16 code-unit ordering', () => {
  assert.equal(stableSerialize(['a', 'A']), '["A","a"]');
  assert.equal(stableSerialize({ a: 1, A: 2 }), '{"A":2,"a":1}');
  assert.equal(stableProfileSerialize({ a: 1, A: 2 }), '{"A":2,"a":1}');
});
