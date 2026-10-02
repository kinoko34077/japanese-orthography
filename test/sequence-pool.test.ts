import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { buildSequencePool, compareEncodings, ENCODINGS, orthographicTexts, SEQUENCE_ENCODING_REPORT } from '../tools/sequence-pool.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from '../tools/symbol-registry.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';

// #211 C — Sequence Pool (#208 §7, acceptance B) + encoding comparison (§6.6, §16.2).
const require = createRequire(import.meta.url);
const { decodeSection } = require('../runtime/browser-pack-binary.js');
const { createSequencePool } = require('../runtime/sequence-pool-runtime.js');
const { createSymbolizer } = require('../runtime/symbol-registry-runtime.js');

const registry = JSON.parse(await readFile(new URL(`../${SYMBOL_REGISTRY}`, import.meta.url), 'utf8')) as SymbolRegistry;
const texts = ['学校', '學校', 'ドイツ', '独逸', '独乙', 'がっこう', 'がくかう', '学校', 'ドイツ', '｜學校《がくかう》'];

test('学校 / 學校 / ドイツ / 独逸 / kana are SymbolId sequences, each interned once, restored exactly', () => {
  const pool = buildSequencePool(texts, registry);
  assert.equal(pool.sequences.length, new Set(texts).size, 'duplicates are interned once');
  const runtime = createSequencePool(decodeSection(pool.section), registry.atoms);
  for (const t of new Set(texts)) {
    const id = pool.idOf.get(t)!;
    assert.equal(runtime.text(id), t);
    assert.equal(runtime.find(createSymbolizer(registry).sequenceOf(t)), id, 'lookup by symbols, no Unicode key');
  }
  assert.equal(runtime.find([registry.atoms.length]), -1);
  assert.throws(() => runtime.text(pool.sequences.length), RangeError);
  // deterministic: order is by symbols, independent of input order
  assert.deepEqual(buildSequencePool([...texts].reverse(), registry).sequences, pool.sequences);
});

test('a text outside the registry is rejected at build time (no lossy pool entries)', () => {
  assert.throws(() => buildSequencePool(['学校😀'], registry), /outside the Symbol Registry/);
});

test('every encoding round-trips the same sequences', () => {
  const pool = buildSequencePool(orthographicTexts(adapterFixture()), registry);
  for (const [name, encode] of Object.entries(ENCODINGS)) {
    const e = encode(pool.sequences, registry.atoms.length);
    assert.deepEqual(e.decode(), pool.sequences, name);
    assert.equal(e.scan(), pool.sequences.flat().reduce((a, b) => a + b, 0), name);
  }
  const report = compareEncodings(orthographicTexts(adapterFixture()), registry);
  assert.equal(report.choice.encoding, 'fixed-uint16');
});

test('the committed comparison measured the accepted dataset and every SymbolId encoding beats UTF-8', async () => {
  const report = JSON.parse(await readFile(new URL(`../${SEQUENCE_ENCODING_REPORT}`, import.meta.url), 'utf8'));
  assert.equal(report.registry.size, registry.atoms.length);
  assert.ok(report.dataset.distinctSequences > 400000);
  const utf8 = report.encodings['utf8-strings'];
  for (const name of ['fixed-uint16', 'short-id-escape', 'varint']) {
    assert.ok(report.encodings[name].bytes < utf8.bytes, name);
    assert.ok(report.encodings[name].gzipBytes < utf8.gzipBytes, name);
  }
  assert.equal(report.choice.encoding, 'fixed-uint16');
});
