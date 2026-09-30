import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { compileLexicalSourceSlice, type UniDicSourceSlice } from '../tools/lexical-compiler.ts';
import { buildResolverBundleArtifact } from '../tools/resolver-bundle.ts';

const SCHOOL = 'unidic-cwj:2025.12:lemma:8098';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function lexicalSource() {
  return await json('data/lexical/sources/unidic-cwj-202512-first-slice.json') as UniDicSourceSlice;
}

async function loadUmd(path: string, globals: Record<string, unknown> = {}) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

async function acceptedArtifact() {
  const [lexical, nativeSlice, sinoSlice, contextualBindingSlice, contextualManifest, contextualTaiPack, safeCharacterSlice] = await Promise.all([
    lexicalSource(),
    json('data/historical/native/kkh-kana-first-slice.json'),
    json('data/historical/sino/kkh-jion-first-slice.json'),
    json('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
    json('data/packs/contextual-kanji/manifest.json'),
    json('data/packs/contextual-kanji/merged-tai.json'),
    json('data/deterministic/safe-character-first-slice.json')
  ]);
  return buildResolverBundleArtifact({
    lexicalSource: lexical, nativeSlice, sinoSlice, contextualBindingSlice: contextualBindingSlice as any,
    contextualManifest, contextualTaiPack, safeCharacterSlice
  });
}

async function createBundleFunction() {
  const [lexical, native, sino, safe, shared] = await Promise.all([
    loadUmd('runtime/lexical-runtime.js'),
    loadUmd('runtime/historical-native-runtime.js'),
    loadUmd('runtime/historical-sino-runtime.js'),
    loadUmd('runtime/safe-character-runtime.js'),
    loadUmd('runtime/transform-shared.js')
  ]);
  const resolver = await loadUmd('runtime/orthography-resolver.js', { TransformShared: shared.TransformShared });
  const runtime = await loadUmd('runtime/resolver-bundle-runtime.js', {
    LexicalRuntime: lexical.LexicalRuntime,
    HistoricalNativeRuntime: native.HistoricalNativeRuntime,
    HistoricalSinoRuntime: sino.HistoricalSinoRuntime,
    SafeCharacterRuntime: safe.SafeCharacterRuntime,
    OrthographyResolver: resolver.OrthographyResolver
  });
  return runtime.ResolverBundleRuntime.createResolverBundle;
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('reading index is a deterministic secondary index over the shared candidate table', async () => {
  const source = await lexicalSource();
  const artifact = compileLexicalSourceSlice(source) as any;
  const again = compileLexicalSourceSlice(structuredClone(source)) as any;

  assert.ok(Array.isArray(artifact.readingIndex));
  assert.deepEqual(artifact.readingIndex, again.readingIndex);
  assert.deepEqual(artifact.sections.map((entry: any) => entry.id), ['lemmas', 'morphologies', 'candidates', 'surfaceIndex', 'readingIndex']);

  const readings = artifact.readingIndex.map((entry: any) => entry.reading);
  assert.deepEqual(readings, [...readings].sort((a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)));
  assert.equal(new Set(readings).size, readings.length);
  for (const entry of artifact.readingIndex) {
    assert.ok(entry.candidateIndexes.length > 0);
    assert.deepEqual(entry.candidateIndexes, [...entry.candidateIndexes].sort((a: number, b: number) => a - b));
    for (const index of entry.candidateIndexes) {
      assert.ok(artifact.candidates[index].modernReadings.includes(entry.reading));
    }
  }

  const school = artifact.readingIndex.find((entry: any) => entry.reading === 'がっこう');
  assert.equal(school.candidateIndexes.length, 1);
  assert.equal(artifact.lemmas[artifact.candidates[school.candidateIndexes[0]].lemmaIndex].lexicalIdentity, SCHOOL);
});

test('lexical runtime reading lookup reaches the same identity as surface lookup and keeps ambiguity', async () => {
  const artifact = compileLexicalSourceSlice(await lexicalSource());
  const { LexicalRuntime } = await loadUmd('runtime/lexical-runtime.js');
  const runtime = LexicalRuntime.createLexicalRuntime(artifact);
  assert.equal(typeof runtime.lookupReading, 'function');

  const byReading = runtime.lookupReading('がっこう');
  assert.equal(byReading.length, 1);
  assert.equal(byReading[0].lexicalIdentity, SCHOOL);
  assert.equal(byReading[0].surface, '学校');
  assert.equal(byReading[0].lexicalIdentity, runtime.lookup('学校')[0].lexicalIdentity);

  const ambiguous = runtime.lookupReading('あわ');
  assert.deepEqual(plain(ambiguous.map((candidate: any) => candidate.lexicalIdentity)).sort(), [
    'unidic-cwj:2025.12:lemma:1298',
    'unidic-cwj:2025.12:lemma:242'
  ]);
  assert.deepEqual(plain(runtime.lookupReading('みちご')), []);

  const withoutReadingIndex = structuredClone(artifact) as any;
  delete withoutReadingIndex.readingIndex;
  const legacy = LexicalRuntime.createLexicalRuntime(withoutReadingIndex);
  for (const entry of artifact.surfaceIndex) {
    assert.deepEqual(plain(runtime.lookup(entry.surface)), plain(legacy.lookup(entry.surface)));
  }
});

test('lexical runtime rejects an out-of-bounds reading index', async () => {
  const artifact = compileLexicalSourceSlice(await lexicalSource()) as any;
  artifact.readingIndex[0].candidateIndexes = [artifact.candidates.length];
  const { LexicalRuntime } = await loadUmd('runtime/lexical-runtime.js');
  const runtime = LexicalRuntime.createLexicalRuntime(artifact);
  assert.throws(() => runtime.lookupReading(artifact.readingIndex[0].reading), /reading index is out of bounds/);
});

test('bundle resolves a reading through the existing semantic resolver', async () => {
  const bundle = (await createBundleFunction())(await acceptedArtifact());
  assert.equal(typeof bundle.resolveReading, 'function');

  const school = bundle.resolveReading('がっこう');
  const bySurface = bundle.resolveUnit('学校');
  assert.equal(school.kind, 'resolved');
  assert.equal(school.sourceText, 'がっこう');
  assert.equal(school.lexicalIdentity, SCHOOL);
  assert.equal(school.lexicalIdentity, bySurface.lexicalIdentity);
  assert.equal(school.reconstructedSurface, '学校');
  assert.deepEqual(plain(school.reading), { modernSurface: 'がっこう', source: 'reading-input' });
  assert.deepEqual(plain(school.historical), plain(bySurface.historical));
  assert.equal(bundle.render(school, { mode: 'plain' }), '學校');
  assert.equal(bundle.render(school, { mode: 'ruby-whole-explicit' }), '｜學校《がくかう》');

  const ambiguous = bundle.resolveReading('あわ');
  assert.equal(ambiguous.kind, 'candidates');
  assert.equal(ambiguous.historical.disposition, 'CANDIDATES');
  assert.equal(ambiguous.lexicalIdentity, null);
  assert.equal(ambiguous.lexicalCandidates.length, 2);
  assert.equal(bundle.render(ambiguous, { mode: 'plain' }), 'あわ');

  const unknown = bundle.resolveReading('みちご');
  assert.equal(unknown.kind, 'unresolved');
  assert.equal(unknown.historical.disposition, 'UNRESOLVED');
  assert.equal(bundle.render(unknown, { mode: 'plain' }), 'みちご');

  assert.equal(bundle.resolveReading('がっこう', { protected: true }).kind, 'protected');
});

test('bundle integrity rejects reading index tampering and omission', async () => {
  const create = await createBundleFunction();
  const artifact = await acceptedArtifact() as any;

  const tampered = structuredClone(artifact);
  const school = tampered.lexicalArtifact.readingIndex.find((entry: any) => entry.reading === 'がっこう');
  school.candidateIndexes = [0];
  assert.throws(() => create(tampered), /lexical artifact section identity mismatch: readingIndex/);

  const omitted = structuredClone(artifact);
  omitted.lexicalArtifact.sections = omitted.lexicalArtifact.sections.filter((entry: any) => entry.id !== 'readingIndex');
  assert.throws(() => create(omitted), /missing resolver bundle lexical artifact section: readingIndex/i);
});
