import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { buildSite, SITE_RUNTIME_MODULES } from '../tools/build-site.ts';

// End-to-end over the built static site (#185 I, #196 J): the accepted BrowserPack v2 produced by
// `build:site` is opened through the same section fetcher, worker service, resolver adapter and
// diagnostic contract the page uses. Only the transport differs (files instead of HTTP). The twelve
// mandatory #196 J vertical cases run here against the real accepted pack.

const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createSectionFetcher } = require('../runtime/browser-section-fetcher.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');

const outDir = await mkdtemp(join(tmpdir(), 'site-e2e-'));
const built = await buildSite(fileURLToPath(new URL('..', import.meta.url)), outDir);
const manifestUrl = pathToFileURL(join(outDir, 'browser-pack', 'manifest.json')).href;
const fetchImpl = async (url: string) => {
  try {
    const body = await readFile(fileURLToPath(url.split('?')[0]!));
    return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength), json: async () => JSON.parse(body.toString('utf8')) };
  } catch {
    return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), json: async () => null };
  }
};
const fetcher = createSectionFetcher({ manifestUrl, fetchImpl, cachesImpl: null, subtleImpl: webcrypto.subtle });
const service = createTransformService({
  openPack: async () => openBrowserPack(await (await fetchImpl(manifestUrl)).json(), fetcher.fetchSection)
});
test.after(() => rm(outDir, { recursive: true, force: true }));

let requestId = 0;
const transform = async (text: string, profileId = 'historical', renderMode = 'plain') => {
  const reply = await service.handle({ type: 'transform', requestId: ++requestId, text, profileId, renderMode });
  assert.equal(reply.type, 'result', reply.message);
  return { requestId, result: reply.result };
};
const detail = async (resultId: number, detailRef: string) => {
  const reply = await service.handle({ type: 'detail', requestId: ++requestId, resultId, detailRef });
  assert.equal(reply.type, 'detail', reply.message);
  return reply.detail;
};
const unitOf = async (text: string, surface: string, profileId = 'historical') => {
  const { requestId: id, result } = await transform(text, profileId);
  const unit = result.units.find((u: any) => u.sourceText === surface);
  return { result, unit, detail: unit ? await detail(id, unit.detailRef) : null };
};

test('the built site serves BrowserPack v2 (resolver engine, Ruby render modes) with its runtime', async () => {
  for (const file of ['index.html', 'app.js', 'sw.js', 'style.css', 'terminology-ja.json', '.nojekyll', ...SITE_RUNTIME_MODULES.map((m) => `runtime/${m}`)]) {
    await readFile(join(outDir, file));
  }
  const manifest = JSON.parse(await readFile(join(outDir, 'browser-pack', 'manifest.json'), 'utf8'));
  const committed = JSON.parse(await readFile(new URL('../data/browser-pack-v2/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.compilerVersion, '2');
  assert.equal(manifest.packDigest, committed.packDigest, 'the site ships the committed v2 lock');
  const opened = await service.handle({ type: 'open', requestId: ++requestId });
  assert.equal(opened.packDigest, built.packDigest);
  assert.ok(opened.renderModes.includes('ruby-whole-explicit'));
});

test('J1/J2: 学校 -> 學校; Ruby mode -> ｜學校《がくかう》', async () => {
  assert.equal((await transform('学校')).result.renderedText, '學校');
  assert.equal((await transform('学校', 'historical', 'ruby-whole-explicit')).result.renderedText, '｜學校《がくかう》');
});

test('J3: がっこう reaches the 学校 identity and its historical kana', async () => {
  const { result, detail: d } = await unitOf('がっこう', 'がっこう');
  assert.equal(result.renderedText, 'がくかう');
  assert.ok(result.spans.length === 1 && result.spans[0].resolved === false);
  const raw = await transform('がっこう');
  const spanDetail = await detail(raw.requestId, raw.result.spans[0].detailRef);
  assert.ok(spanDetail.resolverUnit.lexicalCandidates.some((c: any) => c.lexicalIdentity === 'lexeme:学校/がっこう'));
  assert.equal(d, null, 'the changed kana unit is a span, not an unchanged unit');
});

test('J4: ドイツ exposes 独逸 / 独乙 without an arbitrary generic winner', async () => {
  const { result, detail: d } = await unitOf('ドイツ', 'ドイツ');
  assert.equal(result.renderedText, 'ドイツ');
  assert.deepEqual(result.spans, []);
  const germany = d.lexemes.find((l: any) => l.lexicalIdentity === 'lexeme:独逸/ドイツ');
  assert.deepEqual(germany.forms.map((f: any) => f.surface).sort(), ['独乙', '独逸']);
});

test('J5: みる keeps multiple lexical candidates and stays unresolved without context', async () => {
  const { result, unit, detail: d } = await unitOf('みる', 'みる');
  assert.equal(result.renderedText, 'みる');
  assert.equal(unit.resolved, false);
  assert.ok(d.lexemes.length >= 3, `${d.lexemes.length} candidates`);
  assert.ok(d.lexemes.some((l: any) => l.lexicalIdentity === 'lexeme:見る/みる') && d.lexemes.some((l: any) => l.lexicalIdentity === 'lexeme:診る/みる'));
});

test('J6: 分かる — generic unchanged; KiNoTch 分る (admitted profile style)', async () => {
  assert.equal((await transform('分かる', 'historical')).result.renderedText, '分かる');
  const kinotch = (await transform('分かる', 'kinotch-fixed')).result;
  assert.equal(kinotch.renderedText, '分る');
  assert.equal(kinotch.spans[0].authority, 'project_rule');
});

test('J7: ｜今日《きょう》 uses the Ruby as lexical evidence', async () => {
  const { requestId: id, result } = await transform('｜今日《きょう》');
  assert.equal(result.renderedText, '｜今日《けふ》');
  const d = await detail(id, result.spans[0].detailRef);
  assert.deepEqual([d.resolverUnit.lexicalIdentity, d.resolverUnit.reading, d.resolverUnit.readingSource], ['lexeme:今日/きょう', 'きょう', 'ruby-word']);
  assert.equal((await transform('今日')).result.renderedText, '今日');
});

test('J8: 台風 keeps the accepted contextual kanji behaviour (颱風)', async () => {
  const { requestId: id, result } = await transform('台風');
  assert.equal(result.renderedText, '颱風');
  const d = await detail(id, result.spans[0].detailRef);
  assert.equal(d.resolverUnit.historical.contextualKanji, 'resolved');
});

test('J9/J10: unknown text is preserved; ASCII / emoji / Ruby mixed text keeps UTF-16 ranges', async () => {
  const text = 'abc 😀 溶接 𠮷野家 zzz ｜学校《がっこう》';
  const { result } = await transform(text);
  assert.equal(result.renderedText, 'abc 😀 熔接 𠮷野家 zzz ｜學校《がくかう》');
  for (const span of result.spans) {
    assert.equal(text.slice(span.start, span.end), span.sourceText);
    assert.equal(result.renderedText.slice(span.renderedStart, span.renderedEnd), span.renderedText);
  }
  for (const unit of result.units) assert.equal(result.renderedText.slice(unit.renderedStart, unit.renderedEnd), unit.sourceText);
  for (const t of ['', 'hello world', '😀😀', 'zzz'.repeat(500)]) assert.equal((await transform(t)).result.renderedText, t);
});

test('J11/J12: unchanged recognized text is inspectable and its provenance is recoverable lazily', async () => {
  const { unit, detail: d } = await unitOf('今日は学校で', '今日は');
  assert.deepEqual([unit.recognized, unit.changed, 'certainty' in unit], [true, false, false]);
  assert.equal(d.kind, 'unit');
  assert.ok(d.lexemes.length >= 1 && d.lexemes[0].forms.length >= 1);
  assert.ok(d.provenance.sourceRefs.length > 0 && d.provenance.evidenceRefs.length > 0);
  const { requestId: id, result } = await transform('溶接');
  const spanDetail = await detail(id, result.spans[0].detailRef);
  assert.ok(spanDetail.acceptedCandidates[0].provenance.sourceRefs.length > 0);
});

test('Browser/core parity holds for every case where both have the capability', async () => {
  const report = JSON.parse(await readFile(new URL('../data/reports/browser-resolver-parity.json', import.meta.url), 'utf8'));
  assert.equal(report.packDigest, built.packDigest);
  assert.equal(report.summary.mismatches, 0);
  const v2 = JSON.parse(await readFile(new URL('../data/reports/browser-capability-utilization-v2.json', import.meta.url), 'utf8'));
  assert.equal(v2.packDigest, built.packDigest);
  for (const probe of ['surface:学校', 'reading:ドイツ', 'reading:みる', 'surface:分かる', 'surface:台風', 'ruby:学校', 'ruby:今日']) {
    assert.ok(v2.summary.capabilityGained.includes(`${probe}/historical`), probe);
  }
});

test('the Pages workflow is manual-only (publication stays a Human gate)', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const on = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /push|pull_request|schedule|workflow_run/);
});
