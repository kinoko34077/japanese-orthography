import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { lexicalLayer } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION, validateBrowserPackManifest } from '../tools/browser-pack-model.ts';
import { symbolStringColumns, transcodeToV3 } from '../tools/browser-pack-v3.ts';
import { encodeSection } from '../tools/browser-pack-encoding.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from '../tools/symbol-registry.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';
import { canonicalizeOrthographyKnowledge } from '../tools/orthography-knowledge-model.ts';
import { compileRuleIR } from '../tools/rule-ir.ts';

// #211 F — BrowserPack v3: symbol-encoded hot string columns, same semantics as v2.
const require = createRequire(import.meta.url);
const { decodeSection } = require('../runtime/browser-pack-binary.js');
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');
const { summarize, expandDetail, expandUnitDetail } = require('../runtime/browser-diagnostic-contract.js');

const registry = JSON.parse(await readFile(new URL(`../${SYMBOL_REGISTRY}`, import.meta.url), 'utf8')) as SymbolRegistry;
const v2 = compileBrowserPack(adapterFixture(), [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  shardBudgetBytes: 2048, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION, layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
});
const v3 = transcodeToV3(v2, registry, { evidence: { graph: canonicalizeOrthographyKnowledge(adapterFixture()), ir: compileRuleIR(adapterFixture()) } });
const open = async (build: typeof v2) => {
  const pack = await openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!);
  return { pack, lexical: createBrowserLexicalRuntime(pack) };
};

test('symbol-encoded columns restore every string exactly (orthographic atoms, ASCII identifiers, unknown atoms)', () => {
  const values = ['', '学校', '｜學校《がくかう》', 'lexeme:学校/がっこう', 'jmdict:2026-10-01:seq:1289400', '😀𠮷', 'a學b'];
  const section = decodeSection(encodeSection(symbolStringColumns('strings', values, registry)), { atoms: registry.atoms });
  assert.equal(section.rowCount('strings'), values.length);
  values.forEach((v, i) => assert.equal(section.string('strings', i), v));
  assert.throws(() => decodeSection(encodeSection(symbolStringColumns('strings', ['学校'], registry))).string('strings', 0), /Symbol Registry atoms are required/);
});

test('the v3 manifest validates: same sections as v2 plus an eager symbol registry, compiler version 3', () => {
  const m = validateBrowserPackManifest(JSON.parse(JSON.stringify(v3.manifest)));
  assert.equal(m.compilerVersion, '3');
  const v3Only = new Set(['symbol-registry', 'evidence-map', 'program-evidence']);
  assert.deepEqual(m.sections.filter((s) => !v3Only.has(s.kind)).map((s) => s.sectionId).sort(), v2.manifest.sections.filter((s) => s.kind !== 'provenance-index').map((s) => s.sectionId).sort());
  assert.equal(m.sections.find((s) => s.kind === 'symbol-registry')!.loading, 'eager');
  assert.notEqual(m.packDigest, v2.manifest.packDigest);
});

test('v3 converts, diagnoses and inspects exactly like v2 (every profile, render mode and detail)', async () => {
  const [a, b] = [await open(v2), await open(v3)];
  const texts = ['溶接の装丁を学校で', '学校', '｜学校《がっこう》', '｜今日《きょう》', 'がっこう', '台頭と台風', 'こと', 'ドイツ', 'みる', '😀溶接𠮷zzz', '熔接と圓'];
  for (const profile of ['historical', 'modern', 'kinotch-fixed']) {
    for (const mode of ['plain', 'ruby-whole-explicit']) {
      for (const text of texts) {
        const [ra, rb] = [await transformWithResolver(a.pack, a.lexical, text, profile, { renderMode: mode }), await transformWithResolver(b.pack, b.lexical, text, profile, { renderMode: mode })];
        assert.deepEqual(summarize(rb), summarize(ra), `${profile}/${mode}/${text}`);
        assert.deepEqual(rb.units ?? null, ra.units ?? null, `${profile}/${mode}/${text} units`);
        const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === 'evidence' ? undefined : v)));
        for (const span of ra.spans.keys()) assert.deepEqual(strip(await expandDetail(b.pack, rb, String(span))), await expandDetail(a.pack, ra, String(span)));
        for (const unit of summarize(ra).units) assert.deepEqual(await expandUnitDetail(b.pack, b.lexical, rb, unit.detailRef), await expandUnitDetail(a.pack, a.lexical, ra, unit.detailRef));
      }
    }
  }
});

test('v3 hot sections carry no UTF-8 orthographic string columns', () => {
  for (const s of v3.manifest.sections) {
    if (s.encoding !== 'binary-columnar' || s.kind === 'symbol-registry') continue;
    const section = decodeSection(v3.files.get(s.path)!, { atoms: registry.atoms });
    for (const column of Object.values<any>(section.columns)) if (column.utf8) assert.ok(column.name.endsWith('$raw'), `${s.sectionId}.${column.name}`);
  }
});

test('the committed v3 lock and reports show the accepted pack shrinking without semantic change', async () => {
  const read = async (p: string) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), 'utf8'));
  const [m2, m3, c2, c3, x2, x3] = await Promise.all([
    read('data/browser-pack-v2/manifest.json'), read('data/browser-pack-v3/manifest.json'),
    read('data/reports/browser-pack-v2-compiled.json'), read('data/reports/browser-pack-v3-compiled.json'),
    read('data/reports/browser-pack-v2-measurements.json'), read('data/reports/browser-pack-v3-measurements.json')
  ]);
  assert.equal(m3.compilerVersion, '3');
  assert.equal(m3.canonicalGraphSha256, m2.canonicalGraphSha256, 'same canonical knowledge');
  assert.equal(c3.packDigest, m3.packDigest);
  assert.equal(x3.packDigest, m3.packDigest);
  // the hot pack (what a conversion can fetch) shrinks; cold evidence (#211 G) is lazy and separate
  const hot = (c: any) => c.byLoading.eager.bytes + c.byLoading['on-demand'].bytes;
  assert.ok(hot(c3) < hot(c2));
  assert.ok(x3.runs.short.coldFirstResult.bytes < x2.runs.short.coldFirstResult.bytes);
});
