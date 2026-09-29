import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { compileLexicalSourceSlice, type UniDicSourceSlice } from '../tools/lexical-compiler.ts';

async function loadRuntime(path: string, globals: Record<string, unknown> = {}) {
  let source = '';
  try { source = await readFile(path, 'utf8'); } catch { /* RED before runtime exists */ }
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  if (source) vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

async function artifact() {
  const source = JSON.parse(await readFile('data/lexical/sources/unidic-cwj-202512-first-slice.json', 'utf8')) as UniDicSourceSlice;
  return compileLexicalSourceSlice(source);
}

async function historicalSinoSlice() {
  return JSON.parse(await readFile('data/historical/sino/kkh-jion-first-slice.json', 'utf8')) as Record<string, any>;
}

test('lexical runtime returns zero, one, or multiple source-backed candidates', async () => {
  const lexicalSandbox = await loadRuntime('runtime/lexical-runtime.js');
  assert.equal(typeof lexicalSandbox.LexicalRuntime?.createLexicalRuntime, 'function');
  const runtime = lexicalSandbox.LexicalRuntime.createLexicalRuntime(await artifact());
  assert.deepEqual(Array.from(runtime.lookup('未知語')), []);

  const school = runtime.lookup('学校');
  assert.equal(school.length, 1);
  assert.equal(school[0].lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
  assert.equal(school[0].reading, 'がっこう');
  assert.deepEqual(Array.from(school[0].modernReadings), ['がっこ', 'がっこう']);
  assert.equal(school[0].lexicalOrigin, 'sino');

  const today = runtime.lookup('今日');
  assert.equal(today.length, 2);
  assert.deepEqual(Array.from(today, (candidate: any) => candidate.lexicalIdentity), [
    'unidic-cwj:2025.12:lemma:9128',
    'unidic-cwj:2025.12:lemma:13244'
  ]);

  const native = runtime.lookup('味わおう');
  assert.equal(native.length, 1);
  assert.equal(native[0].reading, 'あじわおう');
  assert.equal(native[0].lexicalOrigin, 'native');
  assert.equal(native[0].morphology.conjugationType, '五段-ワア行');
  assert.equal(native[0].morphology.conjugationForm, '意志推量形');
});

test('lexical runtime does not invent a modern reading when source readings disagree with lForm', async () => {
  const lexicalSandbox = await loadRuntime('runtime/lexical-runtime.js');
  const runtime = lexicalSandbox.LexicalRuntime.createLexicalRuntime({
    schemaVersion: '1',
    kind: 'japanese-orthography-lexical-artifact',
    lexicalNamespaceId: 'test-namespace',
    artifactContentId: 'test-artifact',
    lemmas: [{
      lemmaIndex: 0,
      sourceLemmaId: 1,
      lemma: '例',
      lForm: 'レキシ',
      lexicalReading: 'れきし',
      lexicalOrigin: 'native',
      lexicalIdentity: 'test:lemma:1'
    }],
    morphologies: [{ morphologyId: 0, pos: ['名詞', '普通名詞', '一般', '*'], cType: '*', cForm: '*' }],
    candidates: [{ lemmaIndex: 0, morphologyId: 0, modernReadings: ['げんだい', 'げんだいべつ'] }],
    surfaceIndex: [{ surface: '例', candidateOffset: 0, candidateCount: 1 }]
  });

  const candidate = runtime.lookup('例')[0];
  assert.equal(candidate.reading, null);
  assert.deepEqual(Array.from(candidate.modernReadings), ['げんだい', 'げんだいべつ']);
  assert.equal(candidate.lexicalReading, 'れきし');
});

test('real lexical runtime and source-backed jion runtime inject into one resolver pipeline', async () => {
  const [lexicalSandbox, historicalSandbox, sharedSandbox] = await Promise.all([
    loadRuntime('runtime/lexical-runtime.js'),
    loadRuntime('runtime/historical-sino-runtime.js'),
    loadRuntime('runtime/transform-shared.js')
  ]);
  const resolverSandbox = await loadRuntime('runtime/orthography-resolver.js', { TransformShared: sharedSandbox.TransformShared });
  const compiled = await artifact();
  const lexical = lexicalSandbox.LexicalRuntime.createLexicalRuntime(compiled);
  const historicalSino = historicalSandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(
    await historicalSinoSlice(),
    { lexicalNamespaceId: lexical.lexicalNamespaceId }
  );
  let lookups = 0;
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) { lookups += 1; return lexical.lookup(surface); },
    historicalLookup(candidate: any) { return historicalSino.lookup(candidate); },
    contextualRelations: [{ id: 'acceptance:taifu', match: '台風', target: '颱風', lexicalBindingIds: ['unidic-cwj:2025.12:lemma:21903'] }],
    safeKanjiMap: { 学: '學' }
  });

  const school = resolver.resolveUnit('学校');
  assert.equal(school.lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
  assert.equal(school.historical.surface, '學校');
  assert.equal(school.historical.kana, 'がくかう');
  assert.deepEqual(Array.from(school.components, (component: any) => [
    component.lexicalIdentity,
    component.surface,
    component.lexicalReading,
    component.historicalKana,
    component.renderedSurface
  ]), [
    [null, '学', 'がく', 'がく', '學'],
    [null, '校', 'こう', 'かう', '校']
  ]);
  assert.ok(Array.from(school.evidenceRefs).includes('kkh-kana-school-gakkou'));
  assert.equal(resolver.render(school, { mode: 'ruby-whole-explicit' }), '｜學校《がくかう》');
  assert.equal(resolver.render(school, { mode: 'ruby-components-explicit' }), '｜學《がく》校《かう》');

  const alternateSchoolRuby = resolver.resolveUnit('｜学校《がっこ》');
  assert.equal(alternateSchoolRuby.lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
  assert.equal(alternateSchoolRuby.reading.source, 'ruby-word');
  assert.equal(alternateSchoolRuby.reading.modernSurface, 'がっこ');
  assert.equal(alternateSchoolRuby.historical.kana, 'がくかう');

  const componentSchoolRuby = resolver.resolveUnit('｜学《がく》校《こう》');
  assert.equal(componentSchoolRuby.lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
  assert.deepEqual(Array.from(componentSchoolRuby.components, (component: any) => component.readingSource), ['ruby-component', 'ruby-component']);
  assert.equal(componentSchoolRuby.historical.kana, 'がくかう');

  assert.equal(resolver.resolveUnit('今日').kind, 'candidates');
  assert.equal(resolver.resolveUnit('｜今日《きょう》').lexicalIdentity, 'unidic-cwj:2025.12:lemma:9128');
  assert.equal(resolver.resolveUnit('｜今日《こんにち》').lexicalIdentity, 'unidic-cwj:2025.12:lemma:13244');
  assert.equal(resolver.resolveUnit('台風').historical.surface, '颱風');
  const native = resolver.resolveUnit('味わおう');
  assert.equal(native.morphology.conjugationForm, '意志推量形');
  assert.equal(native.historical.route, null);
  assert.equal(native.historical.kana, null);
  assert.equal(resolver.resolveUnit('未知語').kind, 'unresolved');

  const afterSchoolResolve = lookups;
  resolver.render(school, { mode: 'plain' });
  resolver.render(school, { mode: 'ruby-whole-explicit' });
  resolver.render(school, { mode: 'ruby-components-explicit' });
  assert.equal(lookups, afterSchoolResolve);

  const beforeProtected = lookups;
  assert.equal(resolver.resolveUnit('｜学校《がっこう》', { protected: true }).kind, 'protected');
  assert.equal(lookups, beforeProtected);
});

test('same lexical runtime loads in browser-class and Worker-class sandboxes', async () => {
  const compiled = await artifact();
  for (const globals of [{ window: {} }, { self: {} }]) {
    const sandbox = await loadRuntime('runtime/lexical-runtime.js', globals);
    const runtime = sandbox.LexicalRuntime.createLexicalRuntime(compiled);
    assert.equal(runtime.lookup('学校')[0].lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
  }
});
