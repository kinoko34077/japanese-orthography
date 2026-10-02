import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { buildSite, SITE_RUNTIME_MODULES } from '../tools/build-site.ts';
import { registerVerticalCases } from './fixtures/vertical-cases.ts';

// End-to-end over the built static site (#185 I, #196 J): the accepted BrowserPack v3 (#211 J) produced by
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
test('the built site serves BrowserPack v3 (resolver engine, Ruby render modes) with its runtime', async () => {
  for (const file of ['index.html', 'app.js', 'sw.js', 'style.css', 'terminology-ja.json', '.nojekyll', ...SITE_RUNTIME_MODULES.map((m) => `runtime/${m}`)]) {
    await readFile(join(outDir, file));
  }
  const manifest = JSON.parse(await readFile(join(outDir, 'browser-pack', 'manifest.json'), 'utf8'));
  const committed = JSON.parse(await readFile(new URL('../data/browser-pack-v3/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.compilerVersion, '3');
  assert.equal(manifest.packDigest, committed.packDigest, 'the site ships the committed v3 lock');
  const opened = await service.handle({ type: 'open', requestId: ++requestId });
  assert.equal(opened.packDigest, built.packDigest);
  assert.ok(opened.renderModes.includes('ruby-whole-explicit'));
});

registerVerticalCases('v3 site', service);

test('Browser/core parity holds for every case where both have the capability', async () => {
  const report = JSON.parse(await readFile(new URL('../data/reports/browser-resolver-parity-v3.json', import.meta.url), 'utf8'));
  assert.equal(report.packDigest, built.packDigest);
  assert.equal(report.summary.mismatches, 0);
  const v2 = JSON.parse(await readFile(new URL('../data/reports/browser-capability-utilization-v3.json', import.meta.url), 'utf8'));
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
