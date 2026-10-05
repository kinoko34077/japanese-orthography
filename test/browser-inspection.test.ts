import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { lexicalLayer } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION } from '../tools/browser-pack-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';

// #196 H — inspection-first Pages: recognized / resolved / changed are separate, and unchanged
// recognized units can be inspected without a certainty colour.
const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');
const app = require('../site/app.js');
const { createTerminology } = require('../site/terminology.js');

const terminology = JSON.parse(await readFile(new URL('../site/terminology-ja.json', import.meta.url), 'utf8'));
const build = compileBrowserPack(adapterFixture(), [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  shardBudgetBytes: 2048, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION, layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })], terminology
});
const service = createTransformService({ executionMode: 'legacy-only', openPack: () => openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!) });
let id = 0;
const transform = async (text: string, renderMode = 'plain') => {
  const reply = await service.handle({ type: 'transform', requestId: ++id, text, profileId: 'historical', renderMode });
  assert.equal(reply.type, 'result', reply.message);
  return { requestId: id, result: reply.result };
};

test('recognized / resolved / changed are separate; unchanged units carry no certainty', async () => {
  const { result } = await transform('学校と今日');
  const school = result.spans.find((s: any) => s.sourceText === '学校');
  assert.deepEqual([school.recognized, school.resolved, school.changed, school.certainty], [true, true, true, 'unique']);
  const today = result.units.find((u: any) => u.sourceText === '今日');
  assert.deepEqual([today.recognized, today.resolved, today.changed, 'certainty' in today], [true, false, false, false]);
  assert.equal(today.candidateCount, 2);
  assert.ok(result.recognizedCount >= 2);
  assert.ok(result.units.every((u: any) => !result.spans.some((s: any) => u.start < s.end && u.end > s.start)), 'units never overlap reported spans');
});

test('unit rendered offsets follow length-changing spans (Ruby mode)', async () => {
  const { result } = await transform('学校と今日', 'ruby-whole-explicit');
  assert.equal(result.renderedText, '｜學校《がくかう》と今日');
  const today = result.units.find((u: any) => u.sourceText === '今日');
  assert.equal(result.renderedText.slice(today.renderedStart, today.renderedEnd), '今日');
});

test('辞書情報表示: inspect mode adds neutral, keyboard-focusable unit marks; off by default', async () => {
  const { result } = await transform('学校と今日');
  const plain = app.renderResultHtml(result);
  assert.doesNotMatch(plain, /diag lexeme/);
  const inspect = app.renderResultHtml(result, { inspect: true });
  const mark = /<span class="diag lexeme" role="button" tabindex="0" aria-pressed="false" data-ref="(u:\d+)"[^>]*>今日<\/span>/.exec(inspect);
  assert.ok(mark, inspect);
  assert.doesNotMatch(mark![0], /diag-(unique|conditional|unresolved)|data-certainty/);
  assert.match(inspect, /<mark class="diag diag-unique"[^>]*>學校<\/mark>/);
  const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.match(html, /<input type="checkbox" id="inspect"> 辞書情報表示/);
});

test('a recognized unchanged unit opens a Japanese-first inspector with lexical knowledge and provenance', async () => {
  const { requestId, result } = await transform('学校と今日');
  const ref = result.units.find((u: any) => u.sourceText === '今日').detailRef;
  const reply = await service.handle({ type: 'detail', requestId: ++id, resultId: requestId, detailRef: ref });
  assert.equal(reply.type, 'detail', reply.message);
  const d = reply.detail;
  assert.equal(d.kind, 'unit');
  assert.deepEqual(d.recognition, { recognized: true, resolved: false, changed: false });
  assert.deepEqual(d.lexemes.map((l: any) => l.lexicalIdentity), ['lexeme:今日/きょう']);
  assert.deepEqual(d.lexemes[0].readings.modern.sort(), ['きょう', 'こんにち']);
  assert.deepEqual(d.lexemes[0].forms.map((f: any) => f.surface), ['今日']);
  assert.ok(d.provenance.sourceRefs.includes('src:fixture'));
  assert.equal(d.renderMode, 'plain');
  const terms = createTerminology(terminology);
  const html = app.renderUnitDetailHtml(terms, d);
  for (const label of ['認識状態', '語彙識別子', '語彙候補', '表記形', '品詞・活用', '出力形式', '出典']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /undefined|\[object Object\]/);
});

test('a resolved changed span exposes morphology when the lexicon has it', async () => {
  const { requestId, result } = await transform('学校');
  const reply = await service.handle({ type: 'detail', requestId: ++id, resultId: requestId, detailRef: result.spans[0].detailRef });
  assert.equal(reply.detail.resolverUnit.lexicalIdentity, 'lexeme:学校/がっこう');
  assert.equal(typeof reply.detail.morphologyContext.note, 'string');
});
