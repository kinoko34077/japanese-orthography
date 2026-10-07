import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { assemble } = require('../runtime/browser-span-planner.js');

const wholeLexeme = (length: number) => ({
  dag: {
    length,
    edges: [{
      start: 0,
      end: length,
      internal: [],
      units: [{ start: 0, end: length, lexemes: [], morphology: null }]
    }]
  }
});

test('deterministic whole-span winner survives candidate alternatives on the same occurrence', () => {
  const text = '装丁';
  const raw = assemble(text, 'kinotch-fixed', wholeLexeme(text.length), [
    { start: 0, end: text.length, output: '裝幀', policy: 'anywhere', origin: 'program', ref: 'deterministic', candidate: false, precedence: 1 },
    { start: 0, end: text.length, output: '装釘', policy: 'whole_lexeme', origin: 'program', ref: 'candidate-a', candidate: true, precedence: 1 },
    { start: 0, end: text.length, output: '装幀', policy: 'whole_lexeme', origin: 'program', ref: 'candidate-b', candidate: true, precedence: 1 }
  ], []);

  assert.equal(raw.renderedText, '裝幀');
  assert.equal(raw.spans.length, 1);
  assert.equal(raw.spans[0].status ?? raw.spans[0].state, 'applied');
  assert.equal(raw.spans[0].winners.some((row: any) => row.ref === 'deterministic'), true);
  assert.deepEqual(
    new Set(raw.spans[0].blocked.filter((row: any) => row.reason === 'candidate_alternative').map((row: any) => row.output)),
    new Set(['装釘', '装幀'])
  );
});

test('candidate-only whole-span alternatives remain unresolved rather than choosing a silent winner', () => {
  const text = 'ごらん';
  const raw = assemble(text, 'kinotch-fixed', wholeLexeme(text.length), [
    { start: 0, end: text.length, output: '御覽', policy: 'whole_lexeme', origin: 'program', ref: 'candidate-a', candidate: true, precedence: 1 },
    { start: 0, end: text.length, output: '御覧', policy: 'whole_lexeme', origin: 'program', ref: 'candidate-b', candidate: true, precedence: 1 }
  ], []);

  assert.equal(raw.renderedText, text);
  assert.equal(raw.spans.length, 1);
  assert.equal(raw.spans[0].status ?? raw.spans[0].state, 'unresolved');
  assert.ok(raw.spans[0].reasons.includes('conflicting_productive_outputs'));
});
