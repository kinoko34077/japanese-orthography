import assert from 'node:assert/strict';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { encodeSection } from '../tools/browser-pack-encoding.ts';
import {
  buildLexicalModel, FORM_FLAGS, lexicalLayer, readLexicalLayer, READING_PERIODS, unidicLexemeMorphology
} from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION, validateBrowserPackManifest, verifyBrowserPackSections } from '../tools/browser-pack-model.ts';
import { HISTORICAL_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { lexicalFixture } from './fixtures/browser-pack-fixture.ts';

const graph = lexicalFixture();
const morphology = unidicLexemeMorphology({
  schemaVersion: '1', kind: 'unidic_cwj_source_slice', source: {} as never,
  records: [{ surface: '学校', pos: ['名詞', '普通名詞', '一般', '*'], cType: '*', cForm: '*', lForm: 'ガッコウ', lemma: '学校', orth: '学校', orthBase: '学校', goshu: '漢', kana: 'ガッコウ', kanaBase: 'ガッコウ', form: 'ガッコウ', formBase: 'ガッコウ', lid: '1', sourceLemmaId: 1 }]
}, new Set(['lexeme:学校/がっこう']));
const compile = (g = graph, opts = {}) => compileBrowserPack(g, [MODERN_PROFILE, HISTORICAL_PROFILE], {
  shardBudgetBytes: 2048, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION,
  layers: [lexicalLayer({ morphology, lexemeShardSize: 3, indexShardBudgetBytes: 64, ...opts })]
});
const build = compile();
const layer = readLexicalLayer(build);
const bodiesById = (files: Map<string, Uint8Array>) => new Map(build.manifest.sections.map((s) => [s.sectionId, files.get(s.path)!]));

test('a v2 pack validates, keeps the canonical identity lock and verifies every section digest', () => {
  const manifest = validateBrowserPackManifest(JSON.parse(JSON.stringify(build.manifest)));
  assert.equal(manifest.compilerVersion, '2');
  assert.equal(manifest.lexicalNamespaceId, graph.lexicalNamespaceId);
  verifyBrowserPackSections(manifest, bodiesById(build.files));
  for (const kind of ['surface-index', 'reading-index', 'lexeme-table', 'lexeme-forms', 'lexeme-readings', 'morphology-table', 'lexical-directory']) {
    assert.ok(manifest.sections.some((s) => s.kind === kind), kind);
  }
  assert.ok(manifest.sections.filter((s) => s.kind === 'lexeme-table').length > 1, 'fixture exercises several lexeme shards');
});

test('v1 packs stay v1: v2 kinds are rejected without the v2 compiler version', () => {
  const v1 = compileBrowserPack(graph, [MODERN_PROFILE], { shardBudgetBytes: 2048 });
  assert.equal(v1.manifest.compilerVersion, '1');
  const smuggled = { ...build.manifest, compilerVersion: '1' };
  assert.throws(() => validateBrowserPackManifest(smuggled), /not part of compiler version 1/);
});

test('学校 by surface and がっこう by reading converge on one lexical identity; ambiguity is kept', () => {
  const bySurface = layer.lookupSurface('学校').map((l) => l.lexicalIdentity);
  assert.deepEqual(bySurface, ['lexeme:学校/がっこう']);
  const byReading = layer.lookupReading('がっこう').map((l) => l.lexicalIdentity).sort();
  assert.deepEqual(byReading, ['lexeme:学校/がっこう', 'lexeme:楽校/がっこう']);
  const school = layer.lookupSurface('學校')[0]!;
  assert.equal(school.lexicalIdentity, 'lexeme:学校/がっこう');
  assert.deepEqual(school.readings.filter((r) => r.period === READING_PERIODS.historical).map((r) => [r.surface, r.reading]), [['学校', 'がくかう']]);
  assert.equal(morphology.get('lexeme:学校/がっこう')?.length, 1);
  assert.deepEqual(layer.morphologies[school.morphologyIds[0]!]?.pos, ['名詞', '普通名詞', '一般']);
  // historical reading is itself a reading-index key reaching the same identity
  assert.deepEqual(layer.lookupReading('がくかう').map((l) => l.lexicalIdentity), ['lexeme:学校/がっこう']);
});

test('ドイツ reaches the lexeme carrying 独逸 / 独乙 with their JMdict form tags', () => {
  const [germany, ...rest] = layer.lookupReading('ドイツ');
  assert.equal(rest.length, 0);
  assert.deepEqual(germany!.forms.map((f) => f.surface).sort(), ['独乙', '独逸']);
  const zhuyi = germany!.forms.find((f) => f.surface === '独逸')!;
  assert.ok(zhuyi.flags & FORM_FLAGS.ateji && zhuyi.flags & FORM_FLAGS.rK && zhuyi.flags & FORM_FLAGS.listed);
  assert.ok(germany!.forms.every((f) => graph.facts[f.factIndex]!.surface === f.surface), 'provenance maps back to canonical facts');
});

test('みる keeps every lexical candidate; kana-only lexemes are reachable by reading', () => {
  assert.deepEqual(layer.lookupReading('みる').map((l) => l.lexicalIdentity).sort(), ['lexeme:見る/みる', 'lexeme:診る/みる']);
  assert.deepEqual(layer.lookupReading('ドキドキ').map((l) => [l.lexicalIdentity, l.forms.length]), [['lexeme:ドキドキ/ドキドキ', 0]]);
});

test('the compiled layer equals the in-memory model and compilation is deterministic', () => {
  const model = buildLexicalModel(graph, morphology);
  assert.deepEqual(layer.lexemes, model.lexemes);
  assert.deepEqual([...layer.surfaceIndex], [...model.surfaceIndex]);
  assert.deepEqual([...layer.readingIndex], [...model.readingIndex]);
  assert.equal(compile().manifest.packDigest, build.manifest.packDigest);
});

test('corrupt bytes and dangling references fail closed', () => {
  const section = build.manifest.sections.find((s) => s.kind === 'reading-index')!;
  const corrupt = new Map(build.files);
  const bytes = new Uint8Array(corrupt.get(section.path)!); bytes[bytes.length - 1]! ^= 0xff; corrupt.set(section.path, bytes);
  assert.throws(() => verifyBrowserPackSections(build.manifest, bodiesById(corrupt)));

  // structurally valid bytes that point at a lexeme id that does not exist
  const dangling = new Map(build.files);
  dangling.set(section.path, encodeSection([
    { name: 'strings', kind: 'strings', values: ['', section.shard!.from] },
    { name: 'key', kind: 'scalar', values: [1] },
    { name: 'lexemes', kind: 'list', values: [[9999]] }
  ]));
  assert.throws(() => readLexicalLayer({ manifest: build.manifest, files: dangling }), /dangling lexeme id 9999/);

  const table = build.manifest.sections.find((s) => s.kind === 'lexeme-table')!;
  const badMorph = new Map(build.files);
  badMorph.set(table.path, encodeSection([
    { name: 'strings', kind: 'strings', values: ['', 'lexeme:x/x'] },
    { name: 'identity', kind: 'scalar', values: [1, 1, 1] }, { name: 'morphology', kind: 'list', values: [[77], [], []] }
  ]));
  assert.throws(() => readLexicalLayer({ manifest: build.manifest, files: badMorph }), /dangling morphology id 77/);
});
