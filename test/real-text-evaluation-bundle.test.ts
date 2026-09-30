import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import type { UniDicSourceSlice } from '../tools/lexical-compiler.ts';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadUmd(path: string, globals: Record<string, unknown> = {}) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

async function acceptedArtifact() {
  const builder = await import('../tools/resolver-bundle.ts');
  const [lexicalSource, nativeSlice, sinoSlice, contextualBindingSlice, contextualManifest, contextualTaiPack, safeCharacterSlice] = await Promise.all([
    json('data/lexical/sources/unidic-cwj-202512-first-slice.json'),
    json('data/historical/native/kkh-kana-first-slice.json'),
    json('data/historical/sino/kkh-jion-first-slice.json'),
    json('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
    json('data/packs/contextual-kanji/manifest.json'),
    json('data/packs/contextual-kanji/merged-tai.json'),
    json('data/deterministic/safe-character-first-slice.json')
  ]);
  return builder.buildResolverBundleArtifact({
    lexicalSource: lexicalSource as UniDicSourceSlice,
    nativeSlice,
    sinoSlice,
    contextualBindingSlice: contextualBindingSlice as any,
    contextualManifest,
    contextualTaiPack,
    safeCharacterSlice
  });
}

async function activatedBundle() {
  const [lexical, native, sino, safe, shared] = await Promise.all([
    loadUmd('runtime/lexical-runtime.js'),
    loadUmd('runtime/historical-native-runtime.js'),
    loadUmd('runtime/historical-sino-runtime.js'),
    loadUmd('runtime/safe-character-runtime.js'),
    loadUmd('runtime/transform-shared.js')
  ]);
  const resolver = await loadUmd('runtime/orthography-resolver.js', { TransformShared: shared.TransformShared });
  const runtime = await loadUmd('runtime/resolver-bundle-runtime.js', {
    LexicalRuntime: lexical.LexicalRuntime,
    HistoricalNativeRuntime: native.HistoricalNativeRuntime,
    HistoricalSinoRuntime: sino.HistoricalSinoRuntime,
    SafeCharacterRuntime: safe.SafeCharacterRuntime,
    OrthographyResolver: resolver.OrthographyResolver
  });
  return runtime.ResolverBundleRuntime.createResolverBundle(await acceptedArtifact());
}

test('Phase 3.5 prose fixture exposes accepted Phase 3 coverage in one trace', async () => {
  const fixture = await json('test/fixtures/real-text/phase35-first-slice.json');
  const bundle = await activatedBundle();
  const evaluatorRuntime = await loadUmd('runtime/real-text-evaluation-runtime.js');
  const evaluator = evaluatorRuntime.RealTextEvaluationRuntime.createRealTextEvaluator(bundle);
  const result = evaluator.evaluate(fixture.sourceText, fixture.spans);

  assert.equal(result.renderedText, fixture.expected.renderedText);
  assert.deepEqual(JSON.parse(JSON.stringify(result.summary)), fixture.expected.summary);

  const school = result.trace.find((record: any) => record.sourceText === '学校');
  assert.equal(school.lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
  assert.equal(school.historical.kana, 'がくかう');
  assert.equal(school.historical.deterministicKanji.target, '學校');

  const taifu = result.trace.find((record: any) => record.sourceText === '台風');
  assert.equal(taifu.lexicalIdentity, 'unidic-cwj:2025.12:lemma:21903');
  assert.equal(taifu.historical.contextualKanji.status, 'resolved');
  assert.equal(taifu.historical.contextualKanji.target, '颱風');

  const today = result.trace.find((record: any) => record.sourceText === '今日');
  assert.equal(today.kind, 'candidates');
  assert.ok(today.lexicalCandidates.length > 1);
  assert.equal(today.renderedText, '今日');

  const unknown = result.trace.find((record: any) => record.sourceText === '未知語');
  assert.equal(unknown.kind, 'unresolved');
  assert.equal(unknown.renderedText, '未知語');
});
