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

async function activatedBundle(artifact?: any, extraGlobals: Record<string, unknown> = {}) {
  const selectedArtifact = artifact ?? await acceptedArtifact();
  const sandbox = await loadUmd('runtime/resolver-bundle-runtime.js', { ...(await runtimeGlobals()), ...extraGlobals });
  assert.equal(typeof sandbox.ResolverBundleRuntime?.createResolverBundle, 'function');
  return sandbox.ResolverBundleRuntime.createResolverBundle(selectedArtifact);
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

  const changed = structuredClone(inputs);
  changed.safeCharacterSlice.purpose = `${changed.safeCharacterSlice.purpose}-changed`;
  const changedArtifact = builder!.buildResolverBundleArtifact(changed as any);
  assert.notEqual(changedArtifact.bundleContentId, first.bundleContentId);
});

test('Phase 3 builder fails closed on accepted namespace drift', async () => {
  const builder = await loadBuilder();
  const inputs = await acceptedInputs();
  const wrongNative = structuredClone(inputs);
  wrongNative.nativeSlice.lexicalNamespaceId = 'wrong-namespace';
  assert.throws(() => builder!.buildResolverBundleArtifact(wrongNative as any), /native lexical namespace mismatch/);

  const wrongSino = structuredClone(inputs);
  wrongSino.sinoSlice.lexicalNamespaceId = 'wrong-namespace';
  assert.throws(() => builder!.buildResolverBundleArtifact(wrongSino as any), /Sino lexical namespace mismatch/);

  const wrongContextual = structuredClone(inputs);
  wrongContextual.contextualBindingSlice.sourceLexicalNamespaceId = 'wrong-namespace';
  assert.throws(() => builder!.buildResolverBundleArtifact(wrongContextual as any), /source lexical namespace mismatch/);
});

test('Phase 3 runtime atomically activates the accepted full bundle', async () => {
  const artifact = await acceptedArtifact();
  const bundle = await activatedBundle(artifact);
  assert.equal(bundle.bundleContentId, artifact.bundleContentId);
  assert.equal(bundle.lexicalNamespaceId, artifact.lexicalArtifact.lexicalNamespaceId);
  assert.deepEqual(Array.from(bundle.capabilities), artifact.capabilities);
  assert.equal(typeof bundle.resolveUnit, 'function');
  assert.equal(typeof bundle.render, 'function');
});

test('Phase 3 bundle reproduces accepted cross-layer semantics through one entry point', async () => {
  const bundle = await activatedBundle();

  const school = bundle.resolveUnit('学校');
  assert.equal(school.lexicalIdentity, 'unidic-cwj:2025.12:lemma:8098');
  assert.equal(school.historical.surface, '學校');
  assert.equal(school.historical.kana, 'がくかう');
  assert.equal(bundle.render(school, { mode: 'ruby-whole-explicit' }), '｜學校《がくかう》');

  const taifu = bundle.resolveUnit('台風');
  assert.equal(taifu.lexicalIdentity, 'unidic-cwj:2025.12:lemma:21903');
  assert.equal(taifu.historical.contextualKanji.status, 'resolved');
  assert.equal(bundle.render(taifu, { mode: 'plain' }), '颱風');

  assert.equal(bundle.resolveUnit('思う').kind, 'candidates');
  assert.equal(bundle.resolveUnit('今日').kind, 'candidates');
  assert.equal(bundle.resolveUnit('｜今日《きょう》').lexicalIdentity, 'unidic-cwj:2025.12:lemma:9128');
  assert.equal(bundle.resolveUnit('｜今日《こんにち》').lexicalIdentity, 'unidic-cwj:2025.12:lemma:13244');
  assert.equal(bundle.resolveUnit('未知語').kind, 'unresolved');
  assert.equal(bundle.resolveUnit('｜学校《がっこう》', { protected: true }).kind, 'protected');
});

test('Phase 3 runtime rejects partial, malformed, and stale bundle activation', async () => {
  const globals = await runtimeGlobals();
  const sandbox = await loadUmd('runtime/resolver-bundle-runtime.js', globals);
  const create = sandbox.ResolverBundleRuntime.createResolverBundle;
  const artifact = await acceptedArtifact();

  const missingSection = structuredClone(artifact);
  missingSection.sections = missingSection.sections.filter((section: any) => section.id !== 'safe-character');
  assert.throws(() => create(missingSection), /Missing resolver bundle section: safe-character/);

  const missingCapability: any = structuredClone(artifact);
  missingCapability.capabilities = missingCapability.capabilities.filter((value: string) => value !== 'safe-character');
  assert.throws(() => create(missingCapability), /capability declaration mismatch/);

  const wrongNamespace = structuredClone(artifact);
  wrongNamespace.historicalSinoSlice.lexicalNamespaceId = 'wrong-namespace';
  assert.throws(() => create(wrongNamespace), /historical-sino section identity mismatch/);

  const wrongContextualNamespace = structuredClone(artifact);
  wrongContextualNamespace.contextual.sourceLexicalNamespaceId = 'wrong-namespace';
  assert.throws(() => create(wrongContextualNamespace), /contextual-kanji section identity mismatch/);

  const wrongBindingNamespace = structuredClone(artifact);
  wrongBindingNamespace.contextual.bindingNamespaceId = 'other-binding-namespace';
  assert.throws(() => create(wrongBindingNamespace), /contextual-kanji section identity mismatch/);

  const invalidSafeSlice = structuredClone(artifact);
  invalidSafeSlice.safeCharacterSlice.schemaVersion = '999';
  assert.throws(() => create(invalidSafeSlice), /safe-character section identity mismatch/);
});

test('Phase 3 runtime requires every runtime dependency before activation', async () => {
  const globals = await runtimeGlobals();
  const artifact = await acceptedArtifact();
  const sandbox = await loadUmd('runtime/resolver-bundle-runtime.js', { ...globals, HistoricalSinoRuntime: undefined });
  assert.throws(
    () => sandbox.ResolverBundleRuntime.createResolverBundle(artifact),
    /Missing resolver bundle runtime dependency: HistoricalSinoRuntime.createHistoricalSinoRuntime/
  );
});

test('same Phase 3 bundle runtime loads in browser-class and Worker-class sandboxes', async () => {
  const artifact = await acceptedArtifact();
  const globals = await runtimeGlobals();
  for (const host of [{ window: {} }, { self: {} }]) {
    const sandbox = await loadUmd('runtime/resolver-bundle-runtime.js', { ...globals, ...host });
    const bundle = sandbox.ResolverBundleRuntime.createResolverBundle(artifact);
    assert.equal(bundle.render(bundle.resolveUnit('学校'), { mode: 'plain' }), '學校');
    assert.equal(bundle.render(bundle.resolveUnit('台風'), { mode: 'plain' }), '颱風');
  }
});
