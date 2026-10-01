import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { sha256 } from '../tools/jmdict-intake.ts';
import { createEntityGraphRuntime, inflateEntityGraph } from '../tools/lexical-entity-graph.ts';
import { buildCompactRuntimeArtifacts, COMPACT_RUNTIME_REPORT } from '../tools/measure-compact-runtime.ts';

const built = await buildCompactRuntimeArtifacts(process.cwd());
const report = JSON.parse(await readFile(COMPACT_RUNTIME_REPORT, 'utf8'));
const { createLexicalHotRuntime } = createRequire(import.meta.url)('../runtime/lexical-hot-runtime.js');
const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

test('compact and hot artifacts are deterministic and match the recorded measurements', () => {
  assert.equal(sha256(built.canonicalText), report.sizes.canonicalLexicalGraph.sha256);
  assert.equal(sha256(JSON.stringify(built.compact)), report.sizes.compactLexicalGraph.sha256);
  assert.equal(sha256(JSON.stringify(built.hot)), report.sizes.hotRuntimeArtifact.sha256);
  assert.ok(report.sizes.compactLexicalGraph.bytes < report.sizes.canonicalLexicalGraph.bytes);
  assert.ok(report.sizes.sinoDagHotTables.bytes < report.sizes.phase46eArtifact.bytes);
  assert.deepEqual(Object.keys(built.compact.derived!).sort(), ['form', 'reading-atom', 'reading-path', 'symbol']);
});

test('compaction preserves lexical identity exactly (inflate == canonical)', () => {
  assert.equal(sha256(JSON.stringify(inflateEntityGraph(built.compact))), sha256(built.canonicalText));
});

test('derived columns and hot tables reject type confusion and tampering', () => {
  const forged = structuredClone(built.compact);
  forged.derived = { ...forged.derived, lexeme: ['forms'] };
  assert.throws(() => inflateEntityGraph(forged), /no derivation for lexeme\.forms/);
  const schema = structuredClone(built.hot) as any;
  schema.schema['forms.lexemes'] = 'string[]';
  assert.throws(() => createLexicalHotRuntime(schema), /schema mismatch/);
  const range = structuredClone(built.hot) as any;
  range.forms.lexemes[0] = [range.lexemes.primaryForm.length];
  assert.throws(() => createLexicalHotRuntime(range), /forms\.lexemes index \d+ out of lexeme range/);
});

test('hot lexical lookups equal the canonical graph for every form and reading', () => {
  const hot = createLexicalHotRuntime(built.hot);
  const graph = createEntityGraphRuntime(built.lexical);
  for (const form of built.lexical.forms) {
    assert.deepEqual(hot.lookupForm(form.text).map((c: any) => c.lexeme), graph.lexemesByForm(form.id), form.id);
  }
  for (const path of built.lexical.readingPaths) {
    assert.deepEqual(hot.lookupReading(path.id.slice('reading-path:'.length)), graph.lexemesByReading(path.id), path.id);
  }
  assert.deepEqual(hot.lookupForm('装幀').map((c: any) => c.lexeme), hot.lookupForm('装丁').map((c: any) => c.lexeme));
});

test('hot reverse reading-DAG traversal reproduces the accepted 4.6E runtime', async () => {
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile('runtime/historical-sino-runtime.js', 'utf8'), sandbox);
  const legacy = sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(built.sinoSource);
  // browser/worker-class load of the hot runtime itself
  const vmBox: Record<string, any> = {};
  vmBox.globalThis = vmBox;
  vm.runInNewContext(await readFile('runtime/lexical-hot-runtime.js', 'utf8'), vmBox);
  const hot = vmBox.LexicalHotRuntime.createLexicalHotRuntime(JSON.parse(JSON.stringify(built.hot)));
  const known = new Set(built.sinoSource.componentRelations.map((r: any) => r.character));
  let compared = 0;
  for (const entry of built.extract) for (const k of entry.k ?? []) {
    const chars = Array.from(k.t);
    if (chars.length < 2 || chars.length > 4 || !chars.every((c) => known.has(c))) continue;
    for (const r of entry.r) {
      if (r.nokanji || (r.restr && !r.restr.includes(k.t))) continue;
      for (const query of chars.includes('法') ? [{}, { context: '仏教用語' }, { context: null }] : [{}]) {
        assert.deepEqual(plain(hot.reconstructWord(k.t, r.t, query)), plain(legacy.reconstructWord(k.t, r.t, query)), `${k.t}/${r.t}`);
        compared += 1;
      }
    }
  }
  assert.ok(compared > 15000);
  assert.deepEqual(plain(hot.reconstructWord('法', 'ほう')), { status: 'candidates', historicalReadings: ['はふ', 'ほふ'] });
  assert.equal(hot.reconstructWord('装丁', 'そうてい').historicalReading, 'さうてい');
});

test('R3: restriction-aware hot form+reading lookup equals canonical restrictions across the full JMdict graph', () => {
  const hot = createLexicalHotRuntime(built.hot);
  const restricted = new Map(built.lexical.restrictions.map((r) => [`${r.lexeme}\u0000${r.reading}`, new Set(r.forms)]));
  let checked = 0;
  for (const lexeme of built.lexical.lexemes) {
    for (const form of lexeme.forms) for (const reading of lexeme.readings) {
      const allowedForms = restricted.get(`${lexeme.id}\u0000${reading}`);
      const permitted = !allowedForms || allowedForms.has(form);
      const result: string[] = hot.lookupFormReading(form.slice('form:'.length), reading.slice('reading-path:'.length));
      assert.equal(result.includes(lexeme.id), permitted, `${lexeme.id} ${form} ${reading}`);
      checked += 1;
    }
  }
  assert.ok(checked > 250000, `checked ${checked}`);
});

test('R4: hot single-component reconstruction matches the accepted 4.6E runtime for every relation and context shape', async () => {
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile('runtime/historical-sino-runtime.js', 'utf8'), sandbox);
  const legacy = sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(built.sinoSource);
  const hot = createLexicalHotRuntime(built.hot);
  let checked = 0;
  for (const r of built.sinoSource.componentRelations) {
    for (const query of [{}, { context: null }, { context: '仏教用語' }]) {
      assert.deepEqual(plain(hot.reconstructWord(r.character, r.modernReading, query)), plain(legacy.reconstructWord(r.character, r.modernReading, query)), `${r.character}/${r.modernReading}/${JSON.stringify(query)}`);
      checked += 1;
    }
  }
  assert.equal(checked, 6000);
});
