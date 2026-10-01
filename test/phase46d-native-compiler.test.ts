import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeCheckoutText } from '../tools/verification-text.ts';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadCompiler(): Promise<Record<string, any> | null> {
  try {
    return await import('../tools/' + 'native-kana-compiler.ts') as Record<string, any>;
  } catch {
    return null;
  }
}

test('Phase 4.6D compiler exposes deterministic native authority compilation', async () => {
  const compiler = await loadCompiler();
  assert.equal(typeof compiler?.compileNativeKanaArtifact, 'function');
});

test('compiler output is stable under intake record reordering and closes provenance', async () => {
  const compiler = await loadCompiler();
  assert.ok(compiler, 'native kana compiler must exist');
  const [intake, identitySlice] = await Promise.all([
    json('data/intake/phase46d-native-kana.json'),
    json('data/historical/native/kkh-kana-first-slice.json')
  ]);

  const first = compiler.compileNativeKanaArtifact(intake, { identitySlice });
  const reversed = structuredClone(intake);
  reversed.records.reverse();
  const second = compiler.compileNativeKanaArtifact(reversed, { identitySlice });
  assert.deepEqual(second, first);

  assert.equal(first.schemaVersion, '2');
  assert.equal(first.kind, 'japanese-orthography-historical-native-artifact');
  assert.equal(first.lexicalNamespaceId, identitySlice.lexicalNamespaceId);
  assert.equal(first.sources.length, 5);
  assert.ok(first.surfaceRelations.every((entry: any) => entry.evidenceRefs.length > 0));
  assert.ok(first.readingRelations.every((entry: any) => entry.evidenceRefs.length > 0));
});

test('surface and reading evidence compile into separate native authority channels', async () => {
  const compiler = await loadCompiler();
  assert.ok(compiler, 'native kana compiler must exist');
  const artifact = compiler.compileNativeKanaArtifact(
    await json('data/intake/phase46d-native-kana.json'),
    { identitySlice: await json('data/historical/native/kkh-kana-first-slice.json') }
  );

  const ue = artifact.surfaceRelations.find((entry: any) => entry.surface === '植え');
  assert.equal(ue?.historicalSurface, '植ゑ');

  const aisatsuSurface = artifact.surfaceRelations.find((entry: any) => entry.surface === '挨拶');
  assert.equal(aisatsuSurface, undefined);
  const aisatsuReading = artifact.readingRelations.find((entry: any) => entry.surface === '挨拶');
  assert.equal(aisatsuReading?.historicalReading, 'あいさつ');

  assert.equal(artifact.readingRelations.some((entry: any) => entry.surface === '藍'), false);
  const aiCandidate = artifact.ambiguousReadingCandidates.find((entry: any) => entry.surface === '藍');
  assert.deepEqual(Array.from(aiCandidate.alternatives), ['あゐ', 'アヰ']);

  const aigoSurface = artifact.surfaceRelations.find((entry: any) => entry.surface === 'アイゴ');
  const aigoReading = artifact.readingRelations.find((entry: any) => entry.surface === 'アイゴ');
  assert.equal(aigoSurface?.historicalSurface, 'アヰゴ');
  assert.equal(aigoReading?.historicalReading, 'アヰゴ');
});

test('ambiguous source targets never compile as exact authority', async () => {
  const compiler = await loadCompiler();
  assert.ok(compiler, 'native kana compiler must exist');
  const artifact = compiler.compileNativeKanaArtifact(
    await json('data/intake/phase46d-native-kana.json'),
    { identitySlice: await json('data/historical/native/kkh-kana-first-slice.json') }
  );

  assert.equal(artifact.surfaceRelations.some((entry: any) => entry.surface === '味わおう'), false);
  const taste = artifact.ambiguousSurfaceCandidates.find((entry: any) => entry.surface === '味わおう');
  assert.deepEqual(Array.from(taste.alternatives), ['味ははう', '味はゝう']);

  assert.equal(artifact.readingRelations.some((entry: any) => entry.surface === '愛想'), false);
  const aiso = artifact.ambiguousReadingCandidates.find((entry: any) => entry.surface === '愛想');
  assert.deepEqual(Array.from(aiso.alternatives), ['あいさう', 'あいそ']);

  assert.equal(artifact.surfaceRelations.some((entry: any) => entry.surface === 'ビハインド'), false);
});

test('cross-source duplicate claims merge evidence instead of duplicating authority', async () => {
  const compiler = await loadCompiler();
  assert.ok(compiler, 'native kana compiler must exist');
  const artifact = compiler.compileNativeKanaArtifact(
    await json('data/intake/phase46d-native-kana.json'),
    { identitySlice: await json('data/historical/native/kkh-kana-first-slice.json') }
  );

  const mantis = artifact.readingRelations.filter((entry: any) => (
    entry.surface === '蟷螂' && entry.historicalReading === 'タウラウ'
  ));
  assert.equal(mantis.length, 1);
  assert.equal(mantis[0].evidenceRefs.length, 2);
  assert.deepEqual(
    Array.from(mantis[0].sourceRefs).sort(),
    ['phase46d-animal-plant', 'phase46d-native-dictionary']
  );
});

test('accepted 思う lexical identity and morphology anchor is preserved in the v2 artifact', async () => {
  const compiler = await loadCompiler();
  assert.ok(compiler, 'native kana compiler must exist');
  const identitySlice = await json('data/historical/native/kkh-kana-first-slice.json');
  const artifact = compiler.compileNativeKanaArtifact(
    await json('data/intake/phase46d-native-kana.json'),
    { identitySlice }
  );

  assert.equal(artifact.identityRelations.length, 1);
  const omou = artifact.identityRelations[0];
  assert.equal(omou.lexicalIdentity, 'unidic-cwj:2025.12:lemma:5255');
  assert.equal(omou.surface, '思う');
  assert.equal(omou.historicalSurface, '思ふ');
  assert.equal(omou.requiredMorphology.conjugationType, '五段-ワア行');
  assert.equal(omou.requiredMorphology.conjugationForm, '終止形-一般');
  assert.deepEqual(Array.from(omou.evidenceRefs), ['kkh-kana-omou-omofu']);
});

test('canonical Phase 4.6D native artifact is reproducible byte-for-byte', async () => {
  const compiler = await loadCompiler();
  assert.ok(compiler, 'native kana compiler must exist');
  const compiled = compiler.compileNativeKanaArtifact(
    await json('data/intake/phase46d-native-kana.json'),
    { identitySlice: await json('data/historical/native/kkh-kana-first-slice.json') }
  );
  const canonical = await readFile('data/historical/native/phase46d-native-kana.json', 'utf8');
  assert.equal(normalizeCheckoutText(canonical), `${JSON.stringify(compiled, null, 2)}\n`);
});
