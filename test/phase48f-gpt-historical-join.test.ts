import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEntityGraph } from '../tools/lexical-entity-graph.ts';
import { projectSinoDag } from '../tools/sino-dag-projection.ts';
import { lexemesForFormReading, resolveLexicalHistorical } from '../tools/lexical-historical-join.ts';
import type { LexicalSpanGraph } from '../tools/lexical-span-analysis.ts';

const emptySpanGraph = (input: string): LexicalSpanGraph => ({
  schemaVersion: '1',
  kind: 'japanese-orthography-lexical-span-graph',
  input,
  spans: [],
  paths: []
});

function lexicalGraph() {
  return buildEntityGraph({
    sources: [{ key: 'jmdict-test', sourceClass: 'fixture' }],
    evidence: [], contexts: [], patterns: [], bindings: [], morphemes: [], relations: [],
    lexemes: [
      {
        key: '装丁/そうてい',
        forms: ['装丁','装幀','装釘','装訂'],
        readings: [{ path: ['そうてい'] }],
        categories: [],
        sourceRefs: ['jmdict:test:seq:1']
      },
      {
        key: '制限/せいげん',
        forms: ['甲','乙'],
        readings: [{ path: ['こう'] }],
        categories: [],
        sourceRefs: ['jmdict:test:seq:2']
      }
    ],
    restrictions: [{ lexeme: '制限/せいげん', reading: ['こう'], forms: ['甲'] }]
  });
}

test('JMdict form+reading identity joins accepted Sino DAG reconstruction for 装丁', () => {
  const lexical = lexicalGraph();
  const sino = projectSinoDag([
    { character: '装', modernReading: 'そう', context: null, historicalReadings: ['さう'], evidenceRefs: ['装:そう'] }
  ], 'sino-test');
  const result = resolveLexicalHistorical(
    '装丁', 'そうてい', lexical, sino, emptySpanGraph('装丁'), []
  );
  assert.equal(result.lexemeIds.length, 1);
  assert.equal(result.readingDecision.status, 'resolved');
  assert.deepEqual(result.readingDecision.historicalReadings, ['さうてい']);
  assert.equal(result.readingDecision.selectedHistoricalReading, 'さうてい');
  assert.equal(result.readingDecision.basis, 'generated_diachronic');
});

test('JMdict reading restrictions constrain form+reading identity', () => {
  const lexical = lexicalGraph();
  assert.equal(lexemesForFormReading(lexical, '甲', 'こう').length, 1);
  assert.equal(lexemesForFormReading(lexical, '乙', 'こう').length, 0);
});

test('法 keeps reverse-DAG candidates without context and resolves Buddhist context to ほふ', () => {
  const lexical = buildEntityGraph({
    sources: [{ key: 'jmdict-test', sourceClass: 'fixture' }],
    evidence: [], contexts: [], patterns: [], bindings: [], morphemes: [], relations: [],
    lexemes: [{ key: '法/ほう', forms: ['法'], readings: [{ path: ['ほう'] }], categories: [], sourceRefs: [] }]
  });
  const sino = projectSinoDag([
    { character: '法', modernReading: 'ほう', context: null, historicalReadings: ['はふ'], evidenceRefs: ['law'] },
    { character: '法', modernReading: 'ほう', context: '仏教用語', historicalReadings: ['ほふ'], evidenceRefs: ['buddhist'] }
  ], 'sino-test');
  const absent = resolveLexicalHistorical('法', 'ほう', lexical, sino, emptySpanGraph('法'), []);
  assert.equal(absent.readingDecision.status, 'candidates');
  assert.deepEqual(absent.readingDecision.historicalReadings, ['はふ','ほふ']);
  assert.equal(absent.readingDecision.selectedHistoricalReading, null);

  const buddhist = resolveLexicalHistorical(
    '法', 'ほう', lexical, sino, emptySpanGraph('法'), [], { context: '仏教用語' }
  );
  assert.equal(buddhist.readingDecision.status, 'resolved');
  assert.equal(buddhist.readingDecision.selectedHistoricalReading, 'ほふ');
  assert.equal(buddhist.readingDecision.basis, 'source_contextual');
  assert.equal(buddhist.readingDecision.selectionContext, '仏教用語');
});

test('path-level convergence reconstructs 文法 / ぶんぽう through the shared はふ class', () => {
  const lexical = buildEntityGraph({
    sources: [{ key: 'jmdict-test', sourceClass: 'fixture' }],
    evidence: [], contexts: [], patterns: [], bindings: [], morphemes: [], relations: [],
    lexemes: [{ key: '文法/ぶんぽう', forms: ['文法'], readings: [{ path: ['ぶんぽう'] }], categories: [], sourceRefs: [] }]
  });
  const sino = projectSinoDag([
    { character: '文', modernReading: 'ぶん', context: null, historicalReadings: ['ぶん'], evidenceRefs: ['bun'] },
    { character: '法', modernReading: 'ほう', context: null, historicalReadings: ['はふ'], evidenceRefs: ['law'] }
  ], 'sino-test');
  const result = resolveLexicalHistorical(
    '文法', 'ぶんぽう', lexical, sino, emptySpanGraph('文法'), []
  );
  assert.equal(result.readingDecision.status, 'resolved');
  assert.equal(result.readingDecision.selectedHistoricalReading, 'ぶんぱふ');
  assert.equal(result.readingDecision.basis, 'generated_diachronic');
});
