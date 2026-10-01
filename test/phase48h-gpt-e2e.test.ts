import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildEntityGraph } from '../tools/lexical-entity-graph.ts';
import { compileLexicalSourceSlice, type UniDicSourceSlice } from '../tools/lexical-compiler.ts';
import { loadJmdictIntake } from '../tools/jmdict-intake.ts';
import { compileJmdictLexicalGraph } from '../tools/jmdict-lexical-graph.ts';
import { buildLexicalSpanGraph, primarySpanPath, spansForPath } from '../tools/lexical-span-analysis.ts';
import { createSinoDagRuntime, projectSinoDag } from '../tools/sino-dag-projection.ts';
import { resolveLexicalHistorical, lexemesForFormReading } from '../tools/lexical-historical-join.ts';
import { buildPhase48RuntimeBundle, createPhase48HotRuntime } from '../tools/phase48-hot-runtime.ts';

const plain = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

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


test('Phase 4.8 GPT hot direct runtime matches canonical 4.6E authority for all component relations', async () => {
  const sinoArtifact = JSON.parse(
    await readFile('data/historical/sino/phase46e-sino-kana.json', 'utf8')
  );
  const sinoGraph = projectSinoDag(sinoArtifact.componentRelations, 'phase46e-sino-table');
  const canonical = createSinoDagRuntime(sinoGraph);
  const tinyLexical = buildEntityGraph({
    sources: [{ key: 'e2e', sourceClass: 'fixture' }],
    evidence: [], contexts: [], patterns: [], bindings: [],
    lexemes: [{ key: '法/ほう', forms: ['法'], readings: [{ path: ['ほう'] }], categories: [], sourceRefs: [] }],
    morphemes: [], relations: []
  });
  const hot = createPhase48HotRuntime(buildPhase48RuntimeBundle(tinyLexical, sinoGraph).hot);

  let checked = 0;
  for (const relation of sinoArtifact.componentRelations) {
    for (const query of [{}, { context: null }, { context: '仏教用語' }]) {
      assert.deepEqual(
        plain(hot.resolveDirect(relation.character, relation.modernReading, query)),
        plain(canonical.resolveDirect(relation.character, relation.modernReading, query)),
        JSON.stringify([relation.character, relation.modernReading, query])
      );
      checked += 1;
    }
  }
  assert.equal(checked, 6000);
  assert.deepEqual(hot.resolveDirect('法', 'ほう'), {
    status: 'candidates',
    historicalReadings: ['はふ', 'ほふ']
  });
  assert.equal((hot.resolveDirect('法', 'ほう', { context: '仏教用語' }) as any)?.historicalReading, 'ほふ');
  assert.deepEqual(
    plain(hot.resolveDirect('法', 'ほう', { context: '法律' })),
    plain(canonical.resolveDirect('法', 'ほう', { context: '法律' }))
  );
});

test('Phase 4.8 GPT hot word reconstruction matches canonical DAG across the accepted JMdict Sino set', async () => {
  const sinoArtifact = JSON.parse(
    await readFile('data/historical/sino/phase46e-sino-kana.json', 'utf8')
  );
  const sinoGraph = projectSinoDag(sinoArtifact.componentRelations, 'phase46e-sino-table');
  const canonical = createSinoDagRuntime(sinoGraph);
  const tinyLexical = buildEntityGraph({
    sources: [{ key: 'e2e', sourceClass: 'fixture' }],
    evidence: [], contexts: [], patterns: [], bindings: [],
    lexemes: [{ key: '文法/ぶんぽう', forms: ['文法'], readings: [{ path: ['ぶんぽう'] }], categories: [], sourceRefs: [] }],
    morphemes: [], relations: []
  });
  const hot = createPhase48HotRuntime(buildPhase48RuntimeBundle(tinyLexical, sinoGraph).hot);
  const { extract } = await loadJmdictIntake(process.cwd());
  const known = new Set(sinoArtifact.componentRelations.map((relation: any) => relation.character));

  let compared = 0;
  for (const entry of extract) {
    for (const written of entry.k ?? []) {
      const symbols = Array.from(written.t);
      if (symbols.length < 2 || symbols.length > 4 || !symbols.every((symbol) => known.has(symbol))) continue;
      for (const reading of entry.r) {
        if (reading.nokanji || (reading.restr && !reading.restr.includes(written.t))) continue;
        const queries = symbols.includes('法') ? [{}, { context: '仏教用語' }] : [{}];
        for (const query of queries) {
          assert.deepEqual(
            plain(hot.reconstructWord(written.t, reading.t, query)),
            plain(canonical.reconstructWord(written.t, reading.t, query)),
            `${written.t}/${reading.t}/${JSON.stringify(query)}`
          );
          compared += 1;
        }
      }
    }
  }
  assert.ok(compared > 15000, `compared ${compared}`);
});
