import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAcceptedBrowserPackV3 } from '../tools/generate-browser-pack.ts';
import { BROWSER_RUBY_ACCEPTANCE_CORPUS } from '../tools/measure-browser-ruby-acceptance.ts';
import { registerVerticalCases } from './fixtures/vertical-cases.ts';

// #211 I — Browser/core parity on BrowserPack v3: the twelve #196 J vertical cases run on the real
// accepted v3 pack through the same worker service, and the committed parity / capability / measurement
// reports must describe this exact pack.
const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');

const build = await buildAcceptedBrowserPackV3(fileURLToPath(new URL('..', import.meta.url)));
const service = createTransformService({ openPack: () => openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!) });
const acceptancePack = await openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!);
const acceptanceLexical = createBrowserLexicalRuntime(acceptancePack);
const read = async (path: string) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const runAcceptance = (text: string, profileId: string, renderMode = 'ruby-whole-explicit') => transformWithResolver(acceptancePack, acceptanceLexical, text, profileId, { renderMode });
const unitFor = (raw: any, surface: string) => raw.units.find((unit: any) => unit.surface === surface)?.unit ?? null;

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

test('R7 committed real-text coverage report is for this exact v3 pack', async () => {
  const report = await read('data/reports/browser-ruby-acceptance.json');
  assert.equal(report.owner, 'japanese-orthography#225');
  assert.equal(report.packDigest, build.manifest.packDigest);
  assert.deepEqual(report.rubyOutputCoverage.profiles, ['modern', 'historical', 'kinotch-fixed']);
  assert.equal(report.rubyOutputCoverage.corpusCases, BROWSER_RUBY_ACCEPTANCE_CORPUS.length);
  assert.deepEqual(report.corpus.map((row: any) => row.id), BROWSER_RUBY_ACCEPTANCE_CORPUS.map((row) => row.id));
  assert.ok(report.modernSurfaceReadings.zeroRestrictionValidReadings > 0);
  assert.ok(report.modernSurfaceReadings.multipleRestrictionValidReadings > 0);
  assert.ok(report.entryShape.hanSurfacesEligibleForSafeWholeWordRuby > 0);
});

test('R7 real-text corpus keeps lexical, reading, history, Ruby, and UTF-16 boundaries distinct', async () => {
  const adult = await runAcceptance('大人層', 'modern');
  const adultUnit = unitFor(adult, '大人');
  assert.equal(adult.renderedText, '｜大人《おとな》｜層《そう》');
  assert.equal(adultUnit.kind, 'candidates', 'display priority must not become a lexical winner');
  assert.equal(adultUnit.lexicalIdentity, null);
  assert.deepEqual(adultUnit.lexicalCandidates.map((candidate: any) => candidate.reading), ['うし', 'おおびと', 'おとな', 'たいじん', 'だいにん']);
  assert.deepEqual(adult.spans.map((span: any) => [span.start, span.end]), [[0, 2], [2, 3]]);
  assert.equal(adult.spans.some((span: any) => span.sourceText === '大' || span.sourceText === '人'), false);

  for (const profileId of ['modern', 'historical', 'kinotch-fixed']) {
    const necessary = await runAcceptance('必要', profileId);
    const necessaryUnit = unitFor(necessary, '必要');
    const expectedNecessaryRuby = profileId === 'modern' ? 'ひつよう' : 'ひつえう';
    assert.equal(necessary.renderedText, `｜必要《${expectedNecessaryRuby}》`, profileId);
    assert.equal(necessaryUnit.kind, 'resolved', profileId);
    assert.equal(necessaryUnit.reading, 'ひつよう', profileId);
    assert.deepEqual(necessary.spans.map((span: any) => [span.start, span.end]), [[0, 2]], profileId);
    const component = await runAcceptance('必要', profileId, 'ruby-components-explicit');
    const expectedComponentRuby = profileId === 'modern' ? necessary.renderedText : '｜必《ひつ》要《えう》';
    assert.equal(component.renderedText, expectedComponentRuby, `${profileId}: complete component evidence may be emitted; partial evidence must still fall back`);
  }

  const marketProperty = await runAcceptance('市場特性', 'modern');
  const market = unitFor(marketProperty, '市場');
  assert.equal(market.kind, 'candidates');
  assert.deepEqual(market.lexicalCandidates.map((candidate: any) => candidate.reading), ['いちば', 'しじょう']);
  assert.equal(marketProperty.renderedText, '市場｜特性《とくせい》');
  assert.deepEqual(marketProperty.spans.map((span: any) => [span.start, span.end]), [[2, 4]]);

  const publishers = await runAcceptance('出版各社', 'modern');
  assert.equal(publishers.renderedText, '｜出版《しゅっぱん》｜各社《かくしゃ》');
  assert.deepEqual(publishers.spans.map((span: any) => [span.start, span.end]), [[0, 2], [2, 4]]);

  for (const profileId of ['modern', 'historical', 'kinotch-fixed']) {
    const japanCompany = await runAcceptance('日本企業', profileId);
    const company = unitFor(japanCompany, '日本企業');
    assert.equal(japanCompany.renderedText, '｜日本企業《にほんきぎょう》', profileId);
    assert.equal(company.kind, 'resolved', profileId);
    assert.equal(company.lexicalIdentity, 'lexeme:日本企業/にほんきぎょう', profileId);
    assert.equal(company.historical.diagnostic, profileId === 'modern' ? null : 'sino_evidence_unavailable', profileId);
    assert.deepEqual(japanCompany.spans.map((span: any) => [span.start, span.end]), [[0, 4]], profileId);
    const component = await runAcceptance('日本企業', profileId, 'ruby-components-explicit');
    assert.equal(component.renderedText, japanCompany.renderedText, `${profileId}: opaque Sino component evidence must fall back to whole Ruby`);
    assert.equal(component.renderedText.includes('本《ほ》'), false, `${profileId}: unmatched Sino material must not be assigned to 本`);
  }

  const serviceModern = await runAcceptance('サービス', 'modern');
  const serviceHistorical = await runAcceptance('サービス', 'historical');
  assert.equal(serviceModern.renderedText, 'サービス');
  assert.equal(serviceHistorical.renderedText, 'サーヸス');
  assert.equal(unitFor(serviceHistorical, 'サービス').historical.route, 'native');

  const consensus = await runAcceptance('どん底', 'modern');
  const consensusUnit = unitFor(consensus, 'どん底');
  assert.equal(consensus.renderedText, '｜どん底《どんぞこ》');
  assert.equal(consensusUnit.kind, 'candidates');
  assert.equal(consensusUnit.lexicalIdentity, null);
  assert.deepEqual([...new Set(consensusUnit.lexicalCandidates.map((candidate: any) => candidate.reading))], ['どんぞこ']);

  const ambiguous = await runAcceptance('市場', 'modern');
  assert.equal(ambiguous.renderedText, '市場');
  assert.equal(unitFor(ambiguous, '市場').kind, 'candidates');

  const candidateReading = await runAcceptance('阿呆', 'historical');
  const candidateUnit = unitFor(candidateReading, '阿呆');
  assert.equal(candidateReading.renderedText, '阿呆', 'historical candidate readings must not be presented as a selected Ruby winner');
  assert.equal(candidateUnit.kind, 'candidates');
  assert.deepEqual(candidateUnit.historical.candidateReadings, ['あはう', 'アホ']);
  assert.ok(candidateUnit.historical.sourceRefs.includes('intake/phase46d-native-kana'));
  assert.ok(candidateUnit.historical.canonicalIds.length > 0);

  const zero = await runAcceptance('少し宛', 'modern');
  const zeroUnit = unitFor(zero, '少し宛');
  assert.equal(zero.renderedText, '少し宛');
  assert.ok(zeroUnit, 'the surface remains inspectable');
  assert.equal(zeroUnit.reading, null, 'zero permitted JMdict readings must not fall back to a lexeme head reading');
  assert.equal(zero.spans.length, 0);

  const southWind = await runAcceptance('南風', 'historical');
  const southWindUnit = unitFor(southWind, '南風');
  assert.equal(southWind.renderedText, '｜南風《みなみかぜ》');
  assert.equal(southWindUnit.kind, 'candidates');
  assert.equal(southWindUnit.historical.kana, null, 'unbound historical basis must not cross-apply はえ');
  assert.equal(southWindUnit.historical.candidateReadings.includes('はえ'), false);

  const hunter = await runAcceptance('狩人', 'historical');
  assert.equal(hunter.renderedText, '｜狩人《かりゅうど》');
  assert.equal(unitFor(hunter, '狩人').kind, 'candidates');

  const protectedText = 'abc 😀 𠮷 ｜学校《がっこう》';
  const protectedResult = await runAcceptance(protectedText, 'historical');
  assert.equal(protectedResult.renderedText, 'abc 😀 𠮷 ｜學校《がくかう》');
  const protectedSpan = protectedResult.spans.find((span: any) => span.sourceText === '｜学校《がっこう》');
  assert.deepEqual([protectedSpan.start, protectedSpan.end], [10, 19]);
  assert.equal(protectedText.slice(protectedSpan.start, protectedSpan.end), protectedSpan.sourceText);
  assert.equal(protectedResult.renderedText.startsWith('abc 😀 𠮷 '), true);

  const componentRuby = await runAcceptance('｜学《がく》校《こう》', 'historical');
  assert.equal(componentRuby.renderedText, '｜學校《がくかう》');
  assert.equal(componentRuby.units.length, 1);
  assert.equal(componentRuby.units[0].unit.sourceSurface, '学校');
  assert.deepEqual(componentRuby.spans.map((span: any) => [span.start, span.end]), [[0, 11]]);
});
