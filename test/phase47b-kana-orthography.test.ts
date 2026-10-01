import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyFullSizeSokuonPreference,
  collapsePresentationCandidates,
  expandIterationMarks,
  expandSpanIteration,
  foldKanaScript,
  renderIterationMarks,
  renderKanaScript,
  renderSpanIteration
} from '../tools/kana-orthography.ts';

test('script folding is opt-in and preserves script-significant lexical forms', () => {
  assert.equal(foldKanaScript('アカウ', { scriptFoldable: true }), 'あかう');
  assert.equal(foldKanaScript('アカウ', { scriptFoldable: false }), 'アカウ');
  assert.equal(foldKanaScript('あゝ', { scriptFoldable: true }), 'あゝ');
  assert.equal(foldKanaScript('アヽ', { scriptFoldable: true }), 'あゝ');
});

test('script rendering restores a requested presentation without changing lexical policy', () => {
  assert.equal(renderKanaScript('あかう', 'hiragana'), 'あかう');
  assert.equal(renderKanaScript('あかう', 'katakana'), 'アカウ');
  assert.equal(renderKanaScript('あゝかゞ', 'katakana'), 'アヽカヾ');
});

test('single-character iteration marks and kanji 々 expand to canonical repeated text', () => {
  assert.equal(expandIterationMarks('あゝいふ'), 'ああいふ');
  assert.equal(expandIterationMarks('かゞ'), 'かが');
  assert.equal(expandIterationMarks('カヽ'), 'カカ');
  assert.equal(expandIterationMarks('カヾ'), 'カガ');
  assert.equal(expandIterationMarks('人々'), '人人');

  assert.throws(() => expandIterationMarks('ゝあ'), /render-unit start/);
  assert.throws(() => expandIterationMarks('々人'), /render-unit start/);
});

test('iteration rendering never creates a mark at render-unit start', () => {
  assert.equal(renderIterationMarks('ああいふ'), 'あゝいふ');
  assert.equal(renderIterationMarks('かが'), 'かゞ');
  assert.equal(renderIterationMarks('カカ'), 'カヽ');
  assert.equal(renderIterationMarks('カガ'), 'カヾ');
  assert.equal(renderIterationMarks('人人'), '人々');
  assert.equal(renderIterationMarks('あ'), 'あ');
});

test('span repetition requires an explicit repeated span instead of guessing its length', () => {
  assert.equal(renderSpanIteration('いろいろ', 'いろ'), 'いろ〳〵');
  assert.equal(expandSpanIteration('いろ〳〵', 'いろ'), 'いろいろ');
  assert.equal(renderSpanIteration('いろは', 'いろ'), 'いろは');
  assert.throws(() => expandSpanIteration('〳〵いろ', 'いろ'), /render-unit start/);
});

test('presentation-only variants collapse while retaining all attestations', () => {
  assert.deepEqual(
    collapsePresentationCandidates(['ああいふ', 'あゝいふ'], { scriptFoldable: true }),
    [{
      canonical: 'ああいふ',
      attestations: ['ああいふ', 'あゝいふ']
    }]
  );

  assert.deepEqual(
    collapsePresentationCandidates(['あかう', 'アカウ'], { scriptFoldable: true }),
    [{
      canonical: 'あかう',
      attestations: ['あかう', 'アカウ']
    }]
  );

  assert.deepEqual(
    collapsePresentationCandidates(['あかう', 'アカウ'], { scriptFoldable: false }),
    [{
      canonical: 'あかう',
      attestations: ['あかう']
    }, {
      canonical: 'アカウ',
      attestations: ['アカウ']
    }]
  );
});

test('full-size sokuon preference requires an explicit same-historical-representation gate', () => {
  assert.equal(
    applyFullSizeSokuonPreference('しょっちう', { sameHistoricalRepresentation: true }),
    'しよつちう'
  );
  assert.equal(
    applyFullSizeSokuonPreference('しょっちう', { sameHistoricalRepresentation: false }),
    'しょっちう'
  );
});
