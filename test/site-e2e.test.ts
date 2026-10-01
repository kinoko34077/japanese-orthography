import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { buildSite, SITE_RUNTIME_MODULES } from '../tools/build-site.ts';

// End-to-end over the built static site (#185 I): the accepted BrowserPack produced by `build:site` is
// opened through the same section fetcher, worker service and diagnostic contract the page uses, on a
// representative arbitrary-text fixture. Only the transport differs (files instead of HTTP).

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
const transform = async (text: string, profileId: string) => {
  const reply = await service.handle({ type: 'transform', requestId: ++requestId, text, profileId });
  assert.equal(reply.type, 'result', reply.message);
  return reply.result;
};
const spanOf = (result: { spans: { sourceText: string; certainty: string; renderedText: string }[] }, sourceText: string) =>
  result.spans.find((s) => s.sourceText === sourceText);

test('the built site contains the page, worker runtime and a sealed pack', async () => {
  for (const file of ['index.html', 'app.js', 'sw.js', 'style.css', 'terminology-ja.json', '.nojekyll', ...SITE_RUNTIME_MODULES.map((m) => `runtime/${m}`)]) {
    await readFile(join(outDir, file));
  }
  const opened = await service.handle({ type: 'open', requestId: ++requestId });
  assert.equal(opened.type, 'opened');
  assert.equal(opened.packDigest, built.packDigest);
});

test('historical profile on a representative paragraph', async () => {
  const text = '溶接の装丁を円周に描いた台風の日のこと。思うことは多い。';
  const result = await transform(text, 'historical');
  assert.match(result.renderedText, /^熔接の装丁を圓周に描いた台風の日のこと。/);
  assert.equal(spanOf(result, '溶接')?.certainty, 'unique');
  assert.equal(spanOf(result, '台風')?.certainty, 'unresolved');
  assert.equal(spanOf(result, '装丁')?.certainty, 'unresolved');
  assert.equal(result.renderedText.length > 0 && result.spans.every((s: { changed: boolean; certainty: string }) => s.changed || s.certainty !== 'unique'), true);
});

test('modern profile restores historical forms and kinotch applies project rules', async () => {
  const modern = await transform('熔接と圓と思ふ', 'modern');
  assert.equal(modern.renderedText, '溶接と円と思う');
  const kinotch = await transform('思うこと', 'kinotch-fixed');
  assert.match(kinotch.renderedText, /ヿ/);
});

test('every span opens a lazy detail payload with provenance fields', async () => {
  const result = await transform('溶接の円周', 'historical');
  const resultId = requestId;
  assert.ok(result.spans.length >= 2);
  for (const span of result.spans) {
    const reply = await service.handle({ type: 'detail', requestId: ++requestId, resultId, detailRef: span.detailRef });
    assert.equal(reply.type, 'detail', reply.message);
    assert.equal(reply.detail.sourceText, span.sourceText);
    assert.ok(Array.isArray(reply.detail.provenance.sourceRefs));
  }
});

test('arbitrary input (empty, ASCII, emoji, long text) never throws', async () => {
  for (const text of ['', 'hello world', '😀溶接😀', '溶接'.repeat(2000)]) {
    const result = await transform(text, 'historical');
    assert.equal(typeof result.renderedText, 'string');
  }
});

test('the Pages workflow is manual-only (first publication is a Human gate)', async () => {
  const workflow = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const on = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /push|pull_request|schedule|workflow_run/);
});
