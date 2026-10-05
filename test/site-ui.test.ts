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

test('通常表示は変換本文だけを表示し、診断表示だけがsemantic spanを重ねる', async () => {
  const reply = await convert('装丁と溶接と<円>"&');
  const clean = app.renderResultHtml(reply.result);
  const diagnostic = app.renderResultHtml(reply.result, { diagnostic: true });
  assert.equal(app.copyText(reply.result), '装丁と熔接と<圓>"&');
  assert.equal(stripTags(clean), reply.result.renderedText);
  assert.doesNotMatch(clean, /class="diag/);
  assert.equal(stripTags(diagnostic), reply.result.renderedText);
  assert.match(diagnostic, /class="diag /);
  assert.ok(!app.copyText(reply.result).includes('✓') && !app.copyText(reply.result).includes('diag'));
});

test('利用者向け二軸UIをruntimeの5 render modeへ完全に対応付ける', () => {
  assert.equal(app.renderModeFromControls('none', 'implicit'), 'plain');
  assert.equal(app.renderModeFromControls('whole', 'implicit'), 'ruby-whole-implicit');
  assert.equal(app.renderModeFromControls('whole', 'explicit'), 'ruby-whole-explicit');
  assert.equal(app.renderModeFromControls('components', 'implicit'), 'ruby-components-implicit');
  assert.equal(app.renderModeFromControls('components', 'explicit'), 'ruby-components-explicit');
  assert.throws(() => app.renderModeFromControls('unknown', 'implicit'), /unknown Ruby target/);
  assert.throws(() => app.renderModeFromControls('whole', 'unknown'), /unknown Ruby notation/);
});

test('実用Pagesの主画面はprofile・二軸Ruby・clean/diagnostic切替を持つ', async () => {
  const html = await readFile('site/index.html', 'utf8');
  assert.match(html, /<title>日本語表記変換<\/title>/);
  assert.match(html, /<h1>日本語表記変換<\/h1>/);
  for (const value of ['none', 'whole', 'components']) assert.match(html, new RegExp(`name="rubyTarget" value="${value}"`));
  for (const value of ['implicit', 'explicit']) assert.match(html, new RegExp(`name="rubyNotation" value="${value}"`));
  assert.match(html, /name="resultView" value="clean" checked/);
  assert.match(html, /name="resultView" value="diagnostic"/);
  assert.match(html, /id="engine-info"/);
  assert.match(html, /id="diagnostic-options"/);
});

test('診断色とtext labelはsemantic classに従い、通常summaryは簡潔にする', async () => {
  const reply = await convert('装丁と溶接');
  const html = app.renderResultHtml(reply.result, { diagnostic: true });
  assert.match(html, /class="diag diag-unresolved"[^>]*data-certainty="unresolved"[^>]*aria-label="! 未解決：「装丁」→「装丁」"/);
  assert.match(html, /class="diag diag-unique"[^>]*data-certainty="unique"[^>]*aria-label="✓ 一意確定：「溶接」→「熔接」"/);
  const css = await readFile('site/style.css', 'utf8');
  for (const [cls, icon] of [['diag-unique', '✓'], ['diag-conditional', '◆'], ['diag-unresolved', '!']] as const) assert.ok(css.includes(`.${cls}::before { content: "${icon}"`), cls);
  assert.match(app.renderSummaryHtml(reply.result), /変換 1/);
  assert.match(app.renderSummaryHtml(reply.result), /未解決 1/);
  assert.match(app.renderSummaryHtml(reply.result, { diagnostic: true }), /! 未解決 1/);
});

test('詳細は利用者向け要点・診断・技術情報へ段階化する', async () => {
  const reply = await convert('装丁');
  const detail = (await service.handle({ type: 'detail', requestId: 'd2', resultId: 'r-装丁-historical', detailRef: '0' })).detail;
  const html = app.renderDetailHtml(terms, detail);
  assert.match(html, /class="detail-overview"/);
  assert.match(html, /<details class="detail-diagnostics"/);
  assert.match(html, /<summary>診断情報<\/summary>/);
  assert.match(html, /<details class="detail-technical"/);
  assert.match(html, /<summary>技術情報<\/summary>/);
  for (const ja of ['処理状態', '語彙識別子', '語彙候補', '読み', '形態・文脈', '復元方法', '根拠の種類', '適用規則', '採用した候補', '採用しなかった候補', '理由コード', '保持した区別', '出典・証拠', '旧方式との整合', 'プロファイルの影響', '位置']) {
    assert.ok(html.includes(`<span class="term-ja">${ja}</span>`), ja);
  }
  assert.ok(!html.includes('term-unsupported'));
});

test('診断spanとhelpはhoverなしでもkeyboard操作できる', async () => {
  const reply = await convert('溶接');
  assert.match(app.renderResultHtml(reply.result, { diagnostic: true }), /role="button" tabindex="0" aria-pressed="false"/);
  const source = await readFile('site/app.js', 'utf8');
  assert.ok(source.includes('addEventListener("click", activate)') && source.includes('addEventListener("keydown", activate)'));
  const detail = (await service.handle({ type: 'detail', requestId: 'd', resultId: 'r-溶接-historical', detailRef: '0' })).detail;
  const detailHtml = app.renderDetailHtml(terms, detail);
  assert.match(detailHtml, /<button type="button" class="term-help"/);
  assert.match(detailHtml, /語彙識別子<\/span><span class="term-sep"> \/ <\/span><span class="term-en" lang="en">lexical identity/);
  assert.ok(!/[぀-ヿ]/.test(detail.basis) && detailHtml.includes('出典の対応を逆にたどる'));
});

test('desktopは入力と結果を主役にし、mobileは縦積みとbottom sheetにする', async () => {
  const css = await readFile('site/style.css', 'utf8');
  assert.match(css, /grid-template-areas:\s*"controls controls"\s*"source result"/);
  const mobile = css.slice(css.indexOf('@media (max-width: 960px)'));
  assert.match(mobile, /grid-template-areas:\s*"controls"\s*"source"\s*"result"/);
  assert.match(mobile, /\.detail \{[^}]*position: fixed;[^}]*bottom: 0;/);
  const html = await readFile('site/index.html', 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
});

test('loading/errorは復旧可能で、application serverへ本文を送らない', async () => {
  const appSource = await readFile('site/app.js', 'utf8');
  assert.ok(appSource.includes('"再読み込み"') && appSource.includes('client.restart()'));
  for (const file of ['site/app.js', 'site/worker-client.js', 'runtime/browser-transform-worker.js', 'runtime/browser-pack-runtime.js']) {
    const text = await readFile(file, 'utf8');
    assert.ok(!/https?:\/\//.test(text.replace(/\/\/.*$/gm, '')), `${file} must only use relative URLs`);
    assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket/.test(text), file);
  }
  assert.doesNotMatch(appSource, /localStorage|sessionStorage/);
});

test('engine技術情報はpackと実行modeを表示できるがselectorにはしない', () => {
  const html = app.renderEngineInfoHtml({
    manifest: { compilerVersion: '3' },
    openReply: { packDigest: 'abcdef0123456789', renderModes: ['plain', 'ruby-whole-implicit', 'ruby-whole-explicit'] },
    result: { executionMode: 'vm-authoritative' },
    elapsedMs: 42
  });
  assert.match(html, /BrowserPack v3/);
  assert.match(html, /abcdef012345…/);
  assert.match(html, /Rule Program VM/);
  assert.match(html, /42 ms/);
  assert.doesNotMatch(html, /<select|name="executionMode"/);
});


test('cache状態は辞書section数だけを読み、本文を保存せず初回/再利用候補を区別する', async () => {
  const empty = await app.readBrowserCacheState({
    navigator: { onLine: true },
    caches: { open: async () => ({ keys: async () => [] }) }
  });
  assert.deepEqual(empty, { available: true, online: true, sectionCount: 0, reuse: false });

  const reused = await app.readBrowserCacheState({
    navigator: { onLine: false },
    caches: { open: async () => ({ keys: async () => [{ url: 'a' }, { url: 'b' }] }) }
  });
  assert.deepEqual(reused, { available: true, online: false, sectionCount: 2, reuse: true });

  const unavailable = await app.readBrowserCacheState({ navigator: { onLine: true } });
  assert.deepEqual(unavailable, { available: false, online: true, sectionCount: 0, reuse: false });
});

test('engine技術情報は接続・cache・起動時section loadを表示する', () => {
  const html = app.renderEngineInfoHtml({
    manifest: { compilerVersion: '3' },
    openReply: {
      packDigest: 'abcdef0123456789',
      renderModes: ['plain'],
      stats: { sectionsLoaded: 10, bytesLoaded: 575004, loaded: ['a'] }
    },
    result: { executionMode: 'vm-authoritative' },
    elapsedMs: 42,
    cacheState: { available: true, online: false, sectionCount: 12, reuse: true }
  });
  assert.match(html, /オフライン/);
  assert.match(html, /再利用候補 12 section/);
  assert.match(html, /起動時 10 section/);
  assert.match(html, /575,004 byte/);
});

test('status文言は辞書準備・変換・完了・復旧可能errorを区別する', async () => {
  const html = await readFile('site/index.html', 'utf8');
  const source = await readFile('site/app.js', 'utf8');
  assert.match(html, /画面を準備しました。辞書データを準備しています/);
  assert.match(source, /辞書データを準備しています/);
  assert.match(source, /必要な辞書データを確認し、変換しています/);
  assert.match(source, /変換しました/);
  assert.match(source, /再読み込み/);
});


test('初期表示はcold変換を自動実行せず、最初の変換を利用者操作まで遅延する', async () => {
  const html = await readFile('site/index.html', 'utf8');
  const source = await readFile('site/app.js', 'utf8');
  assert.match(html, /<textarea id="source"[^>]*><\/textarea>/);
  assert.doesNotMatch(source, /if \(await loadPolicy\(\)\) await convert\(\);/);
  assert.match(source, /await loadPolicy\(\);/);
  assert.match(source, /if \(current \|\| \$\("auto"\)\.checked\) convert\(\);/);
});
