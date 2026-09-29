import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { compileLexicalSourceSlice, type UniDicSourceSlice } from '../tools/lexical-compiler.ts';

async function loadRuntime(path: string, globals: Record<string, unknown> = {}) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

async function lexicalArtifact() {
  const source = JSON.parse(await readFile('data/lexical/sources/unidic-cwj-202512-first-slice.json', 'utf8')) as UniDicSourceSlice;
  return compileLexicalSourceSlice(source);
}

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

test('real lexical native candidates join source-backed native evidence without collapsing lexical ambiguity', async () => {
  const [lexicalSandbox, nativeSandbox, resolverSandbox, compiled, nativeSlice] = await Promise.all([
    loadRuntime('runtime/lexical-runtime.js'),
    loadRuntime('runtime/historical-native-runtime.js'),
    loadRuntime('runtime/orthography-resolver.js'),
    lexicalArtifact(),
    json('data/historical/native/kkh-kana-first-slice.json')
  ]);
  const lexical = lexicalSandbox.LexicalRuntime.createLexicalRuntime(compiled);
  const native = nativeSandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(nativeSlice, {
    lexicalNamespaceId: lexical.lexicalNamespaceId
  });

  const candidates = lexical.lookup('思う');
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every((candidate: any) => (
    candidate.lexicalIdentity === 'unidic-cwj:2025.12:lemma:5255' && candidate.lexicalOrigin === 'native'
  )));
  assert.deepEqual(Array.from(candidates, (candidate: any) => native.lookup(candidate)?.surface), ['思ふ', '思ふ', '思ふ']);

  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) { return lexical.lookup(surface); },
    historicalLookup(candidate: Record<string, any>) { return native.lookup(candidate); }
  });
  assert.equal(resolver.resolveUnit('思う').kind, 'candidates');

  const variantBearing = resolver.resolveUnit('味わおう');
  assert.equal(variantBearing.lexicalIdentity, 'unidic-cwj:2025.12:lemma:670');
  assert.equal(variantBearing.historical.route, null);
  assert.equal(variantBearing.historical.surface, '味わおう');
});

test('Phase 2B source-backed Sino behavior remains available beside the native runtime', async () => {
  const [lexicalSandbox, nativeSandbox, sinoSandbox, resolverSandbox, compiled, nativeSlice, sinoSlice] = await Promise.all([
    loadRuntime('runtime/lexical-runtime.js'),
    loadRuntime('runtime/historical-native-runtime.js'),
    loadRuntime('runtime/historical-sino-runtime.js'),
    loadRuntime('runtime/orthography-resolver.js'),
    lexicalArtifact(),
    json('data/historical/native/kkh-kana-first-slice.json'),
    json('data/historical/sino/kkh-jion-first-slice.json')
  ]);
  const lexical = lexicalSandbox.LexicalRuntime.createLexicalRuntime(compiled);
  const native = nativeSandbox.HistoricalNativeRuntime.createHistoricalNativeRuntime(nativeSlice, { lexicalNamespaceId: lexical.lexicalNamespaceId });
  const sino = sinoSandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(sinoSlice, { lexicalNamespaceId: lexical.lexicalNamespaceId });
  const resolver = resolverSandbox.OrthographyResolver.createResolver({
    lexicalLookup(surface: string) { return lexical.lookup(surface); },
    historicalLookup(candidate: Record<string, any>) {
      return candidate.lexicalOrigin === 'native' ? native.lookup(candidate) : sino.lookup(candidate);
    },
    safeKanjiMap: { 学: '學' }
  });

  const school = resolver.resolveUnit('学校');
  assert.equal(school.historical.route, 'sino');
  assert.equal(school.historical.kana, 'がくかう');
  assert.equal(resolver.render(school, { mode: 'ruby-whole-explicit' }), '｜學校《がくかう》');
});
