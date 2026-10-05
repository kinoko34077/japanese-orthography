import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { lexicalLayer } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION } from '../tools/browser-pack-model.ts';
import { BROWSER_RESOLVER_PARITY_REPORT } from '../tools/browser-resolver-parity.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';

const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');

const graph = adapterFixture();
const build = compileBrowserPack(graph, [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  shardBudgetBytes: 2048, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION, layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
});
const openPack = () => openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!);
const pack = await openPack();
const lexical = createBrowserLexicalRuntime(pack);
const run = (text: string, profile = 'historical', renderMode = 'plain') => transformWithResolver(pack, lexical, text, profile, { renderMode });
const states = (raw: any) => raw.spans.map((s: any) => `${s.sourceText}:${s.state}:${s.renderedText}`);

test('historical conversion runs through the accepted resolver: relation, candidate set, deterministic kanji', async () => {
  const raw = await run('溶接の装丁を学校で');
  assert.equal(raw.engine, 'resolver');
  assert.equal(raw.renderedText, '熔接の装丁を學校で');
  assert.deepEqual(states(raw), ['溶接:applied:熔接', '装丁:unresolved:装丁', '学校:applied:學校']);
  const school = raw.units.find((u: any) => u.surface === '学校').unit;
  assert.deepEqual([school.kind, school.lexicalIdentity, school.reading, school.historical.kana, school.historical.surface, school.historical.disposition], ['resolved', 'lexeme:学校/がっこう', 'がっこう', 'がくかう', '學校', 'AUTO']);
});

test('Ruby render modes come from the resolver renderer (late rendering)', async () => {
  assert.equal((await run('学校', 'historical', 'ruby-whole-explicit')).renderedText, '｜學校《がくかう》');
  assert.equal((await run('学校', 'historical', 'ruby-whole-implicit')).renderedText, '學校《がくかう》');
  await assert.rejects(run('学校', 'historical', 'bogus'), RangeError);
});

test('contextual kanji binds through canonical lexicalRefs; an unbound constraint never applies', async () => {
  const bound = await run('台頭');
  assert.equal(bound.renderedText, '擡頭');
  assert.equal(bound.units.find((u: any) => u.surface === '台頭').unit.historical.contextualKanji, 'resolved');
  const unbound = await run('台風');
  assert.equal(unbound.renderedText, '台風');
  assert.deepEqual(states(unbound), ['台風:context_required:台風']);
});

test('kana input keeps its script; lexical candidates are reported, never selected', async () => {
  const raw = await run('がっこう');
  assert.equal(raw.renderedText, 'がくかう');
  const unit = raw.units.find((u: any) => u.surface === 'がっこう').unit;
  assert.equal(unit.kind, 'candidates');
  assert.deepEqual(unit.lexicalCandidates.map((c: any) => c.lexicalIdentity).sort(), ['lexeme:学校/がっこう', 'lexeme:楽校/がっこう']);
});

test('KiNoTch exact-token rule still applies; modern profile keeps the restoration engine', async () => {
  assert.equal((await run('こと', 'kinotch-fixed')).renderedText, 'ヿ');
  assert.equal((await run('こと', 'historical')).renderedText, 'こと');
  const modern = await run('熔接', 'modern');
  assert.equal(modern.engine, 'restoration');
  assert.equal(modern.renderedText, '溶接');
});

test('UTF-16 ranges stay correct around emoji / surrogate pairs and unknown text is preserved', async () => {
  const text = '😀溶接𠮷zzz';
  const raw = await run(text);
  assert.equal(raw.renderedText, '😀熔接𠮷zzz');
  const span = raw.spans[0];
  assert.deepEqual([span.start, span.end, text.slice(span.start, span.end)], [2, 4, '溶接']);
});

test('the worker service uses the resolver for a v2 pack and expands resolver-unit details', async () => {
  const service = createTransformService({ executionMode: 'legacy-only', openPack });
  const reply = await service.handle({ type: 'transform', requestId: 1, text: '学校', profileId: 'historical', renderMode: 'ruby-whole-explicit' });
  assert.equal(reply.type, 'result', reply.message);
  assert.equal(reply.result.renderedText, '｜學校《がくかう》');
  assert.deepEqual(structuredClone(reply), reply);
  const detail = await service.handle({ type: 'detail', requestId: 2, resultId: 1, detailRef: reply.result.spans[0].detailRef });
  assert.equal(detail.type, 'detail', detail.message);
  assert.equal(detail.detail.resolverUnit.lexicalIdentity, 'lexeme:学校/がっこう');
  assert.equal(detail.detail.acceptedCandidates[0].kind, 'resolver_unit');
});

test('the committed browser/core parity report has no unclassified mismatch', async () => {
  const report = JSON.parse(await readFile(new URL(`../${BROWSER_RESOLVER_PARITY_REPORT}`, import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../data/browser-pack-v2/manifest.json', import.meta.url), 'utf8'));
  assert.equal(report.packDigest, manifest.packDigest);
  assert.equal(report.summary.mismatches, 0);
  assert.equal(report.cases.find((c: any) => c.input === '学校').difference, null, '学校 must be identical to the core resolver');
  // 台風 keeps the accepted contextual kanji result; only the browser's extra Sino reading differs
  const taifu = report.cases.find((c: any) => c.input === '台風');
  assert.equal(taifu.difference, 'browser-sino-reconstruction');
  assert.equal(taifu.browser.historicalSurface, '颱風');
  assert.equal(taifu.browser.plain, taifu.core.plain);
  for (const c of report.cases) if (c.difference !== null) assert.ok(c.difference in report.differenceKinds, c.difference);
});
