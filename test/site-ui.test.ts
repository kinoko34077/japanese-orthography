import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { plannerPack } from './fixtures/browser-pack-fixture.ts';

const require = createRequire(import.meta.url);
const app = require('../site/app.js');
const { createTerminology } = require('../site/terminology.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');
const terms = createTerminology(JSON.parse(await readFile('site/terminology-ja.json', 'utf8')));
const { pack } = await plannerPack();
const service = createTransformService({ executionMode: 'legacy-only', openPack: async () => pack });
const convert = async (text: string, profileId = 'historical') => service.handle({ type: 'transform', requestId: `r-${text}-${profileId}`, text, profileId });
const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

test('copy returns the plain converted text only; markup carries no extra text', async () => {
  const reply = await convert('装丁と溶接と<円>"&');
  const html = app.renderResultHtml(reply.result);
  assert.equal(app.copyText(reply.result), '装丁と熔接と<圓>"&');
  // the visible text of the result markup is exactly the converted text (icons live in CSS, not the DOM)
  assert.equal(stripTags(html), reply.result.renderedText);
  assert.ok(!app.copyText(reply.result).includes('✓') && !app.copyText(reply.result).includes('diag'));
});

test('diagnostic colour class and text label both follow the semantic class', async () => {
  const reply = await convert('装丁と溶接');
  const html = app.renderResultHtml(reply.result);
  assert.match(html, /class="diag diag-unresolved"[^>]*data-certainty="unresolved"[^>]*aria-label="! 未解決：「装丁」→「装丁」"/);
  assert.match(html, /class="diag diag-unique"[^>]*data-certainty="unique"[^>]*aria-label="✓ 一意確定：「溶接」→「熔接」"/);
  const css = await readFile('site/style.css', 'utf8');
  for (const [cls, icon] of [['diag-unique', '✓'], ['diag-conditional', '◆'], ['diag-unresolved', '!']] as const) assert.ok(css.includes(`.${cls}::before { content: "${icon}"`), cls);
  assert.match(app.renderSummaryHtml(reply.result), /! 未解決 1/);
});

test('diagnostic spans and help are keyboard-focusable and work without hover', async () => {
  const reply = await convert('溶接');
  assert.match(app.renderResultHtml(reply.result), /role="button" tabindex="0" aria-pressed="false"/);
  const source = await readFile('site/app.js', 'utf8');
  assert.ok(source.includes('addEventListener("click", activate)') && source.includes('addEventListener("keydown", activate)'));
  const detail = (await service.handle({ type: 'detail', requestId: 'd', resultId: 'r-溶接-historical', detailRef: '0' })).detail;
  const detailHtml = app.renderDetailHtml(terms, detail);
  assert.match(detailHtml, /<button type="button" class="term-help"/);
  assert.match(detailHtml, /語彙識別子<\/span><span class="term-sep"> \/ <\/span><span class="term-en" lang="en">lexical identity/);
  assert.ok(!/[぀-ヿ]/.test(detail.basis) && detailHtml.includes('出典の対応を逆にたどる'));
});

test('mobile layout stacks panes and opens the detail as a bottom sheet', async () => {
  const css = await readFile('site/style.css', 'utf8');
  const mobile = css.slice(css.indexOf('@media (max-width: 960px)'));
  assert.match(mobile, /grid-template-areas: "controls" "source" "result"/);
  assert.match(mobile, /\.detail \{[^}]*position: fixed;[^}]*bottom: 0;/);
  const html = await readFile('site/index.html', 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('loading/error state is visible and recoverable; no request goes to an application server', async () => {
  const appSource = await readFile('site/app.js', 'utf8');
  assert.ok(appSource.includes('"再読み込み"') && appSource.includes('client.restart()'));
  for (const file of ['site/app.js', 'site/worker-client.js', 'runtime/browser-transform-worker.js', 'runtime/browser-pack-runtime.js']) {
    const text = await readFile(file, 'utf8');
    assert.ok(!/https?:\/\//.test(text.replace(/\/\/.*$/gm, '')), `${file} must only use relative URLs`);
    assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket/.test(text), file);
  }
});

test('the detail inspector labels every field Japanese-first', async () => {
  const reply = await convert('装丁');
  const detail = (await service.handle({ type: 'detail', requestId: 'd2', resultId: 'r-装丁-historical', detailRef: '0' })).detail;
  const html = app.renderDetailHtml(terms, detail);
  for (const ja of ['処理状態', '語彙識別子', '語彙候補', '読み', '形態・文脈', '復元方法', '根拠の種類', '適用規則', '採用した候補', '採用しなかった候補', '理由コード', '保持した区別', '出典・証拠', '旧方式との整合', 'プロファイルの影響', '位置']) {
    assert.ok(html.includes(`<span class="term-ja">${ja}</span>`), ja);
  }
  assert.ok(!html.includes('term-unsupported'));
  assert.ok(reply.result.spans[0].certainty === 'unresolved');
});
