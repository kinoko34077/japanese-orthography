import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { lexicalLayer, unidicLexemeMorphology } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION } from '../tools/browser-pack-model.ts';
import { HISTORICAL_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { lexicalFixture } from './fixtures/browser-pack-fixture.ts';

const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');

const graph = lexicalFixture();
const morphology = unidicLexemeMorphology({
  schemaVersion: '1', kind: 'unidic_cwj_source_slice', source: {} as never,
  records: [{ surface: '学校', pos: ['名詞', '普通名詞', '一般', '*'], cType: '*', cForm: '*', lForm: 'ガッコウ', lemma: '学校', orth: '学校', orthBase: '学校', goshu: '漢', kana: 'ガッコウ', kanaBase: 'ガッコウ', form: 'ガッコウ', formBase: 'ガッコウ', lid: '1', sourceLemmaId: 1 }]
}, new Set(['lexeme:学校/がっこう']));
const build = compileBrowserPack(graph, [MODERN_PROFILE, HISTORICAL_PROFILE], {
  shardBudgetBytes: 2048, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION,
  layers: [lexicalLayer({ morphology, lexemeShardSize: 3, indexShardBudgetBytes: 64 })]
});
const open = async () => {
  const requested: string[] = [];
  const pack = await openBrowserPack(build.manifest, async (s: { sectionId: string; path: string }) => { requested.push(s.sectionId); return build.files.get(s.path)!; });
  return { pack, lexical: createBrowserLexicalRuntime(pack), requested };
};

test('がっこう and 学校 converge on one identity with the accepted candidate shape', async () => {
  const { lexical } = await open();
  const [school, ...others] = await lexical.lookupSurface('学校');
  assert.equal(others.length, 0);
  assert.equal(school.lexicalIdentity, 'lexeme:学校/がっこう');
  assert.equal(school.lemma, '学校');
  assert.equal(school.reading, 'がっこう');
  assert.deepEqual(school.modernReadings, ['がっこう']);
  assert.deepEqual(school.morphology, { partOfSpeech: ['名詞', '普通名詞', '一般'], conjugationType: null, conjugationForm: null, source: 'unidic' });
  assert.deepEqual(school.viableBindingIds, ['lexeme:学校/がっこう']);
  assert.deepEqual(school.historicalReadings.map((h: any) => [h.surface, h.reading]), [['学校', 'がくかう']]);
  assert.equal(school.lexicalOrigin, 'sino');
  const byReading = await lexical.lookupReading('がっこう');
  assert.deepEqual(byReading.map((c: any) => [c.lexicalIdentity, c.surface]).sort(), [['lexeme:学校/がっこう', '学校'], ['lexeme:楽校/がっこう', '楽校']]);
  // an ambiguous reading stays a candidate list; nothing picks a winner
  assert.equal(byReading.length, 2);
});

test('ドイツ exposes 独逸 / 独乙; the reconstructed surface is the one the identity names', async () => {
  const { lexical } = await open();
  const [germany, ...rest] = await lexical.lookupReading('ドイツ');
  assert.equal(rest.length, 0);
  assert.deepEqual(germany.forms.map((f: any) => f.surface).sort(), ['独乙', '独逸']);
  assert.ok(germany.forms.find((f: any) => f.surface === '独逸').flags.includes('ateji'));
  assert.equal(germany.surface, '独逸');
});

test('みる keeps every lexical candidate; getLexeme/getForms/getReadings/getMorphology agree', async () => {
  const { lexical } = await open();
  const miru = await lexical.lookupReading('みる');
  assert.deepEqual(miru.map((c: any) => c.lexicalIdentity).sort(), ['lexeme:見る/みる', 'lexeme:診る/みる']);
  const see = miru.find((c: any) => c.lexicalIdentity === 'lexeme:見る/みる');
  assert.equal(see.surface, '見る');
  const forms = await lexical.getForms(see.lexemeId);
  assert.deepEqual(forms.map((f: any) => f.surface), ['見る', '観る']);
  const readings = await lexical.getReadings(see.lexemeId);
  assert.ok(readings.every((r: any) => r.reading === 'みる' && r.period === 'modern'));
  assert.deepEqual(lexical.getMorphology(0).partOfSpeech, ['名詞', '普通名詞', '一般']);
  assert.throws(() => lexical.getMorphology(99), RangeError);
  await assert.rejects(lexical.getLexeme(10_000), RangeError);
});

test('demand loading: open fetches only eager sections; lookups fetch only the shards they reach', async () => {
  const { lexical, requested } = await open();
  const eager = build.manifest.sections.filter((s) => s.loading === 'eager').map((s) => s.sectionId).sort();
  assert.deepEqual([...requested].sort(), eager);
  await lexical.lookupSurface('学校');
  const fetched = requested.slice(eager.length);
  assert.ok(fetched.every((id) => /^(surface-index@surface|lexeme-(table|forms|readings)@lexeme)\//.test(id)), fetched.join());
  assert.equal(fetched.filter((id) => id.startsWith('lexeme-table')).length, 1);
  assert.ok(build.manifest.sections.filter((s) => s.kind === 'lexeme-table').length > 1);
  assert.equal(lexical.loadedShards().lexeme, 1);
});

test('prepare + matchesAtSync keep UTF-16 offsets across emoji and surrogate pairs', async () => {
  const { lexical } = await open();
  const text = '😀学校と𠮷見る';
  await lexical.prepare(text);
  const at = (start: number) => lexical.matchesAtSync(text, start).map((m: any) => [m.start, m.end, m.surface, m.candidates.map((c: any) => c.lexicalIdentity)]);
  assert.deepEqual(at(2), [[2, 4, '学校', ['lexeme:学校/がっこう']]]);
  assert.deepEqual(at(7), [[7, 9, '見る', ['lexeme:見る/みる']]]);
  assert.deepEqual(at(0), []);
  assert.equal(text.slice(7, 9), '見る');
});

test('a v1 pack is rejected and a corrupt lexical shard fails closed without caching', async () => {
  const v1 = compileBrowserPack(graph, [MODERN_PROFILE], { shardBudgetBytes: 2048 });
  const v1pack = await openBrowserPack(v1.manifest, async (s: { path: string }) => v1.files.get(s.path)!);
  assert.throws(() => createBrowserLexicalRuntime(v1pack), /v2/);
  let corrupt = true;
  const pack = await openBrowserPack(build.manifest, async (s: { kind: string; path: string }) => {
    const body = build.files.get(s.path)!;
    if (s.kind === 'surface-index' && corrupt) { const b = new Uint8Array(body); b[b.length - 1]! ^= 1; return b; }
    return body;
  });
  const lexical = createBrowserLexicalRuntime(pack);
  await assert.rejects(lexical.lookupSurface('学校'), /digest mismatch/);
  corrupt = false;
  assert.equal((await lexical.lookupSurface('学校')).length, 1);
});
