import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadBuilder() {
  try { return await import('../tools/resolver-bundle.ts'); } catch { return null; }
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

test('Phase 3 builder deterministically packages the accepted resolver inputs', async () => {
  const builder = await loadBuilder();
  assert.equal(typeof builder?.buildResolverBundleArtifact, 'function');
  const inputs = await acceptedInputs();
  const first = builder!.buildResolverBundleArtifact(inputs as any);
  const second = builder!.buildResolverBundleArtifact(structuredClone(inputs) as any);

  assert.equal(first.schemaVersion, '1');
  assert.equal(first.kind, 'japanese-orthography-resolver-bundle-artifact');
  assert.match(first.bundleContentId, /^[0-9a-f]{64}$/);
  assert.equal(second.bundleContentId, first.bundleContentId);
  assert.equal(first.lexicalArtifact.lexicalNamespaceId, inputs.lexicalSource.source.lexicalNamespaceId);
  assert.deepEqual(first.capabilities, [
    'lexical',
    'historical-native',
    'historical-sino',
    'contextual-kanji',
    'safe-character',
    'late-rendering'
  ]);
});
