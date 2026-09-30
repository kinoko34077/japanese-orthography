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

test('source-backed safe-character slice admits the bounded five-pair Culture Agency set', async () => {
  const slice = await loadSlice();
  assert.equal(slice?.schemaVersion, '1');
  assert.equal(slice?.kind, 'japanese-orthography-safe-character-slice');
  assert.deepEqual(slice?.mappings?.map((entry: any) => [entry.modern, entry.historical]), [
    ['円', '圓'],
    ['応', '應'],
    ['学', '學'],
    ['宝', '寶'],
    ['竜', '龍']
  ]);
  assert.deepEqual(slice?.excludedModernCharacters, ['弁', '台']);

  const official = slice?.sources?.find((entry: any) => entry.id === 'bunkacho-joyo-character-form');
  assert.equal(official?.kind, 'primary_official');
  assert.match(official?.url ?? '', /^https:\/\/www\.bunka\.go\.jp\//);
  for (const [modern, historical] of [['円', '圓'], ['応', '應'], ['学', '學'], ['宝', '寶'], ['竜', '龍']] as const) {
    assert.match(official?.locator ?? '', new RegExp(`${modern}\\(${historical}\\)`));
  }

  const evidenceById = new Map((slice?.evidenceRecords ?? []).map((entry: any) => [entry.id, entry]));
  for (const mapping of slice?.mappings ?? []) {
    assert.equal(mapping.admission, 'unconditional');
    assert.equal(Array.from(mapping.modern).length, 1);
    assert.equal(Array.from(mapping.historical).length, 1);
    assert.equal(mapping.historical.normalize('NFC'), mapping.historical);
    assert.equal(mapping.historical.normalize('NFKC'), mapping.historical);
    assert.ok(Array.isArray(mapping.evidenceRefs) && mapping.evidenceRefs.length > 0);
    assert.ok(mapping.evidenceRefs.some((id: string) => evidenceById.get(id)?.sourceRef === 'bunkacho-joyo-character-form'));
  }

  const project = slice?.sources?.find((entry: any) => entry.id === 'project-deterministic-layer-ruling');
  assert.equal(project?.issue, 2);
  assert.equal(project?.commentId, 5881690205);

  const gaku = slice?.mappings?.find((entry: any) => entry.modern === '学');
  assert.deepEqual(gaku?.evidenceRefs, ['ev-gaku-official', 'ev-gaku-project-layer']);
  assert.deepEqual(gaku?.regressionEvidenceRefs, ['ev-gaku-compat-profile']);
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

test('contextual negative controls retain their own project rulings instead of borrowing 学 evidence', async () => {
  const slice = await loadSlice();
  const benSource = slice?.sources?.find((entry: any) => entry.id === 'project-ben-contextual-ruling');
  const taiSource = slice?.sources?.find((entry: any) => entry.id === 'project-tai-guarded-ruling');
  assert.equal(benSource?.issue, 2);
  assert.equal(benSource?.commentId, 5881995193);
  assert.equal(taiSource?.issue, 2);
  assert.equal(taiSource?.commentId, 5882033932);

  const benEvidence = slice?.evidenceRecords?.find((entry: any) => entry.id === 'ev-ben-contextual-negative');
  const taiEvidence = slice?.evidenceRecords?.find((entry: any) => entry.id === 'ev-tai-guarded-negative');
  assert.equal(benEvidence?.sourceRef, 'project-ben-contextual-ruling');
  assert.equal(taiEvidence?.sourceRef, 'project-tai-guarded-ruling');

  const benExclusion = slice?.exclusionRecords?.find((entry: any) => entry.modern === '弁');
  const taiExclusion = slice?.exclusionRecords?.find((entry: any) => entry.modern === '台');
  assert.deepEqual(benExclusion?.evidenceRefs, ['ev-ben-contextual-negative']);
  assert.deepEqual(taiExclusion?.evidenceRefs, ['ev-tai-guarded-negative']);
});

test('accepted safe-character slice loads in browser-class and Worker-class sandboxes', async () => {
  const slice = await loadSlice();
  assert.ok(slice);
  for (const globals of [{ window: {} }, { self: {} }]) {
    const sandbox = await loadRuntime(globals);
    const runtime: { apply(value: string): string } = sandbox.SafeCharacterRuntime.createSafeCharacterRuntime(slice);
    assert.equal(runtime.apply('円応学宝竜'), '圓應學寶龍');
    assert.equal(runtime.apply('弁台'), '弁台');
  }
});
