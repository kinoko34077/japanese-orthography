import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateCoverageAccounting } from '../tools/intake-accounting.ts';
import { buildPhase46dNativeKanaDocuments, buildPhase46dNativeKanaMaterialization } from '../tools/generate-native-kana.ts';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

function sourceRecords(generated: Awaited<ReturnType<typeof buildPhase46dNativeKanaDocuments>>, sourceId: string) {
  return generated.intake.records.filter(record => record.sourceRef === sourceId);
}

test('Phase 4.6D KKH intake exactly partitions active, ambiguous, and disabled mappings', async () => {
  const generated = await buildPhase46dNativeKanaDocuments(process.cwd());
  const snapshot = generated.intake.snapshots.find(item => item.sourceId === 'phase46d-kkh-kana-jisyo');
  assert.deepEqual(snapshot, {
    sourceId: 'phase46d-kkh-kana-jisyo',
    sourceClass: 'external-repository',
    repository: 'okikae/kkh',
    commit: '19b24f88ab55809a186d88c465959548495b26a2',
    path: 'kana-jisyo',
    blobSha: '6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be',
    license: 'BSD-2-Clause',
    coverageRole: 'coverage-contract'
  });

  const records = sourceRecords(generated, 'phase46d-kkh-kana-jisyo');
  assert.equal(records.length, 7408);
  assert.equal(records.filter(record => record.disposition === 'admitted').length, 6953);
  assert.equal(records.filter(record => record.disposition === 'candidate_ambiguous').length, 198);
  assert.equal(records.filter(record => record.disposition === 'excluded_unresolved').length, 257);

  const disabled = records.filter(record => record.sourceRecordKind === 'disabled');
  assert.equal(disabled.length, 257);
  assert.ok(disabled.every(record => (
    record.disposition === 'excluded_unresolved' &&
    record.responsibility === 'preserve_unresolved' &&
    record.exclusionReason === 'source_disabled'
  )));

  const taste = records.filter(record => record.modernSurface === '味わおう');
  assert.equal(taste.length, 2);
  assert.deepEqual(
    taste.map(record => [record.sourceLocator, record.disposition, record.alternatives]).sort(),
    [
      ['line:166', 'candidate_ambiguous', ['味ははう', '味はゝう']],
      ['line:167', 'candidate_ambiguous', ['味ははう', '味はゝう']]
    ]
  );
  assert.equal(taste.some(record => record.historicalSurface != null), false);
});

test('committed dictionary intake separates historical reading evidence from unsafe structural pairing', async () => {
  const generated = await buildPhase46dNativeKanaDocuments(process.cwd());
  const records = sourceRecords(generated, 'phase46d-committed-native-dictionary');

  const ai = records.find(record => record.sourceLocator === 'entry:1');
  assert.equal(ai?.disposition, 'admitted');
  assert.equal(ai?.responsibility, 'historical_kana_native');
  assert.equal(ai?.modernSurface, '藍');
  assert.equal(ai?.historicalReading, 'あゐ');
  assert.equal(ai?.historicalSurface, undefined);

  const aiso = records.find(record => record.sourceLocator === 'entry:3');
  assert.equal(aiso?.disposition, 'candidate_ambiguous');
  assert.equal(aiso?.modernSurface, '愛想');
  assert.deepEqual(aiso?.alternatives, ['あいさう', 'あいそ']);
  assert.equal(aiso?.historicalSurface, undefined);

  const aji = records.find(record => record.sourceLocator === 'entry:22');
  assert.equal(aji?.disposition, 'excluded_unresolved');
  assert.equal(aji?.responsibility, 'preserve_unresolved');
  assert.equal(aji?.exclusionReason, 'source_structure_requires_manual_disambiguation');

  const animal = sourceRecords(generated, 'phase46d-committed-animal-plant');
  const aigo = animal.find(record => record.sourceLocator === 'entry:2');
  assert.equal(aigo?.modernSurface, 'アイゴ');
  assert.equal(aigo?.historicalReading, 'アヰゴ');
  assert.equal(aigo?.disposition, 'admitted');
});

test('exception verbs and guide records remain countable exclusions until a modern-surface derivation is explicit', async () => {
  const generated = await buildPhase46dNativeKanaDocuments(process.cwd());
  const exceptions = sourceRecords(generated, 'phase46d-committed-exception-verbs');
  assert.equal(exceptions.length, 111);
  assert.ok(exceptions.every(record => (
    record.disposition === 'excluded_unresolved' &&
    record.exclusionReason === 'requires_modern_surface_derivation'
  )));

  const guide = sourceRecords(generated, 'phase46d-committed-native-guide');
  assert.equal(guide.length, 255);
  assert.ok(guide.every(record => (
    record.disposition === 'excluded_unresolved' &&
    record.exclusionReason === 'non_transformational_explanation'
  )));
});

test('all five native source contracts have zero unclassified/unexpected/remainder and generated files are canonical', async () => {
  const generated = await buildPhase46dNativeKanaDocuments(process.cwd());
  assert.equal(generated.sources.length, 5);

  for (const source of generated.sources) {
    const diagnostics = validateCoverageAccounting({
      snapshot: source.snapshot,
      discoveredRecordIds: source.parseResult.discoveredRecordIds,
      records: generated.intake.records,
      remainders: source.parseResult.remainders
    });
    assert.deepEqual(diagnostics, [], source.snapshot.sourceId);
  }

  const reportBySource = new Map(generated.coverageReport.sources.map(source => [source.sourceId, source]));
  assert.deepEqual(reportBySource.get('phase46d-kkh-kana-jisyo'), {
    sourceId: 'phase46d-kkh-kana-jisyo',
    discovered: 7408,
    admitted: 6953,
    ambiguous: 198,
    excluded: 257,
    unclassified: 0,
    unexpected: 0,
    unparsedMappingRecords: 0
  });

  const materialization = buildPhase46dNativeKanaMaterialization(generated);
  const root = materialization.find(item => item.path === 'data/intake/phase46d-native-kana.json');
  assert.deepEqual((root?.value as any)?.snapshots, generated.intake.snapshots);
  assert.deepEqual((root?.value as any)?.records, []);

  const materializedRecords = materialization
    .filter(item => item.path.startsWith('data/intake/phase46d-native-kana/records-'))
    .flatMap(item => (item.value as any).records);
  assert.deepEqual(materializedRecords, generated.intake.records);

  for (const artifact of materialization) {
    assert.deepEqual(await json(artifact.path), artifact.value, artifact.path);
  }
});
