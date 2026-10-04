import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { lexicalLayer } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION } from '../tools/browser-pack-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { adapterFixture, lexicalFixture } from './fixtures/browser-pack-fixture.ts';

const require = createRequire(import.meta.url);
require('../runtime/transform-shared.js');
const { createResolver } = require('../runtime/orthography-resolver.js');
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');

const candidate = (identity: string, reading: string, extra: Record<string, unknown> = {}) => ({
  lexicalIdentity: identity,
  lemma: identity,
  reading,
  modernReadings: [reading],
  lexicalOrigin: 'native',
  morphology: null,
  components: [],
  evidenceRefs: [identity],
  ...extra
});

test('R2 keeps lexical identity ambiguous while exposing a consensus reading for Ruby', () => {
  const resolver = createResolver({
    lexicalLookup: () => [
      candidate('lexeme:大人/おとな#1', 'おとな'),
      candidate('lexeme:大人/おとな#2', 'おとな')
    ]
  });
  const unit = resolver.resolveUnit('大人');
  assert.equal(unit.kind, 'candidates');
  assert.deepEqual(unit.lexicalCandidates.map((c: any) => c.lexicalIdentity), ['lexeme:大人/おとな#1', 'lexeme:大人/おとな#2']);
  assert.deepEqual(unit.displayReading, { value: 'おとな', source: 'lexical-consensus' });
  assert.equal(resolver.render(unit, { mode: 'ruby-whole-explicit' }), '｜大人《おとな》');
});

test('R2 uses a unique source-backed JMdict priority for display without resolving lexical identity', () => {
  const resolver = createResolver({
    lexicalLookup: () => [
      candidate('lexeme:大人/おとな#1', 'おとな', { displayPriority: ['ichi1'] }),
      candidate('lexeme:大人/たいじん#2', 'たいじん')
    ]
  });
  const unit = resolver.resolveUnit('大人');
  assert.equal(unit.kind, 'candidates');
  assert.deepEqual(unit.displayReading, { value: 'おとな', source: 'jmdict-re-pri' });
  assert.equal(resolver.render(unit, { mode: 'ruby-whole-explicit' }), '｜大人《おとな》');
});

test('R2 renders modern lexical reading as Ruby even when no historical conversion exists', () => {
  const resolver = createResolver({
    lexicalLookup: () => [candidate('lexeme:学校/がっこう', 'がっこう')]
  });
  const unit = resolver.resolveUnit('学校');
  assert.equal(unit.historical.kana, null);
  assert.equal(resolver.render(unit, { mode: 'ruby-whole-explicit' }), '｜学校《がっこう》');
});

test('Phase B historical rendering never uses modern display reading without historical authority', () => {
  const resolver = createResolver({
    lexicalLookup: () => [candidate('lexeme:学校/がっこう', 'がっこう')]
  });
  const unit = resolver.resolveUnit('学校');
  assert.equal(unit.historical.kana, null);
  assert.deepEqual(unit.displayReading, { value: 'がっこう', source: 'lexical' });
  assert.equal(resolver.render(unit, { mode: 'ruby-whole-explicit', historicalProfile: true }), '学校');
  assert.equal(resolver.render(unit, { mode: 'ruby-whole-implicit', historicalProfile: true }), '学校');
});

test('Phase B factors identical kana edges after an admitted historical reading', () => {
  const cases = [
    ['必ずしも', 'かならずしも', '｜必《かなら》ずしも', '必《かなら》ずしも'],
    ['東南アジア', 'とうなんアジア', '｜東南《とうなん》アジア', '東南《とうなん》アジア'],
    ['好む', 'このむ', '｜好《この》む', '好《この》む']
  ] as const;

  for (const [surface, historicalReading, explicit, implicit] of cases) {
    const resolver = createResolver({
      lexicalLookup: () => [candidate(`lexeme:${surface}`, historicalReading)],
      historicalLookup: () => ({
        route: 'native',
        basis: 'literal_whole_word',
        reading: historicalReading,
        surface,
        evidenceRefs: [`ev:${surface}`]
      })
    });
    const unit = resolver.resolveUnit(surface);
    assert.equal(resolver.render(unit, { mode: 'ruby-whole-explicit', historicalProfile: true }), explicit);
    assert.equal(resolver.render(unit, { mode: 'ruby-whole-implicit', historicalProfile: true }), implicit);
  }
});

test('Phase B does not factor arbitrary equal non-kana edges', () => {
  const resolver = createResolver({
    lexicalLookup: () => [candidate('lexeme:A学B', 'AがくB')],
    historicalLookup: () => ({
      route: 'native',
      basis: 'literal_whole_word',
      reading: 'AがくB',
      surface: 'A学B',
      evidenceRefs: ['ev:A学B']
    })
  });
  const unit = resolver.resolveUnit('A学B');
  assert.equal(resolver.render(unit, { mode: 'ruby-whole-explicit', historicalProfile: true }), '｜A学B《AがくB》');
  assert.equal(resolver.render(unit, { mode: 'ruby-whole-implicit', historicalProfile: true }), '｜A学B《AがくB》');
});

test('Phase B historical component mode falls back to admitted whole reading when only modern component readings exist', () => {
  const resolver = createResolver({
    lexicalLookup: () => [candidate('lexeme:必要/ひつよう', 'ひつよう', {
      components: [
        { surface: '必', lexicalReading: 'ひつ', historicalKana: null },
        { surface: '要', lexicalReading: 'よう', historicalKana: null }
      ]
    })],
    historicalLookup: () => ({
      route: 'sino',
      basis: 'literal_whole_word',
      reading: 'ひつえう',
      surface: '必要',
      evidenceRefs: ['ev:必要']
    })
  });
  const unit = resolver.resolveUnit('必要');
  assert.equal(resolver.render(unit, { mode: 'ruby-components-explicit', historicalProfile: true }), '｜必要《ひつえう》');
  assert.equal(resolver.render(unit, { mode: 'ruby-components-implicit', historicalProfile: true }), '必要《ひつえう》');
});

test('R2 falls back to complete whole-word Ruby when component evidence is partial', () => {
  const resolver = createResolver({
    lexicalLookup: () => [candidate('lexeme:必要/ひつよう', 'ひつよう', {
      components: [
        { surface: '必', lexicalReading: 'ひつ', historicalKana: 'ひつ' },
        { surface: '要', lexicalReading: null, historicalKana: null }
      ]
    })],
    historicalLookup: () => ({ route: 'native', reading: 'ひつよう', surface: '必要', evidenceRefs: ['ev:必要'] })
  });
  const unit = resolver.resolveUnit('必要');
  assert.equal(resolver.render(unit, { mode: 'ruby-components-explicit' }), '｜必要《ひつよう》');
});

test('R2 preserves explicit component Ruby readings as evidence on one lexical unit', () => {
  const resolver = createResolver({
    lexicalLookup: () => [candidate('lexeme:学校/がっこう', 'がっこう', {
      components: [
        { surface: '学', lexicalReading: 'がく', historicalKana: 'がく' },
        { surface: '校', lexicalReading: 'こう', historicalKana: 'こう' }
      ]
    })]
  });
  const unit = resolver.resolveUnit('｜学《まな》校《こう》');
  assert.deepEqual(unit.components.map((c: any) => [c.surface, c.readingSource, c.rubyReading]), [
    ['学', 'ruby-component', 'まな'],
    ['校', 'ruby-component', 'こう']
  ]);
});

test('R2 browser adapter resolves component Ruby as one lexical unit', async () => {
  const build = compileBrowserPack(adapterFixture(), [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
    shardBudgetBytes: 2048,
    compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION,
    layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
  });
  const pack = await openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!);
  const lexical = createBrowserLexicalRuntime(pack);
  const result = await transformWithResolver(pack, lexical, '｜学《がく》校《こう》', 'historical', { renderMode: 'ruby-whole-explicit' });
  assert.equal(result.renderedText, '｜學校《がくかう》');
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].unit.sourceSurface, '学校');
});

test('R2 browser adapter exposes modern-profile Ruby from the lexical reading', async () => {
  const build = compileBrowserPack(adapterFixture(), [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
    shardBudgetBytes: 2048,
    compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION,
    layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
  });
  const pack = await openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!);
  const lexical = createBrowserLexicalRuntime(pack);
  const result = await transformWithResolver(pack, lexical, '学校', 'modern', { renderMode: 'ruby-whole-explicit' });
  assert.equal(result.renderedText, '｜学校《がっこう》');
});

test('Phase B keeps historical lexical ambiguity and display preference without emitting automatic historical Ruby', async () => {
  const graph = lexicalFixture();
  graph.facts.push(
    { id: 'fact:literal_form:大人|lexeme:大人/おとな#1', kind: 'literal_form', lexicalRefs: ['lexeme:大人/おとな#1'], surface: '大人', periodRefs: ['period:modern'], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] },
    { id: 'fact:literal_reading:大人|おとな|lexeme:大人/おとな#1', kind: 'literal_reading', lexicalRefs: ['lexeme:大人/おとな#1'], surface: '大人', reading: 'おとな', periodRefs: ['period:modern'], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] },
    { id: 'fact:literal_form:大人|lexeme:大人/おとな#2', kind: 'literal_form', lexicalRefs: ['lexeme:大人/おとな#2'], surface: '大人', periodRefs: ['period:modern'], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] },
    { id: 'fact:literal_reading:大人|おとな|lexeme:大人/おとな#2', kind: 'literal_reading', lexicalRefs: ['lexeme:大人/おとな#2'], surface: '大人', reading: 'おとな', periodRefs: ['period:modern'], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] }
  );
  const build = compileBrowserPack(graph, [MODERN_PROFILE, HISTORICAL_PROFILE], {
    shardBudgetBytes: 2048,
    compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION,
    layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
  });
  const pack = await openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!);
  const lexical = createBrowserLexicalRuntime(pack);
  const result = await transformWithResolver(pack, lexical, '大人', 'historical', { renderMode: 'ruby-whole-explicit' });
  assert.equal(result.renderedText, '大人');
  assert.equal(result.units[0].unit.kind, 'candidates');
  assert.equal(result.units[0].unit.lexicalIdentity, null);
  assert.deepEqual(result.units[0].unit.displayReading, { value: 'おとな', source: 'lexical-consensus' });

  const modern = await transformWithResolver(pack, lexical, '大人', 'modern', { renderMode: 'ruby-whole-explicit' });
  assert.equal(modern.renderedText, '｜大人《おとな》');
});

test('R2 carries source-backed display priority through the Browser lexical pack', async () => {
  const graph = lexicalFixture();
  graph.facts.push(
    { id: 'fact:literal_form:大人|lexeme:大人/おとな', kind: 'literal_form', lexicalRefs: ['lexeme:大人/おとな'], surface: '大人', periodRefs: ['period:modern'], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] },
    { id: 'fact:literal_reading:大人|おとな|lexeme:大人/おとな', kind: 'literal_reading', lexicalRefs: ['lexeme:大人/おとな'], surface: '大人', reading: 'おとな', displayPriority: ['ichi1'], periodRefs: ['period:modern'], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] },
    { id: 'fact:literal_form:大人|lexeme:大人/たいじん', kind: 'literal_form', lexicalRefs: ['lexeme:大人/たいじん'], surface: '大人', periodRefs: ['period:modern'], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] },
    { id: 'fact:literal_reading:大人|たいじん|lexeme:大人/たいじん', kind: 'literal_reading', lexicalRefs: ['lexeme:大人/たいじん'], surface: '大人', reading: 'たいじん', periodRefs: ['period:modern'], sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] }
  );
  const build = compileBrowserPack(graph, [MODERN_PROFILE, HISTORICAL_PROFILE], {
    shardBudgetBytes: 2048,
    compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION,
    layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
  });
  const pack = await openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!);
  const lexical = createBrowserLexicalRuntime(pack);
  const candidates = await lexical.lookupSurface('大人');
  assert.deepEqual(candidates.map((c: any) => [c.reading, c.displayPriority]), [['おとな', ['ichi1']], ['たいじん', []]]);
});
