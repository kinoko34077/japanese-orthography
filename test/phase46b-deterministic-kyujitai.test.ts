import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadRuntime() {
  const source = await readFile('runtime/safe-character-runtime.js', 'utf8');
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'runtime/safe-character-runtime.js' });
  return sandbox.SafeCharacterRuntime;
}

function minimalSlice() {
  return {
    schemaVersion: '1',
    kind: 'japanese-orthography-safe-character-slice',
    sources: [{ id: 'official', kind: 'primary_official', locator: '学(學)' }],
    evidenceRecords: [
      { id: 'ev-positive', sourceRef: 'official', role: 'same-character-form-authority' },
      { id: 'ev-ben', sourceRef: 'official', role: 'contextual-negative-control' },
      { id: 'ev-tai', sourceRef: 'official', role: 'guarded-fallback-negative-control' }
    ],
    excludedModernCharacters: ['弁', '台'],
    exclusionRecords: [
      { modern: '弁', reason: 'contextual', evidenceRefs: ['ev-ben'] },
      { modern: '台', reason: 'guarded', evidenceRefs: ['ev-tai'] }
    ],
    mappings: [{
      modern: '学',
      historical: '學',
      responsibility: 'character_form',
      admission: 'unconditional',
      intakeRecordRef: 'phase46b-character-gaku',
      evidenceRefs: ['ev-positive'],
      regressionEvidenceRefs: []
    }]
  };
}

test('4.6B character-form authority is represented by the cross-domain intake model', async () => {
  const intake = await json('data/intake/phase46b-character-form.json');
  assert.equal(intake.schemaVersion, '1');
  assert.equal(intake.kind, 'orthography_intake_bundle');

  const official = intake.snapshots.find((entry: any) => entry.sourceId === 'phase46b-bunkacho-joyo-character-form');
  assert.ok(official);
  assert.equal(official.sourceClass, 'official');
  assert.equal(official.coverageRole, 'supplemental');

  const kkh = intake.snapshots.find((entry: any) => entry.sourceId === 'phase46b-kkh-kanji-jisyo');
  assert.ok(kkh);
  assert.equal(kkh.sourceClass, 'external-repository');
  assert.equal(kkh.repository, 'okikae/kkh');
  assert.equal(kkh.commit, '19b24f88ab55809a186d88c465959548495b26a2');
  assert.equal(kkh.path, 'kanji-jisyo');
  assert.equal(kkh.blobSha, '95c5db9b5bacb82ab2a685f24f74fef3b32f9992');
  assert.equal(kkh.license, 'BSD-2-Clause');
  assert.equal(kkh.coverageRole, 'candidate-only');

  assert.deepEqual(
    intake.records.map((record: any) => [record.id, record.modernSurface, record.historicalSurface]),
    [
      ['phase46b-character-en', '円', '圓'],
      ['phase46b-character-ou', '応', '應'],
      ['phase46b-character-gaku', '学', '學'],
      ['phase46b-character-takara', '宝', '寶'],
      ['phase46b-character-ryu', '竜', '龍']
    ]
  );
  for (const record of intake.records) {
    assert.equal(record.sourceRecordKind, 'mapping', record.id);
    assert.equal(record.responsibility, 'character_form', record.id);
    assert.equal(record.disposition, 'admitted', record.id);
    assert.equal(record.sourceRef, 'phase46b-bunkacho-joyo-character-form', record.id);
    assert.ok(record.evidenceRefs.some((ref: string) => ref.startsWith('phase46b-bunkacho-joyo-character-form:')), record.id);
  }
  for (const modern of ['円', '応', '宝', '竜']) {
    const record = intake.records.find((entry: any) => entry.modernSurface === modern);
    assert.ok(record?.evidenceRefs.some((ref: string) => ref.startsWith('phase46b-kkh-kanji-jisyo:')), modern);
  }
  assert.equal(intake.records.some((entry: any) => ['弁', '台', '穗', '舖'].includes(entry.modernSurface)), false);
  assert.equal(intake.records.some((entry: any) => entry.historicalSurface === '寳'), false);
});

test('4.6B canonical deterministic authority is exactly the five bounded same-character pairs', async () => {
  const slice = await json('data/deterministic/safe-character-first-slice.json');
  assert.deepEqual(
    slice.mappings.map((entry: any) => [entry.modern, entry.historical]),
    [['円', '圓'], ['応', '應'], ['学', '學'], ['宝', '寶'], ['竜', '龍']]
  );
  for (const mapping of slice.mappings) {
    assert.equal(mapping.responsibility, 'character_form', mapping.modern);
    assert.equal(mapping.admission, 'unconditional', mapping.modern);
    assert.equal(typeof mapping.intakeRecordRef, 'string', mapping.modern);
    assert.equal(mapping.modern.normalize('NFC'), mapping.modern, mapping.modern);
    assert.equal(mapping.historical.normalize('NFC'), mapping.historical, mapping.modern);
  }
  assert.deepEqual(slice.excludedModernCharacters, ['弁', '台']);
  assert.equal(slice.mappings.some((entry: any) => entry.modern === '宝' && entry.historical === '寳'), false);
});

test('4.6B safe mappings close to matching admitted character_form intake records', async () => {
  const [slice, intake] = await Promise.all([
    json('data/deterministic/safe-character-first-slice.json'),
    json('data/intake/phase46b-character-form.json')
  ]);
  const records = new Map(intake.records.map((record: any) => [record.id, record]));
  for (const mapping of slice.mappings) {
    const record: any = records.get(mapping.intakeRecordRef);
    assert.ok(record, mapping.modern);
    assert.equal(record.responsibility, 'character_form', mapping.modern);
    assert.equal(record.disposition, 'admitted', mapping.modern);
    assert.equal(record.modernSurface, mapping.modern, mapping.modern);
    assert.equal(record.historicalSurface, mapping.historical, mapping.modern);
  }
});

test('4.6B pins KKH kanji-jisyo and closes new relations to official plus pinned evidence', async () => {
  const slice = await json('data/deterministic/safe-character-first-slice.json');
  const kkh = slice.sources.find((entry: any) => entry.id === 'kkh-kanji-jisyo-2.0.1');
  assert.ok(kkh);
  assert.equal(kkh.repository, 'okikae/kkh');
  assert.equal(kkh.commit, '19b24f88ab55809a186d88c465959548495b26a2');
  assert.equal(kkh.path, 'kanji-jisyo');
  assert.equal(kkh.blobSha, '95c5db9b5bacb82ab2a685f24f74fef3b32f9992');
  assert.equal(kkh.license, 'BSD-2-Clause');

  const evidenceById = new Map<string, any>(
    slice.evidenceRecords.map((entry: any) => [entry.id, entry] as [string, any])
  );
  const expected = new Map<string, readonly [string, string]>([
    ['円', ['ev-en-official', 'ev-en-kkh']],
    ['応', ['ev-ou-official', 'ev-ou-kkh']],
    ['宝', ['ev-hou-official', 'ev-hou-kkh']],
    ['竜', ['ev-ryu-official', 'ev-ryu-kkh']]
  ]);
  for (const [modern, refs] of expected) {
    const mapping = slice.mappings.find((entry: any) => entry.modern === modern);
    assert.ok(mapping, modern);
    assert.deepEqual(mapping.evidenceRefs, refs, modern);
    assert.equal(evidenceById.get(refs[0])?.sourceRef, 'bunkacho-joyo-character-form', modern);
    assert.equal(evidenceById.get(refs[1])?.sourceRef, 'kkh-kanji-jisyo-2.0.1', modern);
  }
});

test('safe-character runtime rejects wrong responsibility or admission', async () => {
  const runtime = await loadRuntime();
  for (const mutation of [
    { responsibility: 'merged_character', admission: 'unconditional' },
    { responsibility: 'character_form', admission: 'candidate_ambiguous' }
  ]) {
    const slice = structuredClone(minimalSlice());
    Object.assign(slice.mappings[0]!, mutation);
    assert.throws(() => runtime.createSafeCharacterRuntime(slice), /responsibility|admission/i);
  }
});

test('safe-character runtime rejects NFC-unstable mapping endpoints', async () => {
  const runtime = await loadRuntime();
  const unstableTarget = structuredClone(minimalSlice());
  unstableTarget.mappings[0]!.historical = '猪';
  assert.notEqual('猪'.normalize('NFC'), '猪');
  assert.throws(() => runtime.createSafeCharacterRuntime(unstableTarget), /NFC|normalization/i);

  const unstableSource = structuredClone(minimalSlice());
  unstableSource.mappings[0]!.modern = '猪';
  assert.throws(() => runtime.createSafeCharacterRuntime(unstableSource), /NFC|normalization/i);
});
