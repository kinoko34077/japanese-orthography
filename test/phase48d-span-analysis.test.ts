import assert from 'node:assert/strict';
import test from 'node:test';
import { createLexicalSpanAnalyzer, loadLexicalSpanAnalyzer } from '../tools/lexical-span-analysis.ts';

const analyzer = await loadLexicalSpanAnalyzer(process.cwd());
const spansOf = (text: string) => analyzer.analyze(text).spans;
const surfaces = (text: string) => spansOf(text).filter((s) => s.kind === 'lexical').map((s) => `${s.start}:${s.surface}`);

test('known text yields traceable lexical spans with typed lexeme candidates', () => {
  const span = spansOf('弁護士').find((s) => s.surface === '弁護士')!;
  assert.equal(span.kind, 'lexical');
  assert.deepEqual(span.candidates.map((c) => c.lexeme), ['lexeme:弁護士/べんごし']);
  assert.deepEqual(span.candidates[0]!.readings, ['reading-path:べんごし']);
  assert.match(span.candidates[0]!.sourceRefs[0]!, /^jmdict:2026-10-01:seq:\d+$/);
  assert.ok(span.candidates[0]!.categories.includes('category:jmdict-pos:n'));
});

test('the lattice keeps every overlapping candidate instead of committing to one tokenization', () => {
  const found = surfaces('勘弁護衛');
  for (const expected of ['0:勘弁', '1:弁護', '2:護衛', '0:勘']) assert.ok(found.includes(expected), `${expected} in ${found}`);
  const result = analyzer.analyze('勘弁護衛');
  // both readings of the string remain representable as complete paths
  const paths = result.paths(16).map((p) => p.map((s) => s.surface).join('+'));
  assert.ok(paths.includes('勘弁+護衛'));
  assert.ok(paths.includes('勘+弁護+衛'));
});

test('unknown spans are preserved and do not abort analysis', () => {
  const result = analyzer.analyze('弁護☃☃士衛');
  const unknown = result.spans.filter((s) => s.kind === 'unknown');
  assert.deepEqual(unknown.map((s) => s.surface), ['☃☃', '衛']);
  assert.ok(result.paths(4).length > 0);
  assert.deepEqual(analyzer.analyze('').spans, []);
});

test('reading-aligned composition identifies the 弁護 component of 弁護士/人/団 and 国選弁護士', () => {
  for (const [word, tail] of [['弁護士', '士'], ['弁護人', '人'], ['弁護団', '団']] as const) {
    const span = spansOf(word).find((s) => s.surface === word)!;
    const parts = span.candidates[0]!.compositions.map((c) => c.map((p) => `${p.surface}/${p.reading}`).join('+'));
    assert.ok(parts.some((p) => p.startsWith('弁護/べんご+') && p.includes(`${tail}/`)), `${word}: ${parts}`);
  }
  // 国選弁護士 is not a JMdict entry; the lattice still offers 国選 + 弁護士 (+ its 弁護 component)
  const paths = analyzer.analyze('国選弁護士').paths(32).map((p) => p.map((s) => s.surface).join('+'));
  assert.ok(paths.includes('国選+弁護士'));
  // no composition is invented without reading alignment
  const souteiSpan = spansOf('装丁').find((s) => s.surface === '装丁')!;
  assert.ok(souteiSpan.candidates[0]!.compositions.every((c) => c.map((p) => p.reading).join('') === 'そうてい'));
});

test('UniDic slice morphology is attached as evidence, never as semantic identity', () => {
  const span = spansOf('学校').find((s) => s.surface === '学校')!;
  assert.ok(span.morphology.length >= 1);
  assert.ok(span.morphology.every((m) => m.sourceRef === 'unidic-cwj:2025.12:lemma:8098'));
  assert.deepEqual(span.morphology[0]!.pos, ['名詞', '普通名詞', '一般', '*']);
  assert.ok(span.candidates.every((c) => c.lexeme.startsWith('lexeme:') && !c.lexeme.includes('unidic')));
});

test('analysis is deterministic and independent of index construction order', () => {
  const reversed = createLexicalSpanAnalyzer({ ...analyzer.sources, entries: [...analyzer.sources.entries].reverse() });
  for (const text of ['勘弁護衛', '国選弁護士', '学校の弁護団']) {
    assert.equal(JSON.stringify(reversed.analyze(text).spans), JSON.stringify(analyzer.analyze(text).spans));
  }
});
