import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { loadJmdictIntake, sha256 } from '../tools/jmdict-intake.ts';
import { compileJmdictLexicalGraph, lexemeKeys } from '../tools/jmdict-lexical-graph.ts';
import { createEntityGraphRuntime, compactEntityGraph, inflateEntityGraph, makeId, validateEntityGraph } from '../tools/lexical-entity-graph.ts';
import { createSinoDagRuntime, projectSinoDag } from '../tools/sino-dag-projection.ts';
import { buildLexicalGraphMeasurements, MEASUREMENTS_PATH } from '../tools/lexical-graph-measurements.ts';

async function legacySino() {
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile('runtime/historical-sino-runtime.js', 'utf8'), sandbox);
  const artifact = JSON.parse(await readFile('data/historical/sino/phase46e-sino-kana.json', 'utf8'));
  return { artifact, runtime: sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(artifact) };
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));

test('4.6E component authority is reproduced exactly by the shared DAG projection', async () => {
  const { artifact, runtime: legacy } = await legacySino();
  const graph = projectSinoDag(artifact.componentRelations, 'phase46e-sino-table');
  assert.deepEqual(validateEntityGraph(graph), []);
  const dag = createSinoDagRuntime(graph);

  // patterns are shared: far fewer pattern nodes than relations, every table pair once
  const tablePairs = new Set(artifact.componentRelations.flatMap((r: any) => r.historicalReadings.map((h: string) => `${h}>${r.modernReading}`)));
  assert.equal(graph.convergencePatterns.filter((p) => !p.base).length, tablePairs.size);
  assert.ok(graph.convergencePatterns.length < artifact.componentRelations.length);

  let checked = 0;
  for (const r of artifact.componentRelations) {
    for (const query of [{}, { context: null }, { context: '仏教用語' }]) {
      const q = { character: r.character, modernReading: r.modernReading, ...query };
      assert.deepEqual(plain(dag.resolveDirect(r.character, r.modernReading, query)), plain(legacy.resolveHistoricalSino(q)), JSON.stringify(q));
      checked += 1;
    }
  }
  assert.equal(checked, 6000);

  // accepted contextual authority survives the projection; no non-Buddhist default is invented
  assert.deepEqual(plain(dag.resolveDirect('法', 'ほう')), { status: 'candidates', historicalReadings: ['はふ', 'ほふ'] });
  assert.equal(dag.resolveDirect('法', 'ほう', { context: '仏教用語' })!.status, 'resolved');
  assert.deepEqual((dag.resolveDirect('法', 'ほう', { context: '仏教用語' }) as any).historicalReading, 'ほふ');

  // path-level class: 文法 ぶんぽう reconstructs through the shared semi-voicing derivation of はふ>ほう
  const pafu = graph.convergencePatterns.find((p) => p.id === makeId('pattern', 'ぱふ>ぽう'))!;
  assert.equal(pafu.base, makeId('pattern', 'はふ>ほう'));
  assert.equal(pafu.mechanism, 'semi-voicing');
  assert.deepEqual(plain(dag.reconstructWord('文法', 'ぶんぽう')), plain(legacy.reconstructWord('文法', 'ぶんぽう')));
});

test('JMdict compiles deterministically into grouped lexemes with separate homophones', async () => {
  const { extract, accounting } = await loadJmdictIntake(process.cwd());
  const graph = compileJmdictLexicalGraph(extract, accounting);
  const recorded = JSON.parse(await readFile(MEASUREMENTS_PATH, 'utf8'));
  assert.equal(sha256(JSON.stringify(graph)), recorded.canonicalGraph.sha256, 'canonical lexical graph drifted from recorded measurement');
  assert.equal(graph.lexemes.length, extract.length);

  const runtime = createEntityGraphRuntime(graph);
  const binding = runtime.lexemesByForm(makeId('form', '装丁'));
  assert.equal(binding.length, 1);
  for (const form of ['装幀', '装釘', '装訂']) assert.deepEqual(runtime.lexemesByForm(makeId('form', form)), binding);
  const homophones = runtime.lexemesByReading(makeId('reading-path', 'そうてい'));
  assert.ok(homophones.length >= 4 && homophones.includes(binding[0]!));
  assert.ok(!runtime.lexemesByForm(makeId('form', '想定')).includes(binding[0]!));
  assert.equal(runtime.lexemesByForm(makeId('form', '弁護')).length, 1);

  // source-local seq stays provenance; identity collisions get explicit ordinals
  const lexeme = graph.lexemes.find((l) => l.id === binding[0])!;
  assert.match(lexeme.sourceRefs[0]!, /^jmdict:2026-10-01:seq:\d+$/);
  assert.ok(!/\d{6,}/.test(lexeme.id));
  const keys = lexemeKeys(extract);
  assert.equal(new Set(keys.values()).size, extract.length);

  // selected-field accounting: every keb/reb/restriction reaches the graph
  const forms = new Set(graph.forms.map((f) => f.id));
  for (const entry of extract) for (const k of entry.k ?? []) assert.ok(forms.has(makeId('form', k.t)));
  const restricted = extract.reduce((n, e) => n + e.r.filter((r) => r.nokanji || r.restr?.length).length, 0);
  assert.equal(graph.restrictions.length, restricted);

  // compact projection round-trips the full lexicon
  assert.equal(sha256(JSON.stringify(inflateEntityGraph(compactEntityGraph(graph)))), recorded.canonicalGraph.sha256);
});

test('4.6E word reconstruction is reproduced across the JMdict Sino vocabulary', async () => {
  const { artifact, runtime: legacy } = await legacySino();
  const dag = createSinoDagRuntime(projectSinoDag(artifact.componentRelations, 'phase46e-sino-table'));
  const { extract } = await loadJmdictIntake(process.cwd());
  const known = new Set(artifact.componentRelations.map((r: any) => r.character));
  let compared = 0;
  for (const entry of extract) {
    for (const k of entry.k ?? []) {
      const chars = Array.from(k.t);
      if (chars.length < 2 || chars.length > 4 || !chars.every((c) => known.has(c))) continue;
      for (const r of entry.r) {
        if (r.nokanji || (r.restr && !r.restr.includes(k.t))) continue;
        for (const query of chars.includes('法') ? [{}, { context: '仏教用語' }] : [{}]) {
          assert.deepEqual(plain(dag.reconstructWord(k.t, r.t, query)), plain(legacy.reconstructWord(k.t, r.t, query)), `${k.t}/${r.t}`);
          compared += 1;
        }
      }
    }
  }
  assert.ok(compared > 15000, `compared ${compared}`);
});

test('recorded size measurements are real compiled bytes', async () => {
  const recorded = JSON.parse(await readFile(MEASUREMENTS_PATH, 'utf8'));
  const { artifact } = await legacySino();
  const sino = projectSinoDag(artifact.componentRelations, 'phase46e-sino-table');
  const measured = buildLexicalGraphMeasurements({ sino, sinoSource: artifact.componentRelations });
  assert.deepEqual(measured.sinoDag, recorded.sinoDag);
  assert.ok(recorded.compactGraph.bytes < recorded.canonicalGraph.bytes);
  assert.ok(recorded.hotProjection.bytes < recorded.jmdict.rawExtractBytes);
  assert.equal(typeof gzipSync, 'function');
});
