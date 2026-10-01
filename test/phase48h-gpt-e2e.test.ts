import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compileLexicalSourceSlice, type UniDicSourceSlice } from '../tools/lexical-compiler.ts';
import { loadJmdictIntake } from '../tools/jmdict-intake.ts';
import { compileJmdictLexicalGraph } from '../tools/jmdict-lexical-graph.ts';
import { buildLexicalSpanGraph, primarySpanPath, spansForPath } from '../tools/lexical-span-analysis.ts';
import { projectSinoDag } from '../tools/sino-dag-projection.ts';
import { resolveLexicalHistorical, lexemesForFormReading } from '../tools/lexical-historical-join.ts';
import { buildPhase48RuntimeBundle, createPhase48HotRuntime } from '../tools/phase48-hot-runtime.ts';

test('Phase 4.8 GPT lane connects accepted UniDic, JMdict and Sino DAG on real 学校 data', async () => {
  const unidic = JSON.parse(
    await readFile('data/lexical/sources/unidic-cwj-202512-first-slice.json', 'utf8')
  ) as UniDicSourceSlice;
  const lexicalArtifact = compileLexicalSourceSlice(unidic);

  const { extract, accounting } = await loadJmdictIntake(process.cwd());
  const lexicalGraph = compileJmdictLexicalGraph(extract, accounting);

  const sinoArtifact = JSON.parse(
    await readFile('data/historical/sino/phase46e-sino-kana.json', 'utf8')
  );
  const sinoGraph = projectSinoDag(sinoArtifact.componentRelations, 'phase46e-sino-table');

  const spans = buildLexicalSpanGraph('学校', lexicalArtifact, lexicalGraph);
  const primary = primarySpanPath(spans);
  assert.ok(primary);
  assert.deepEqual(spansForPath(spans, primary!).map((span) => span.text), ['学校']);

  const resolved = resolveLexicalHistorical(
    '学校', 'がっこう', lexicalGraph, sinoGraph, spans, []
  );
  assert.ok(resolved.lexemeIds.length > 0);
  assert.deepEqual(
    resolved.lexemeIds,
    lexemesForFormReading(lexicalGraph, '学校', 'がっこう')
  );
  assert.equal(resolved.readingDecision.status, 'resolved');
  assert.equal(resolved.readingDecision.selectedHistoricalReading, 'がくかう');

  const bundle = buildPhase48RuntimeBundle(lexicalGraph, sinoGraph);
  const hot = createPhase48HotRuntime(bundle.hot);
  assert.deepEqual(hot.lexemesForFormReading('学校', 'がっこう'), resolved.lexemeIds);
  const hotReading = hot.reconstructWord('学校', 'がっこう');
  assert.equal(hotReading?.status, 'resolved');
  assert.equal(hotReading && 'historicalReading' in hotReading ? hotReading.historicalReading : null, 'がくかう');
});

test('Phase 4.8 GPT hot measurement is real-data bounded and smaller than full compact graph', async () => {
  const [g, c] = await Promise.all([
    readFile('data/reports/phase48g-gpt-hot-runtime.json', 'utf8').then(JSON.parse),
    readFile('data/reports/phase48c-lexical-graph-measurements.json', 'utf8').then(JSON.parse)
  ]);
  assert.equal(g.source.jmdictEntries, c.counts.lexemes);
  assert.equal(g.source.sinoComponentRelations, c.sinoDag.sourceRelations);
  assert.equal(g.entities.sinoPatterns, c.sinoDag.primaryPatterns + c.sinoDag.derivedPatterns);
  assert.ok(g.sizes.hot.bytes < c.compactGraph.bytes);
  assert.ok(g.sizes.hot.gzipBytes < c.compactGraph.gzipBytes);
  assert.equal(g.benchmarkChecks.lexicalResults, 10000);
  assert.equal(g.benchmarkChecks.readingResults, 10000);
});
