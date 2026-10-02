import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { encodeBundle, encodeSection } from '../tools/browser-pack-encoding.ts';
import { lexicalLayer } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION, validateBrowserPackManifest } from '../tools/browser-pack-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';

// #196 I — BrowserPack v2 physical layout: bundled knowledge shards, compact detail, posting payloads.
const require = createRequire(import.meta.url);
const { decodeBundle, decodeSection } = require('../runtime/browser-pack-binary.js');
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');

const graph = adapterFixture();
const profiles = [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE];
const v1 = compileBrowserPack(graph, profiles, { shardBudgetBytes: 2048 });
const v2 = compileBrowserPack(graph, profiles, { shardBudgetBytes: 2048, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION, layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })] });
const open = async (build: typeof v1, log: string[] = []) => openBrowserPack(build.manifest, async (s: { sectionId: string; path: string }) => { log.push(s.sectionId); return build.files.get(s.path)!; });

test('bundle container round-trips its parts as zero-copy views into one buffer', () => {
  const a = encodeSection([{ name: 'n', kind: 'scalar', values: [1, 2, 3] }]);
  const b = encodeSection([{ name: 'strings', kind: 'strings', values: ['', '学校'] }]);
  const bytes = encodeBundle([['a', a], ['b', b]]);
  const bundle = decodeBundle(bytes);
  assert.deepEqual([...bundle.part('a').column('n').values], [1, 2, 3]);
  assert.equal(bundle.part('b').string('strings', 1), '学校');
  assert.equal(bundle.part('a').column('n').values.buffer, bytes.buffer, 'part views share the bundle buffer');
  assert.throws(() => bundle.part('missing'), /missing part/);
  const bad = bytes.slice(); bad[0] = 0;
  assert.throws(() => decodeBundle(bad), /bad magic/);
  assert.throws(() => decodeBundle(bytes.slice(0, 20)), RangeError);
  // an unaligned section input still decodes (copied once)
  const shifted = new Uint8Array(a.byteLength + 1); shifted.set(a, 1);
  assert.deepEqual([...decodeSection(shifted.subarray(1)).column('n').values], [1, 2, 3]);
});

test('v2 replaces the per-shard string-pool/facts/lexical-index by one knowledge-bundle; v1 is unchanged', () => {
  const kinds = (build: typeof v1) => new Set(build.manifest.sections.map((s) => s.kind));
  assert.ok(kinds(v1).has('facts') && !kinds(v1).has('knowledge-bundle'));
  assert.ok(kinds(v2).has('knowledge-bundle') && !kinds(v2).has('facts') && !kinds(v2).has('string-pool') && !kinds(v2).has('lexical-index'));
  validateBrowserPackManifest(JSON.parse(JSON.stringify(v2.manifest)));
  const smuggled = { ...v2.manifest, sections: [...v2.manifest.sections, { ...v1.manifest.sections.find((s) => s.kind === 'facts')! }] };
  assert.throws(() => validateBrowserPackManifest(smuggled), /not part of compiler version 2/);
});

test('compact v2 detail reproduces every v1 detail payload exactly (derived ids, prefixed evidence)', async () => {
  const [p1, p2] = [await open(v1), await open(v2)];
  const surfaces = [...new Set(graph.facts.flatMap((f) => [f.surface, f.reading, f.target]).filter((x): x is string => typeof x === 'string'))];
  let compared = 0;
  for (const key of surfaces) {
    const [m1, m2] = [await p1.findMatches(key, 0), await p2.findMatches(key, 0)];
    const facts1 = m1.filter((m: any) => m.end === key.length).flatMap((m: any) => m.facts);
    const facts2 = m2.filter((m: any) => m.end === key.length).flatMap((m: any) => m.facts);
    assert.equal(facts2.length, facts1.length, key);
    for (let i = 0; i < facts1.length; i += 1) {
      assert.deepEqual(await p2.loadDetail(facts2[i].detailRef), await p1.loadDetail(facts1[i].detailRef), `${key} #${i}`);
      compared += 1;
    }
  }
  assert.ok(compared > 20);
});

test('a v2 conversion fetches index shards and one bundle per knowledge shard, never a lexeme shard', async () => {
  const log: string[] = [];
  const pack = await open(v2, log);
  const lexical = createBrowserLexicalRuntime(pack);
  const eager = log.length;
  const raw = await transformWithResolver(pack, lexical, '溶接の装丁を学校で今日', 'historical', {});
  assert.equal(raw.renderedText, '熔接の装丁を學校で今日');
  const fetched = log.slice(eager);
  assert.ok(fetched.length > 0);
  assert.ok(!fetched.some((id) => /^(lexeme-|string-pool|facts|lexical-index)/.test(id)), fetched.join());
  assert.ok(fetched.some((id) => id.startsWith('knowledge-bundle@')));
});

test('the committed v2 measurement report records sizes, requests, latency and memory for the current pack', async () => {
  const report = JSON.parse(await readFile(new URL('../data/reports/browser-pack-v2-measurements.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../data/browser-pack-v2/manifest.json', import.meta.url), 'utf8'));
  assert.equal(report.packDigest, manifest.packDigest);
  for (const run of Object.values<any>(report.runs)) {
    for (const field of ['eager', 'coldFirstResult', 'warmRepeat']) assert.ok(run[field] && Number.isInteger(run[field].requests), field);
    assert.equal(typeof run.residentArrayBufferBytes, 'number');
    assert.equal(typeof run.jsHeapDeltaBytes, 'number');
  }
  assert.ok(report.baselineBeforeI, 'the pre-I baseline is kept for comparison');
  assert.ok(report.runs.short.coldFirstResult.requests < report.baselineBeforeI.runs.short.coldFirstResult.requests);
  assert.ok(report.runs.short.coldFirstResult.bytes < report.baselineBeforeI.runs.short.coldFirstResult.bytes);
});
