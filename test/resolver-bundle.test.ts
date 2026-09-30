import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadBuilder() {
  try { return await import('../tools/resolver-bundle.ts'); } catch { return null; }
}

async function loadUmd(path: string, globals: Record<string, unknown> = {}) {
  let source = '';
  try { source = await readFile(path, 'utf8'); } catch { /* RED before runtime exists */ }
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  if (source) vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

async function acceptedInputs() {
  const [lexicalSource, nativeSlice, sinoSlice, contextualBindingSlice, contextualManifest, contextualTaiPack, safeCharacterSlice] = await Promise.all([
    json('data/lexical/sources/unidic-cwj-202512-first-slice.json'),
    json('data/historical/native/kkh-kana-first-slice.json'),
    json('data/historical/sino/kkh-jion-first-slice.json'),
    json('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
    json('data/packs/contextual-kanji/manifest.json'),
    json('data/packs/contextual-kanji/merged-tai.json'),
    json('data/deterministic/safe-character-first-slice.json')
  ]);
  return { lexicalSource, nativeSlice, sinoSlice, contextualBindingSlice, contextualManifest, contextualTaiPack, safeCharacterSlice };
}

async function acceptedArtifact() {
  const builder = await loadBuilder();
  assert.equal(typeof builder?.buildResolverBundleArtifact, 'function');
  return builder!.buildResolverBundleArtifact(await acceptedInputs() as any);
}

async function runtimeGlobals() {
  const [lexical, native, sino, safe, shared] = await Promise.all([
    loadUmd('runtime/lexical-runtime.js'),
    loadUmd('runtime/historical-native-runtime.js'),
    loadUmd('runtime/historical-sino-runtime.js'),
    loadUmd('runtime/safe-character-runtime.js'),
    loadUmd('runtime/transform-shared.js')
  ]);
  const resolver = await loadUmd('runtime/orthography-resolver.js', { TransformShared: shared.TransformShared });
  return {
    LexicalRuntime: lexical.LexicalRuntime,
    HistoricalNativeRuntime: native.HistoricalNativeRuntime,
    HistoricalSinoRuntime: sino.HistoricalSinoRuntime,
    SafeCharacterRuntime: safe.SafeCharacterRuntime,
    OrthographyResolver: resolver.OrthographyResolver
  };
}

test('Phase 3 builder deterministically packages the accepted resolver inputs', async () => {
  const inputs = await acceptedInputs();
  const builder = await loadBuilder();
  assert.equal(typeof builder?.buildResolverBundleArtifact, 'function');
  const first = builder!.buildResolverBundleArtifact(inputs as any);
  const second = builder!.buildResolverBundleArtifact(structuredClone(inputs) as any);

  assert.equal(first.schemaVersion, '1');
  assert.equal(first.kind, 'japanese-orthography-resolver-bundle-artifact');
  assert.match(first.bundleContentId, /^[0-9a-f]{64}$/);
  assert.equal(second.bundleContentId, first.bundleContentId);
  assert.equal(first.lexicalArtifact.lexicalNamespaceId, inputs.lexicalSource.source.lexicalNamespaceId);
  assert.deepEqual(first.capabilities, [
    'lexical', 'historical-native', 'historical-sino',
    'contextual-kanji', 'safe-character', 'late-rendering'
  ]);
});

test('Phase 3 runtime atomically activates the accepted full bundle', async () => {
  const sandbox = await loadUmd('runtime/resolver-bundle-runtime.js', await runtimeGlobals());
  assert.equal(typeof sandbox.ResolverBundleRuntime?.createResolverBundle, 'function');
  const artifact = await acceptedArtifact();
  const bundle = sandbox.ResolverBundleRuntime.createResolverBundle(artifact);

  assert.equal(bundle.bundleContentId, artifact.bundleContentId);
  assert.equal(bundle.lexicalNamespaceId, artifact.lexicalArtifact.lexicalNamespaceId);
  assert.deepEqual(Array.from(bundle.capabilities), artifact.capabilities);
  assert.equal(typeof bundle.resolveUnit, 'function');
  assert.equal(typeof bundle.render, 'function');
});
