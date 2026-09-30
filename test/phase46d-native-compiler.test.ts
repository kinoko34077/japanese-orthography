import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildPhase46dNativeKanaDocuments } from '../tools/generate-native-kana.ts';
import { compileNativeKanaArtifact, serializeNativeKanaArtifact } from '../tools/native-kana-compiler.ts';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

function tupleFor(entries: any[], surface: string) {
  return entries.find(entry => entry[0] === surface);
}

test('Phase 4.6D native compiler is deterministic and independent of intake order', async () => {
  const [generated, anchor] = await Promise.all([
    buildPhase46dNativeKanaDocuments(process.cwd()),
    json('data/historical/native/kkh-kana-first-slice.json')
  ]);
  const first = compileNativeKanaArtifact(generated.intake, { legacyAnchorSlice: anchor });
  const reversed = compileNativeKanaArtifact({
    ...generated.intake,
    snapshots: [...generated.intake.snapshots].reverse(),
    records: [...generated.intake.records].reverse()
  }, { legacyAnchorSlice: structuredClone(anchor) });

  assert.deepEqual(reversed, first);
  assert.equal(first.schemaVersion, '2');
  assert.equal(first.kind, 'japanese-orthography-historical-native-slice');
  assert.match(first.artifactContentId, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    first.sources.map((source: any) => source.sourceId),
    [...first.sources.map((source: any) => source.sourceId)].sort()
  );
});

test('compiler separates exact rendered surfaces from historical reading evidence', async () => {
  const [generated, anchor] = await Promise.all([
    buildPhase46dNativeKanaDocuments(process.cwd()),
    json('data/historical/native/kkh-kana-first-slice.json')
  ]);
  const artifact = compileNativeKanaArtifact(generated.intake, { legacyAnchorSlice: anchor });

  const ue = tupleFor(artifact.surfaceRelations, '植え');
  assert.equal(ue?.[1], '植ゑ');

  const aiReading = tupleFor(artifact.readingRelations, '藍');
  assert.equal(aiReading?.[1], 'あゐ');
  assert.equal(tupleFor(artifact.surfaceRelations, '藍'), undefined);

  const aigoSurface = tupleFor(artifact.surfaceRelations, 'アイゴ');
  assert.equal(aigoSurface?.[1], 'アヰゴ');
  const aigoReading = tupleFor(artifact.readingRelations, 'アイゴ');
  assert.equal(aigoReading?.[1], 'アヰゴ');
});

test('compiler preserves ambiguity and never emits an exact relation for a conflicting surface', async () => {
  const [generated, anchor] = await Promise.all([
    buildPhase46dNativeKanaDocuments(process.cwd()),
    json('data/historical/native/kkh-kana-first-slice.json')
  ]);
  const artifact = compileNativeKanaArtifact(generated.intake, { legacyAnchorSlice: anchor });

  assert.equal(tupleFor(artifact.surfaceRelations, '味わおう'), undefined);
  const candidate = tupleFor(artifact.surfaceCandidates, '味わおう');
  assert.deepEqual(candidate?.[1], ['味ははう', '味はゝう']);
  assert.ok(Array.isArray(candidate?.[2]) && candidate[2].length === 2);
});

test('compiler merges duplicate provenance without using source order as authority', async () => {
  const [generated, anchor] = await Promise.all([
    buildPhase46dNativeKanaDocuments(process.cwd()),
    json('data/historical/native/kkh-kana-first-slice.json')
  ]);
  const duplicate = {
    id: 'phase46d-test-cross-source-duplicate',
    sourceRef: 'phase46d-committed-animal-plant',
    sourceLocator: 'test:duplicate-ue',
    sourceRecordKind: 'mapping',
    responsibility: 'historical_kana_native',
    disposition: 'admitted',
    modernSurface: '植え',
    historicalSurface: '植ゑ',
    evidenceRefs: ['test:duplicate-ue']
  };
  const artifact = compileNativeKanaArtifact({
    ...generated.intake,
    records: [...generated.intake.records, duplicate]
  } as any, { legacyAnchorSlice: anchor });

  const relation = tupleFor(artifact.surfaceRelations, '植え');
  assert.equal(relation?.[1], '植ゑ');
  assert.equal(relation?.[2].length, 2);
});

test('compiler carries the accepted 思う lexical identity+morphology anchor into the Phase 4.6D artifact', async () => {
  const [generated, anchor] = await Promise.all([
    buildPhase46dNativeKanaDocuments(process.cwd()),
    json('data/historical/native/kkh-kana-first-slice.json')
  ]);
  const artifact = compileNativeKanaArtifact(generated.intake, { legacyAnchorSlice: anchor });
  assert.equal(artifact.identityRelations.length, 1);
  assert.deepEqual(artifact.identityRelations[0], {
    lexicalIdentity: 'unidic-cwj:2025.12:lemma:5255',
    surface: '思う',
    historicalSurface: '思ふ',
    requiredMorphology: {
      conjugationType: '五段-ワア行',
      conjugationForm: '終止形-一般'
    },
    provenance: [[
      artifact.sources.findIndex((source: any) => source.sourceId === 'phase46d-kkh-kana-jisyo'),
      'line:606'
    ]]
  });
});

test('canonical Phase 4.6D native artifact is exactly reproducible byte-for-byte from intake plus accepted anchor', async () => {
  const [generated, anchor, committedText] = await Promise.all([
    buildPhase46dNativeKanaDocuments(process.cwd()),
    json('data/historical/native/kkh-kana-first-slice.json'),
    readFile('data/historical/native/phase46d-native-kana.json', 'utf8')
  ]);
  const compiled = compileNativeKanaArtifact(generated.intake, { legacyAnchorSlice: anchor });
  assert.equal(committedText, serializeNativeKanaArtifact(compiled));
  assert.deepEqual(JSON.parse(committedText), compiled);
});
