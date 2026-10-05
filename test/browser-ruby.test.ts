import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { lexicalLayer } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION } from '../tools/browser-pack-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';

// #196 E — Ruby evidence + late rendering through the browser resolver adapter.
const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');

const build = compileBrowserPack(adapterFixture(), [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  shardBudgetBytes: 2048, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION, layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
});
const pack = await openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!);
const lexical = createBrowserLexicalRuntime(pack);
const run = (text: string, renderMode = 'plain', profile = 'historical') => transformWithResolver(pack, lexical, text, profile, { renderMode });
const unitAt = (raw: any, surface: string) => raw.units.find((u: any) => u.surface === surface)?.unit;

test('学校: plain => 學校, Ruby mode => ｜學校《がくかう》', async () => {
  assert.equal((await run('学校')).renderedText, '學校');
  assert.equal((await run('学校', 'ruby-whole-explicit')).renderedText, '｜學校《がくかう》');
});

test('がっこう reaches the same lexical identity as 学校 and its historical kana', async () => {
  const kana = await run('がっこう');
  assert.equal(kana.renderedText, 'がくかう');
  assert.ok(unitAt(kana, 'がっこう').lexicalCandidates.some((c: any) => c.lexicalIdentity === 'lexeme:学校/がっこう'));
  const surface = await run('学校');
  assert.equal(unitAt(surface, '学校').lexicalIdentity, 'lexeme:学校/がっこう');
});

test('｜学校《がっこう》: Ruby evidence reaches the same semantic result and the Ruby round-trips', async () => {
  for (const mode of ['plain', 'ruby-whole-explicit']) {
    const raw = await run('｜学校《がっこう》', mode);
    assert.equal(raw.renderedText, '｜學校《がくかう》', mode);
    const unit = unitAt(raw, '｜学校《がっこう》');
    assert.deepEqual([unit.lexicalIdentity, unit.reading, unit.readingSource, unit.historical.kana], ['lexeme:学校/がっこう', 'がっこう', 'ruby-word', 'がくかう']);
  }
  // implicit Ruby keeps its implicit style
  assert.equal((await run('学校《がっこう》')).renderedText, '學校《がくかう》');
});

test('｜今日《きょう》 uses the Ruby as lexical evidence; plain 今日 stays ambiguous', async () => {
  const ruby = await run('｜今日《きょう》');
  assert.equal(ruby.renderedText, '｜今日《けふ》');
  const unit = unitAt(ruby, '｜今日《きょう》');
  assert.equal(unit.kind, 'resolved');
  assert.equal(unit.reading, 'きょう');
  const plain = await run('今日');
  assert.equal(plain.renderedText, '今日');
  assert.equal(unitAt(plain, '今日').kind, 'candidates');
  // a Ruby reading that matches no candidate keeps the segment unchanged (fail closed)
  assert.equal((await run('｜今日《なにか》')).renderedText, '｜今日《なにか》');
});

test('Ruby is protected syntax: no character rule or lexical unit cuts into it; ranges stay UTF-16', async () => {
  const text = '😀学｜学校《がっこう》x';
  const raw = await run(text);
  assert.equal(raw.renderedText, '😀學｜學校《がくかう》x');
  const ruby = raw.spans.find((s: any) => s.sourceText.startsWith('｜'));
  assert.deepEqual([ruby.start, ruby.end], [3, 12]);
  assert.equal(text.slice(ruby.start, ruby.end), '｜学校《がっこう》');
  // unknown base: preserved byte-for-byte
  assert.equal((await run('｜𠮷野《よしの》')).renderedText, '｜𠮷野《よしの》');
});

test('component Ruby mode falls back to whole-word Ruby without component evidence', async () => {
  assert.equal((await run('学校', 'ruby-components-explicit')).renderedText, '｜學校《がくかう》');
});

test('Pages: output format is profileと分離し、5 runtime modeを二軸UIへ完全対応付けする', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  const fieldset = html.slice(html.indexOf('id="render-modes"'), html.indexOf('</fieldset>', html.indexOf('id="render-modes"')));
  assert.match(html, /<fieldset class="control-group output-format" id="render-modes" hidden>/);
  for (const target of ['none', 'whole', 'components']) assert.match(fieldset, new RegExp(`name="rubyTarget" value="${target}"`));
  for (const notation of ['implicit', 'explicit']) assert.match(fieldset, new RegExp(`name="rubyNotation" value="${notation}"`));
  assert.doesNotMatch(fieldset, /name="profile"/);

  const app = require('../site/app.js');
  assert.equal(app.renderModeFromControls('none', 'implicit'), 'plain');
  assert.equal(app.renderModeFromControls('whole', 'implicit'), 'ruby-whole-implicit');
  assert.equal(app.renderModeFromControls('whole', 'explicit'), 'ruby-whole-explicit');
  assert.equal(app.renderModeFromControls('components', 'implicit'), 'ruby-components-implicit');
  assert.equal(app.renderModeFromControls('components', 'explicit'), 'ruby-components-explicit');

  const { createTransformService } = require('../runtime/browser-transform-worker.js');
  const v2 = await createTransformService({ openPack: async () => pack }).handle({ type: 'open', requestId: 1 });
  for (const mode of ['plain', 'ruby-whole-implicit', 'ruby-whole-explicit', 'ruby-components-implicit', 'ruby-components-explicit']) {
    assert.ok(v2.renderModes.includes(mode), mode);
  }
  const { plannerPack } = await import('./fixtures/browser-pack-fixture.ts');
  const v1pack = (await plannerPack()).pack;
  const v1 = await createTransformService({ openPack: async () => v1pack }).handle({ type: 'open', requestId: 1 });
  assert.deepEqual(v1.renderModes, ['plain']);

  const { createWorkerClient } = require('../site/worker-client.js');
  const posted: any[] = [];
  const listeners: Record<string, (e: any) => void> = {};
  const client = createWorkerClient({ manifestUrl: 'm.json', createWorker: () => ({
    addEventListener: (type: string, fn: (e: any) => void) => { listeners[type] = fn; },
    postMessage: (m: any) => { posted.push(m); queueMicrotask(() => listeners.message!({ data: { type: 'result', requestId: m.requestId, result: {} } })); },
    terminate: () => {}
  }) });
  await client.transform('学校', 'historical', 'ruby-components-implicit');
  assert.equal(posted[0].renderMode, 'ruby-components-implicit');
});
