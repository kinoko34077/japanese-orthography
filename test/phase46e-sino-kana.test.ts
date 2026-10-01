import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { buildPhase46eSinoArtifacts } from '../tools/sino-kana.ts';
import { buildResolverBundleArtifact } from '../tools/resolver-bundle.ts';
import { normalizeCheckoutText } from '../tools/verification-text.ts';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function loadUmd(path: string, globals: Record<string, unknown> = {}) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

async function sinoRuntime() {
  const { HistoricalSinoRuntime } = await loadUmd('runtime/historical-sino-runtime.js');
  return HistoricalSinoRuntime.createHistoricalSinoRuntime(await json('data/historical/sino/phase46e-sino-kana.json'));
}

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test('字音 table extraction is complete and fully dispositioned', async () => {
  const { parsed, bundle, coverageReport } = await buildPhase46eSinoArtifacts(process.cwd());
  assert.equal(parsed.records.length, 2013);
  assert.deepEqual(parsed.remainders, []);
  assert.equal(parsed.headingReadings.length, 77);

  const source = coverageReport.sources[0]!;
  assert.equal(source.discovered, 2013);
  assert.equal(source.discovered, source.admitted + source.ambiguous + source.excluded);
  assert.equal(source.unclassified, 0);
  assert.equal(source.unexpected, 0);
  assert.equal(source.unparsedMappingRecords, 0);
  assert.equal(source.excluded, 2);
  assert.equal(source.identityRecords, 132);
  assert.equal(source.contextQualifiedRecords, 2);
  assert.deepEqual(
    bundle.records.filter((record) => record.disposition === 'excluded_unresolved').map((record) => record.exclusionReason).sort(),
    ['catch_all_statement', 'parenthesized_uncertain_entry']
  );
});

test('canonical 字音 artifacts are reproducible byte-for-byte', async () => {
  const { texts } = await buildPhase46eSinoArtifacts(process.cwd());
  for (const [path, text] of Object.entries(texts)) {
    assert.equal(normalizeCheckoutText(await readFile(path, 'utf8')), text, path);
  }
});

test('every admitted table relation is exactly reproducible through the direct component API', async () => {
  const runtime = await sinoRuntime();
  const intake = await json('data/intake/phase46e-sino-kana.json');
  let checked = 0;
  for (const record of intake.records) {
    if (record.disposition !== 'admitted') continue;
    const result = runtime.resolveHistoricalSino({
      character: record.modernSurface,
      modernReading: record.modernReading,
      context: record.morphology?.usage ?? null
    });
    assert.equal(result?.status, 'resolved', `${record.modernSurface}/${record.modernReading}`);
    assert.equal(result.historicalReading, record.historicalReading, `${record.modernSurface}/${record.modernReading}`);
    checked += 1;
  }
  assert.equal(checked, 2011);
});

test('context-qualified alternatives stay a complete candidate set without context', async () => {
  const runtime = await sinoRuntime();
  assert.deepEqual(plain(runtime.resolveHistoricalSino({ character: '法', modernReading: 'ほう' })), {
    status: 'candidates', historicalReadings: ['はふ', 'ほふ']
  });
  assert.equal(runtime.resolveHistoricalSino({ character: '法', modernReading: 'ほう', context: '仏教用語' }).historicalReading, 'ほふ');
  assert.equal(runtime.resolveHistoricalSino({ character: '法', modernReading: 'ほう', context: '未知' }), null);
  assert.equal(runtime.resolveHistoricalSino({ character: '学', modernReading: 'さん' }), null);
});

test('word-level reconstruction aligns readings and preserves ambiguity', async () => {
  const runtime = await sinoRuntime();
  assert.equal(runtime.reconstructWord('学校', 'がっこう').historicalReading, 'がくかう');
  assert.equal(runtime.reconstructWord('法被', 'はっぴ').historicalReading, 'はっぴ');
  assert.equal(runtime.reconstructWord('台風', 'たいふう').historicalReading, 'たいふう');
  assert.equal(runtime.reconstructWord('銀行', 'ぎんこう').historicalReading, 'ぎんかう');

  const law = runtime.reconstructWord('法', 'ほう');
  assert.equal(law.status, 'candidates');
  assert.deepEqual(plain(law.historicalReadings), ['はふ', 'ほふ']);

  // A geminated coda whose underlying reading is not in the table cannot be guessed.
  assert.equal(runtime.reconstructWord('仏法', 'ぶっぽう'), null);
  // Kana in the surface is outside the direct 字音 scope.
  assert.equal(runtime.reconstructWord('学ぶ', 'まなぶ'), null);
});

test('resolver bundle uses the 4.6E artifact while identity relations keep precedence', async () => {
  const [lexicalSource, nativeSlice, sinoSlice, contextualBindingSlice, contextualManifest, contextualTaiPack, safeCharacterSlice] = await Promise.all([
    json('data/lexical/sources/unidic-cwj-202512-first-slice.json'),
    json('data/historical/native/phase46d-native-kana.json'),
    json('data/historical/sino/phase46e-sino-kana.json'),
    json('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
    json('data/packs/contextual-kanji/manifest.json'),
    json('data/packs/contextual-kanji/merged-tai.json'),
    json('data/deterministic/safe-character-first-slice.json')
  ]);
  const artifact = buildResolverBundleArtifact({
    lexicalSource, nativeSlice, sinoSlice, contextualBindingSlice, contextualManifest, contextualTaiPack, safeCharacterSlice
  } as any);
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
  const bundle = runtime.ResolverBundleRuntime.createResolverBundle(artifact);

  const school = bundle.resolveUnit('学校');
  assert.equal(school.historical.kana, 'がくかう');
  assert.equal(school.historical.surface, '學校');

  const taifu = bundle.resolveUnit('台風');
  assert.equal(taifu.historical.route, 'sino');
  assert.equal(taifu.historical.kana, 'たいふう');
  assert.equal(taifu.historical.surface, '颱風');

  assert.equal(bundle.resolveHistoricalSino({ character: '校', modernReading: 'こう' }).historicalReading, 'かう');
});
