import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { buildResolverBundleArtifact } from '../tools/resolver-bundle.ts';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function acceptedArtifact() {
  const [lexicalSource, nativeSlice, sinoSlice, contextualBindingSlice, contextualManifest, contextualTaiPack, safeCharacterSlice] = await Promise.all([
    json('data/lexical/sources/unidic-cwj-202512-first-slice.json'),
    json('data/historical/native/phase46d-native-kana.json'),
    json('data/historical/sino/kkh-jion-first-slice.json'),
    json('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
    json('data/packs/contextual-kanji/manifest.json'),
    json('data/packs/contextual-kanji/merged-tai.json'),
    json('data/deterministic/safe-character-first-slice.json')
  ]);
  return buildResolverBundleArtifact({ lexicalSource, nativeSlice, sinoSlice, contextualBindingSlice, contextualManifest, contextualTaiPack, safeCharacterSlice } as any);
}

async function loadUmd(path: string, globals: Record<string, unknown> = {}) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

async function createFunction() {
  const [lexical, native, sino, safe, shared] = await Promise.all([
    loadUmd('runtime/lexical-runtime.js'),
    loadUmd('runtime/historical-native-runtime.js'),
    loadUmd('runtime/historical-sino-runtime.js'),
    loadUmd('runtime/safe-character-runtime.js'),
    loadUmd('runtime/transform-shared.js')
  ]);
  const resolver = await loadUmd('runtime/orthography-resolver.js', { TransformShared: shared.TransformShared });
  const bundle = await loadUmd('runtime/resolver-bundle-runtime.js', {
    LexicalRuntime: lexical.LexicalRuntime,
    HistoricalNativeRuntime: native.HistoricalNativeRuntime,
    HistoricalSinoRuntime: sino.HistoricalSinoRuntime,
    SafeCharacterRuntime: safe.SafeCharacterRuntime,
    OrthographyResolver: resolver.OrthographyResolver
  });
  return bundle.ResolverBundleRuntime.createResolverBundle;
}

test('Phase 3 runtime rejects semantic payload drift behind a stale section identity', async () => {
  const create = await createFunction();
  const artifact = await acceptedArtifact();
  const mutated = structuredClone(artifact);
  mutated.safeCharacterSlice.purpose = `${mutated.safeCharacterSlice.purpose}-drift`;

  assert.throws(
    () => create(mutated),
    /safe-character section identity mismatch/
  );
});

test('Phase 3 runtime rejects a stale or forged bundle content identity', async () => {
  const create = await createFunction();
  const artifact = await acceptedArtifact();
  const mutated = structuredClone(artifact);
  mutated.bundleContentId = '0'.repeat(64);

  assert.throws(
    () => create(mutated),
    /bundle content identity mismatch/
  );
});
