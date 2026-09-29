import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCheckoutText } from '../tools/verification-text.ts';

test('checkout text normalization treats only CRLF as canonical LF', () => {
  assert.equal(normalizeCheckoutText('a\r\nb\r\n'), 'a\nb\n');
  assert.equal(normalizeCheckoutText('a\nb\n'), 'a\nb\n');
  assert.equal(normalizeCheckoutText('a\rb\r'), 'a\rb\r');
});

test('checkout text normalization does not hide semantic drift', () => {
  assert.notEqual(normalizeCheckoutText('expected\r\n'), normalizeCheckoutText('changed\n'));
});
