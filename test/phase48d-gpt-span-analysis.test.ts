import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEntityGraph } from '../tools/lexical-entity-graph.ts';
import type { LexicalArtifact } from '../tools/lexical-compiler.ts';
import { buildLexicalSpanGraph, primarySpanPath, spansForPath } from '../tools/lexical-span-analysis.ts';

function fixtureArtifact(): LexicalArtifact {
  const rows = [
    ['国選','こくせん'], ['弁護','べんご'], ['士','し'], ['弁護士','べんごし'],
    ['勘弁','かんべん'], ['護衛','ごえい']
  ] as const;
  const lemmas = rows.map(([surface, reading], i) => ({
    lemmaIndex: i, sourceLemmaId: i + 1, lemma: surface, lForm: reading,
    lexicalReading: reading, lexicalOrigin: 'sino' as const,
    lexicalIdentity: `unidic:test:lemma:${i + 1}`
  }));
  const morphologies = [{
    morphologyId: 0,
    pos: ['名詞','普通名詞','一般','*'] as [string,string,string,string],
    cType: '*', cForm: '*'
  }];
  const candidates = rows.map(([, reading], lemmaIndex) => ({
    lemmaIndex, morphologyId: 0, modernReadings: [reading]
  }));
  const ordered = rows.map(([surface], i) => ({ surface, candidateOffset: i, candidateCount: 1 }))
    .sort((a,b) => a.surface < b.surface ? -1 : a.surface > b.surface ? 1 : 0);
  // candidate offsets must refer to the candidate array, so rebuild candidates in surface order.
  const candidatesBySurface = ordered.map((entry) => {
    const original = rows.findIndex(([surface]) => surface === entry.surface);
    return candidates[original]!;
  });
  const surfaceIndex = ordered.map((entry, i) => ({ surface: entry.surface, candidateOffset: i, candidateCount: 1 }));
  return {
    schemaVersion: '1', kind: 'japanese-orthography-lexical-artifact',
    compilerSemantics: 'unidic-cwj-pmin-slice-v1',
    source: { dictionary: 'UniDic-CWJ', version: 'test', lexCsvSha256: 'a'.repeat(64), lexicalNamespaceEvidence: 'test' },
    lexicalNamespaceId: 'b'.repeat(64), artifactContentId: 'c'.repeat(64), sections: [],
    lemmas, morphologies, candidates: candidatesBySurface, surfaceIndex, readingIndex: []
  };
}

function fixtureGraph() {
  const rows = [
    ['国選','こくせん'], ['弁護','べんご'], ['士','し'], ['弁護士','べんごし'],
    ['勘弁','かんべん'], ['護衛','ごえい']
  ];
  return buildEntityGraph({
    sources: [{ key: 'test', sourceClass: 'fixture' }],
    evidence: [], contexts: [], patterns: [], bindings: [],
    lexemes: rows.map(([form, reading]) => ({
      key: `${form}/${reading}`,
      forms: [form!], readings: [{ path: [reading!] }],
      categories: form === '弁護' ? ['jmdict-pos:noun'] : [], sourceRefs: []
    })),
    morphemes: [], relations: []
  });
}

test('span graph keeps whole-word and reusable component analyses without committing early', () => {
  const graph = buildLexicalSpanGraph('国選弁護士', fixtureArtifact(), fixtureGraph());
  const lexical = graph.spans.filter((s) => s.kind === 'lexical');
  assert.ok(lexical.some((s) => s.text === '弁護士'));
  const bengo = lexical.find((s) => s.text === '弁護')!;
  assert.ok(bengo);
  assert.deepEqual(bengo.candidates[0]!.categories, ['category:jmdict-pos:noun']);
  const whole = lexical.find((s) => s.text === '弁護士')!;
  const componentTexts = whole.componentPaths.map((ids) => ids.map((id) => graph.spans.find((s) => s.id === id)!.text));
  assert.ok(componentTexts.some((parts) => parts.join('|') === '弁護|士'));

  const primary = primarySpanPath(graph)!;
  assert.equal(primary.unknownCount, 0);
  assert.deepEqual(spansForPath(graph, primary).map((s) => s.text), ['国選', '弁護士']);
});

test('lexical evidence prefers 勘弁 + 護衛 while preserving the raw overlapping 弁護 span', () => {
  const graph = buildLexicalSpanGraph('勘弁護衛', fixtureArtifact(), fixtureGraph());
  assert.ok(graph.spans.some((s) => s.kind === 'lexical' && s.text === '弁護'));
  const primary = primarySpanPath(graph)!;
  assert.equal(primary.unknownCount, 0);
  assert.deepEqual(spansForPath(graph, primary).map((s) => s.text), ['勘弁', '護衛']);
  assert.ok(graph.paths.some((p) => p.unknownCount > 0));
});

test('unknown input remains traversable instead of aborting the lattice', () => {
  const graph = buildLexicalSpanGraph('未知X', fixtureArtifact(), fixtureGraph());
  const primary = primarySpanPath(graph)!;
  assert.equal(primary.unknownCount, 3);
  assert.equal(spansForPath(graph, primary).map((s) => s.text).join(''), '未知X');
});
