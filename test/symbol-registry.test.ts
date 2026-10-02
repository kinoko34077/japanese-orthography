import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { atomStatistics, initialRegistry, SYMBOL_REGISTRY, updateRegistry, verifyAppendOnly, verifyRegistry, type AtomStats, type SymbolRegistry } from '../tools/symbol-registry.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';

// #211 B — append-only Symbol Registry (#208 §6, acceptance A).
const require = createRequire(import.meta.url);
const { atomsOf, createSymbolizer } = require('../runtime/symbol-registry-runtime.js');

const stats = (entries: Record<string, [number, number]>) => new Map<string, AtomStats>(Object.entries(entries).map(([a, [output, total]]) => [a, { output, total }]));

test('initial ids follow output frequency, then total frequency, then UTF-8 byte order', () => {
  const r = initialRegistry(stats({ 學: [5, 9], 学: [5, 9], の: [9, 9], 校: [5, 12], 漢: [0, 30] }));
  assert.deepEqual(r.atoms, ['の', '校', '学', '學', '漢']); // 学 (E5 AD A6) < 學 (E5 AD B8)
  verifyRegistry(r);
  assert.equal(r.generations.length, 1);
});

test('adding one atom appends exactly one id; old ids stay byte-identical and history is kept', () => {
  const first = initialRegistry(stats({ あ: [3, 3], い: [2, 2] }));
  const next = updateRegistry(first, stats({ あ: [3, 3], い: [2, 2], 圓: [9, 9] }));
  assert.deepEqual(next.atoms, ['あ', 'い', '圓'], 'a frequent newcomer is still appended, never re-ranked');
  assert.equal(next.generations.length, 2);
  assert.deepEqual(next.generations[0], first.generations[0]);
  verifyAppendOnly(first, next);
  assert.equal(updateRegistry(next, stats({ あ: [3, 3], い: [2, 2], 圓: [9, 9] })), next, 'no change -> same registry object');
});

test('removed atoms are tombstoned, ids are never reused, and a returning atom gets its own id back', () => {
  const first = initialRegistry(stats({ あ: [3, 3], い: [2, 2], う: [1, 1] }));
  const removed = updateRegistry(first, stats({ あ: [3, 3], う: [1, 1], え: [1, 1] }));
  assert.deepEqual(removed.atoms, ['あ', 'い', 'う', 'え']);
  assert.deepEqual(removed.tombstones, [2]);
  const back = updateRegistry(removed, stats({ あ: [3, 3], い: [2, 2], う: [1, 1], え: [1, 1] }));
  assert.deepEqual(back.atoms, removed.atoms);
  assert.deepEqual(back.tombstones, []);
  verifyAppendOnly(removed, back);
  const symbolizer = createSymbolizer(removed);
  assert.deepEqual(symbolizer.symbolize('い'), ['い'], 'a tombstoned atom is passed through, not resolved');
});

test('remap, reorder, shrink and duplicate atoms are rejected', () => {
  const first = initialRegistry(stats({ あ: [3, 3], い: [2, 2], う: [1, 1] }));
  const swapped: SymbolRegistry = { ...first, atoms: ['い', 'あ', 'う'] };
  assert.throws(() => verifyRegistry(swapped), /remapped or reordered/);
  assert.throws(() => verifyAppendOnly(first, { ...first, atoms: ['あ', 'い'], generations: [{ ...first.generations[0]!, size: 2, prefixSha256: '' }] }));
  assert.throws(() => verifyRegistry({ ...first, atoms: ['あ', 'あ', 'う'] }));
  const grown = updateRegistry(first, stats({ あ: [3, 3], い: [2, 2], う: [1, 1], え: [1, 1] }));
  assert.throws(() => verifyAppendOnly(grown, first), /shrank/);
});

test('unknown Unicode round-trips losslessly; variation sequences are one atom and never collapsed', () => {
  const ivs = '葛\u{E0100}';
  assert.deepEqual(atomsOf(`a${ivs}が`), ['a', ivs, 'が']);
  assert.deepEqual(atomsOf('が'), ['が'], 'a combining voiced mark stays with its base');
  const reg = initialRegistry(stats({ 葛: [1, 1], [ivs]: [1, 1], 学: [1, 1], 校: [1, 1] }));
  const s = createSymbolizer(reg);
  const text = '学校😀𠮷 abc 葛' + ivs;
  const tokens = s.symbolize(text);
  assert.equal(s.desymbolize(tokens), text);
  assert.notEqual(s.idOf(ivs), s.idOf('葛'));
  assert.ok(tokens.includes('😀') && tokens.includes('𠮷'), 'unknown atoms are raw passthrough tokens');
  assert.equal(s.sequenceOf('学校')!.length, 2);
  assert.equal(s.sequenceOf('学校😀'), null);
  assert.throws(() => s.desymbolize([999]), RangeError);
});

test('the committed registry is valid, append-only consistent and covers the accepted knowledge', async () => {
  const committed = JSON.parse(await readFile(new URL(`../${SYMBOL_REGISTRY}`, import.meta.url), 'utf8')) as SymbolRegistry;
  verifyRegistry(committed);
  const s = createSymbolizer(committed);
  for (const text of ['学校', '學校', 'ドイツ', '独逸', '独乙', 'がくかう', 'ヿ', '分る', '｜學校《がくかう》']) assert.ok(s.sequenceOf(text), text);
  // fixture knowledge is covered too, and its statistics only count accepted atoms
  for (const atom of atomStatistics(adapterFixture()).keys()) assert.notEqual(s.idOf(atom), null, atom);
});
