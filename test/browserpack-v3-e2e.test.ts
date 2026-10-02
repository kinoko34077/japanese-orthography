import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAcceptedBrowserPackV3 } from '../tools/generate-browser-pack.ts';
import { registerVerticalCases } from './fixtures/vertical-cases.ts';

// #211 I — Browser/core parity on BrowserPack v3: the twelve #196 J vertical cases run on the real
// accepted v3 pack through the same worker service, and the committed parity / capability / measurement
// reports must describe this exact pack.
const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');

const build = await buildAcceptedBrowserPackV3(fileURLToPath(new URL('..', import.meta.url)));
const service = createTransformService({ openPack: () => openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!) });
const read = async (path: string) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

test('the in-process v3 build is the committed v3 lock', async () => {
  const committed = await read('data/browser-pack-v3/manifest.json');
  assert.equal(build.manifest.packDigest, committed.packDigest);
  assert.equal(build.manifest.compilerVersion, '3');
});

registerVerticalCases('v3', service);

test('v3 keeps browser/core parity and the capability oracle exactly as v2', async () => {
  const [p2, p3] = [await read('data/reports/browser-resolver-parity.json'), await read('data/reports/browser-resolver-parity-v3.json')];
  assert.equal(p3.packDigest, build.manifest.packDigest);
  assert.equal(p3.summary.mismatches, 0);
  assert.deepEqual(p3.cases, p2.cases, 'every parity case and classification is identical on v3');
  const [c2, c3] = [await read('data/reports/browser-capability-utilization-v2.json'), await read('data/reports/browser-capability-utilization-v3.json')];
  assert.equal(c3.packDigest, build.manifest.packDigest);
  const semantic = (rows: any[]) => rows.map(({ sectionRequests: _r, transferredBytes: _b, ...row }) => row);
  assert.deepEqual(semantic(c3.rows), semantic(c2.rows), 'every probe row is semantically identical on v3');
  assert.deepEqual(c3.summary, c2.summary);
});

test('v3 measurements are recorded for the current pack', async () => {
  const m = await read('data/reports/browser-pack-v3-measurements.json');
  assert.equal(m.packDigest, build.manifest.packDigest);
  assert.ok(m.runs.short.coldFirstResult.requests > 0 && m.runs.representative.coldFirstResult.bytes > 0);
});
