import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadSlice() {
  try {
    return await json('data/deterministic/safe-character-first-slice.json');
  } catch {
    return null;
  }
}

async function loadRuntime(globals: Record<string, unknown> = {}) {
  const source = await readFile('runtime/safe-character-runtime.js', 'utf8');
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'runtime/safe-character-runtime.js' });
  return sandbox;
}

test('source-backed safe-character slice admits only 学 -> 學 in the bounded first slice', async () => {
  const slice = await loadSlice();
  assert.equal(slice?.schemaVersion, '1');
  assert.equal(slice?.kind, 'japanese-orthography-safe-character-slice');
  assert.deepEqual(slice?.mappings?.map((entry: any) => [entry.modern, entry.historical]), [['学', '學']]);
  assert.deepEqual(slice?.excludedModernCharacters, ['弁', '台']);

  const official = slice?.sources?.find((entry: any) => entry.id === 'bunkacho-joyo-character-form');
  assert.equal(official?.kind, 'primary_official');
  assert.match(official?.url ?? '', /^https:\/\/www\.bunka\.go\.jp\//);
  assert.match(official?.locator ?? '', /学\(學\)/);

  const project = slice?.sources?.find((entry: any) => entry.id === 'project-deterministic-layer-ruling');
  assert.equal(project?.issue, 2);
  assert.equal(project?.commentId, 5881690205);

  const mapping = slice?.mappings?.[0];
  assert.deepEqual(mapping?.evidenceRefs, ['ev-gaku-official', 'ev-gaku-project-layer']);
  assert.deepEqual(mapping?.regressionEvidenceRefs, ['ev-gaku-compat-profile']);
});

test('compatibility profile confirms behavior but explicitly does not confer generic safety', async () => {
  const [slice, legacy, manifest] = await Promise.all([
    loadSlice(),
    json('data/profiles/kinotch/legacy-kanji.json'),
    json('data/profiles/kinotch/manifest.json')
  ]);
  assert.equal(legacy.characterMap?.['学'], '學');
  const legacyPack = manifest.packs?.find((entry: any) => entry.id === 'legacy-kanji');
  assert.equal(legacyPack?.genericSafety, 'not_implied');

  const compat = slice?.evidenceRecords?.find((entry: any) => entry.id === 'ev-gaku-compat-profile');
  assert.equal(compat?.authority, 'regression_only');
  assert.equal(compat?.sourceRef, 'kinotch-legacy-compat-profile');
});

test('accepted safe-character slice loads in browser-class and Worker-class sandboxes', async () => {
  const slice = await loadSlice();
  assert.ok(slice);
  for (const globals of [{ window: {} }, { self: {} }]) {
    const sandbox = await loadRuntime(globals);
    const runtime = sandbox.SafeCharacterRuntime.createSafeCharacterRuntime(slice);
    assert.equal(runtime.apply('学校'), '學校');
  }
});
