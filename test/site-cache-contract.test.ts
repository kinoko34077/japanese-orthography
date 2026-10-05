import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSectionFetcher, sectionUrl } = require('../runtime/browser-section-fetcher.js');

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const good = new TextEncoder().encode('section-body');
const section = { sectionId: 'facts:0', path: 'facts/0.bin', sha256: sha(good), byteLength: good.byteLength };
const manifestUrl = 'https://example.test/app/browser-pack/manifest.json';

const fakeCaches = () => {
  const deleted: string[] = [];
  return { deleted, open: async () => ({ delete: async (url: string) => { deleted.push(url); return true; } }) };
};
const respond = (bytes: Uint8Array, ok = true) => ({ ok, status: ok ? 200 : 404, arrayBuffer: async () => bytes.slice().buffer });

describe('site cache contract (#185 H)', () => {
  it('addresses sections by content digest relative to the manifest', () => {
    assert.equal(sectionUrl(manifestUrl, section), `https://example.test/app/browser-pack/facts/0.bin?v=${section.sha256}`);
  });

  it('uses a verified body without refetching', async () => {
    const calls: unknown[] = [];
    const f = createSectionFetcher({ manifestUrl, fetchImpl: async (u: string, o: unknown) => { calls.push([u, o]); return respond(good); }, cachesImpl: fakeCaches(), subtleImpl: webcrypto.subtle });
    const body = new Uint8Array(await f.fetchSection(section));
    assert.deepEqual(body, good);
    assert.equal(calls.length, 1);
  });

  it('evicts a corrupt cached body and refetches from the network', async () => {
    const caches = fakeCaches();
    const modes: string[] = [];
    const f = createSectionFetcher({
      manifestUrl, cachesImpl: caches, subtleImpl: webcrypto.subtle,
      fetchImpl: async (_u: string, o: { cache: string }) => { modes.push(o.cache); return respond(modes.length === 1 ? new TextEncoder().encode('corrupt-body') : good); }
    });
    assert.deepEqual(new Uint8Array(await f.fetchSection(section)), good);
    assert.deepEqual(modes, ['default', 'reload']);
    assert.deepEqual(caches.deleted, [sectionUrl(manifestUrl, section)]);
    assert.equal(f.stats().evicted, 1);
  });

  it('fails visibly when the network copy is also wrong', async () => {
    const f = createSectionFetcher({ manifestUrl, fetchImpl: async () => respond(new TextEncoder().encode('xxxxxxxxxxxx')), cachesImpl: fakeCaches(), subtleImpl: webcrypto.subtle });
    await assert.rejects(f.fetchSection(section), /failed verification twice/);
  });

  it('service worker caches only GET site files and versioned sections, never user text', async () => {
    const sw = await readFile(new URL('../site/sw.js', import.meta.url), 'utf8');
    assert.match(sw, /request\.method !== "GET"/);
    assert.match(sw, /searchParams\.has\("v"\)/);
    assert.match(sw, /type === "prune"/);
    assert.doesNotMatch(sw, /localStorage|indexedDB|textarea/i);
    const app = await readFile(new URL('../site/app.js', import.meta.url), 'utf8');
    assert.doesNotMatch(app, /localStorage|sessionStorage|indexedDB/);
    const html = await readFile(new URL('../site/index.html', import.meta.url), 'utf8');
    assert.match(html, /id="clear-cache"[^>]*>辞書キャッシュを消去/);
  });
});
