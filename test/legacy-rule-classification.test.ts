import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const BUCKETS = new Set([
  'generic_deterministic_candidate',
  'generic_lexical_contextual',
  'lexical_reconstruction',
  'kinotch_semantic_override',
  'kinotch_style_render',
  'preserve_exclusion',
  'unresolved'
]);

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

test('stage-60 classification admits nothing to generic authority', async () => {
  const doc = await json('data/profiles/kinotch/legacy-stage60-classification.json');
  assert.equal(doc.genericSafetyImplication, 'none');
  assert.equal(doc.source.blobSha, '5739a94e321d34e764e9faea7bfb3e0d743a94f1');
  assert.equal(doc.entries.length, 358);
  assert.equal(new Set(doc.entries.map((entry: any) => entry.from)).size, doc.entries.length);
  for (const entry of doc.entries) {
    assert.ok(BUCKETS.has(entry.bucket), entry.from);
    assert.equal(entry.admittedToGenericAuthority, false, entry.from);
    assert.equal(typeof entry.reason, 'string');
    assert.equal(entry.fromCodePoint, `U+${entry.from.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
    assert.equal(entry.toCodePoint, `U+${entry.to.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  }
});

test('normalization-unstable targets are never classified as generic', async () => {
  const doc = await json('data/profiles/kinotch/legacy-stage60-classification.json');
  for (const entry of doc.entries) {
    const unstable = entry.to.normalize('NFC') !== entry.to;
    assert.equal(unstable, entry.bucket === 'unresolved', entry.from);
  }
});

test('contextual characters stay out of the generic deterministic candidates', async () => {
  const doc = await json('data/profiles/kinotch/legacy-stage60-classification.json');
  const bucketOf = new Map(doc.entries.map((entry: any) => [entry.from, entry.bucket]));
  for (const char of ['台', '芸', '欠', '余', '予']) {
    assert.equal(bucketOf.get(char), 'generic_lexical_contextual', char);
  }
  const safe = await json('data/deterministic/safe-character-first-slice.json');
  for (const mapping of safe.mappings) {
    const bucket = bucketOf.get(mapping.modern);
    assert.ok(bucket === undefined || bucket === 'generic_deterministic_candidate', mapping.modern);
  }
});
