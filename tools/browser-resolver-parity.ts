import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import type { BrowserPackBuild } from './browser-pack-compiler.ts';
import type { UniDicSourceSlice } from './lexical-compiler.ts';
import { buildResolverBundleArtifact } from './resolver-bundle.ts';

// #196 D — Browser vs accepted core resolver parity. The core side is the accepted ResolverBundle
// (UniDic first-slice lexical + native/Sino/contextual/safe-character slices); the browser side is
// the BrowserPack v2 adapter. Where both have the capability, semantic fields must agree. A
// difference is admissible only when it is one of the classified, explained kinds below; anything
// else fails `validate:browser-pack`.

export const BROWSER_RESOLVER_PARITY_REPORT = 'data/reports/browser-resolver-parity.json';

const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');

export const PARITY_SURFACE_CASES = ['学校', '台風', '今日', '思う', '買う', '合う', '味わおう', '｜学校《がっこう》', '｜今日《きょう》'] as const;
export const PARITY_READING_CASES = ['がっこう', 'きょう'] as const;

/** Admissible, explained differences (everything else is a parity failure). */
export const PARITY_DIFFERENCE_KINDS = {
  'lexicon-granularity': 'core lexicon has one candidate per UniDic conjugation row of the same lemma, so the core unit is `candidates`; the browser resolves the one JMdict lexeme (same headword)',
  'browser-wider-lexicon': 'the browser lexicon (JMdict) has further lexemes for the same input; the core identity is among the browser candidates and nothing is selected',
  'core-unknown': 'the input is outside the core first-slice lexicon; there is nothing to compare',
  'unbound-relation': 'both sides keep the lexical ambiguity; the browser additionally applies a canonical relation bound to no lexeme (it holds for every candidate), which the core first slice does not carry',
  'ruby-round-trip': 'every semantic field is identical; on Ruby input the browser keeps the authors Ruby markup in plain mode (late render), where the core plain renderer drops it',
  'browser-agreeing-sources': 'same identity and reading; the core slice has no historical reading, the browser has one confirmed by two agreeing canonical sources (surface-keyed historical reading + the native kana relation of the reading)',
  'browser-canonical-relations': 'every lexical field (identity, reading, origin, part of speech) is identical; the browser additionally reaches canonical historical relations for this surface that the core first slice does not carry, which changes only the historical disposition/output',
  'browser-sino-reconstruction': 'every lexical field is identical; the core first slice has no Sino component table, the browser reconstructs the historical reading with the accepted 4.6E component reconstructor over the canonical sino bindings'
} as const;

const katakanaToHiragana = (text: string) => text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
const json = async (root: string, path: string) => JSON.parse(await readFile(resolve(root, path), 'utf8'));

async function loadUmd(root: string, path: string, globals: Record<string, unknown> = {}) {
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile(resolve(root, path), 'utf8'), sandbox, { filename: path });
  return sandbox;
}

async function coreBundle(root: string) {
  const [lexicalSource, nativeSlice, sinoSlice, contextualBindingSlice, contextualManifest, contextualTaiPack, safeCharacterSlice] = await Promise.all([
    'data/lexical/sources/unidic-cwj-202512-first-slice.json', 'data/historical/native/kkh-kana-first-slice.json', 'data/historical/sino/kkh-jion-first-slice.json',
    'data/lexical/bindings/contextual-kanji-unidic-first-slice.json', 'data/packs/contextual-kanji/manifest.json', 'data/packs/contextual-kanji/merged-tai.json',
    'data/deterministic/safe-character-first-slice.json'
  ].map((p) => json(root, p)));
  const artifact = buildResolverBundleArtifact({ lexicalSource, nativeSlice, sinoSlice, contextualBindingSlice, contextualManifest, contextualTaiPack, safeCharacterSlice } as never);
  const [lexical, native, sino, safe, shared] = await Promise.all(['lexical-runtime', 'historical-native-runtime', 'historical-sino-runtime', 'safe-character-runtime', 'transform-shared'].map((n) => loadUmd(root, `runtime/${n}.js`))) as Array<Record<string, any>> as [Record<string, any>, Record<string, any>, Record<string, any>, Record<string, any>, Record<string, any>];
  const resolver = await loadUmd(root, 'runtime/orthography-resolver.js', { TransformShared: shared.TransformShared });
  const runtime = await loadUmd(root, 'runtime/resolver-bundle-runtime.js', {
    LexicalRuntime: lexical.LexicalRuntime, HistoricalNativeRuntime: native.HistoricalNativeRuntime, HistoricalSinoRuntime: sino.HistoricalSinoRuntime,
    SafeCharacterRuntime: safe.SafeCharacterRuntime, OrthographyResolver: resolver.OrthographyResolver
  });
  // core identity -> the browser (JMdict) identity its headword names
  const bridge = new Map<string, string>();
  for (const r of (lexicalSource as UniDicSourceSlice).records) bridge.set(`unidic-cwj:2025.12:lemma:${r.sourceLemmaId}`, `lexeme:${r.orthBase}/${katakanaToHiragana(r.kanaBase)}`);
  return { bundle: runtime.ResolverBundleRuntime.createResolverBundle(artifact), bridge };
}

type Fields = Record<string, unknown>;
const coreFields = (u: any, bridge: Map<string, string>, render: (mode: string) => string): Fields => ({
  kind: u.kind,
  lexicalIdentity: u.lexicalIdentity ? bridge.get(u.lexicalIdentity) ?? u.lexicalIdentity : null,
  candidateIdentities: [...new Set((u.lexicalCandidates ?? []).map((c: any) => bridge.get(c.lexicalIdentity) ?? c.lexicalIdentity))].sort(),
  candidateReadings: [...new Set((u.lexicalCandidates ?? []).map((c: any) => c.reading))].sort(),
  reading: u.reading?.modernSurface ?? null,
  lexicalOrigin: u.lexicalOrigin ?? 'unknown',
  partOfSpeech: u.morphology ? u.morphology.partOfSpeech.filter((p: string) => p !== '*') : null,
  historicalKana: u.historical?.kana ?? null,
  historicalSurface: u.historical?.surface ?? null,
  disposition: u.historical?.disposition ?? null,
  plain: render('plain'),
  rubyWhole: render('ruby-whole-explicit')
});

export async function browserCoreParity(root: string, build: BrowserPackBuild) {
  const { bundle, bridge } = await coreBundle(root);
  const pack = await openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!);
  const lexical = createBrowserLexicalRuntime(pack);
  const browserUnit = async (text: string, mode: string) => {
    const raw = await transformWithResolver(pack, lexical, text, 'historical', { renderMode: mode });
    return { raw, unit: raw.units.find((u: any) => u.start === 0 && u.end === text.length)?.unit ?? null };
  };
  const browserFields = async (text: string): Promise<Fields> => {
    const plain = await browserUnit(text, 'plain');
    const ruby = await browserUnit(text, 'ruby-whole-explicit');
    const u = plain.unit;
    return {
      kind: u?.kind ?? 'unresolved',
      lexicalIdentity: u?.lexicalIdentity ?? null,
      candidateIdentities: u && u.kind === 'candidates' ? [...new Set(u.lexicalCandidates.map((c: any) => c.lexicalIdentity))].sort() : [],
      candidateReadings: u && u.kind === 'candidates' ? [...new Set(u.lexicalCandidates.map((c: any) => c.reading))].sort() : [],
      reading: u?.reading ?? null,
      lexicalOrigin: u?.lexicalOrigin ?? 'unknown',
      partOfSpeech: u?.morphology?.partOfSpeech ?? null,
      historicalKana: u?.historical.kana ?? null,
      historicalSurface: u?.historical.surface ?? null,
      disposition: u?.historical.disposition ?? null,
      plain: plain.raw.renderedText,
      rubyWhole: ruby.raw.renderedText,
      // classification-only (not compared): what the browser used beyond the core slice
      _route: u?.historical.route ?? null,
      _contextualCandidates: u?.historical.contextualCandidates ?? []
    };
  };

  const classify = (core: Fields, browser: Fields, coreUnit: any): string | null => {
    const differs = Object.keys(core).some((k) => JSON.stringify(core[k]) !== JSON.stringify(browser[k]));
    const lexicalSame = ['kind', 'lexicalIdentity', 'reading', 'lexicalOrigin', 'partOfSpeech'].every((k) => JSON.stringify(core[k]) === JSON.stringify(browser[k]));
    if (!differs) return null;
    if (core.kind === 'unresolved' && (core.candidateIdentities as string[]).length === 0) return 'core-unknown';
    const coreIds = new Set((coreUnit.lexicalCandidates ?? []).map((c: any) => c.lexicalIdentity));
    if (core.kind === 'candidates' && coreIds.size === 1 && browser.kind === 'resolved' && browser.lexicalIdentity === (core.candidateIdentities as string[])[0]) return 'lexicon-granularity';
    const coreIdentity = core.lexicalIdentity as string | null;
    const coreReadings = (core.candidateReadings ?? []) as string[];
    const browserReadings = (browser.candidateReadings ?? []) as string[];
    if (core.kind === 'candidates' && browser.kind === 'candidates' && coreReadings.every((r) => browserReadings.includes(r))) {
      return browser.plain === core.plain ? 'browser-wider-lexicon' : 'unbound-relation';
    }
    const differing = Object.keys(core).filter((k) => JSON.stringify(core[k]) !== JSON.stringify(browser[k]));
    if (differing.length === 1 && differing[0] === 'plain' && browser.plain === core.rubyWhole && browser.rubyWhole === core.rubyWhole) return 'ruby-round-trip';
    if (lexicalSame && core.historicalKana === null && browser._route === 'sino' && browser.historicalKana !== null && core.historicalSurface === browser.historicalSurface) return 'browser-sino-reconstruction';
    if (core.kind === 'resolved' && browser.kind === 'resolved' && core.lexicalIdentity === browser.lexicalIdentity && core.reading === browser.reading
      && core.historicalSurface === browser.historicalSurface && core.historicalKana === null && browser.historicalKana !== null) return 'browser-agreeing-sources';
    if (lexicalSame && core.disposition === 'SOURCE_REVIEW' && (browser._contextualCandidates as string[]).length > 0) return 'browser-canonical-relations';
    if (coreIdentity && browser.kind === 'candidates' && (browser.candidateIdentities as string[]).includes(coreIdentity) && browser.plain === core.plain) return 'browser-wider-lexicon';
    return 'MISMATCH';
  };

  const cases = [];
  for (const text of PARITY_SURFACE_CASES) {
    const u = bundle.resolveUnit(text);
    const core = coreFields(u, bridge, (mode) => bundle.render(u, { mode }));
    const browser = await browserFields(text);
    const difference = classify(core, browser, u);
    const { _route, _contextualCandidates, ...browserFieldsOnly } = browser;
    cases.push({ route: 'surface', input: text, core, browser: { ...browserFieldsOnly, historicalRoute: _route }, difference, fieldsDiffering: Object.keys(core).filter((k) => JSON.stringify(core[k]) !== JSON.stringify(browser[k])) });
  }
  for (const text of PARITY_READING_CASES) {
    const u = bundle.resolveReading(text);
    const core = coreFields(u, bridge, (mode) => bundle.render(u, { mode }));
    // kana input keeps its script in the browser (historical kana of the kana itself); identity is
    // compared through the browser reading candidates
    const candidates = await lexical.lookupReading(text);
    const browser: Fields = { ...core, kind: candidates.length === 1 ? 'resolved' : candidates.length ? 'candidates' : 'unresolved', lexicalIdentity: candidates.length === 1 ? candidates[0].lexicalIdentity : null, candidateIdentities: candidates.length > 1 ? [...new Set(candidates.map((c: any) => c.lexicalIdentity))].sort() : [] };
    const compared = { kind: core.kind, lexicalIdentity: core.lexicalIdentity, candidateIdentities: core.candidateIdentities };
    const browserCompared = { kind: browser.kind, lexicalIdentity: browser.lexicalIdentity, candidateIdentities: browser.candidateIdentities };
    const difference = classify({ ...compared, plain: null }, { ...browserCompared, plain: null }, u);
    cases.push({ route: 'reading', input: text, core: compared, browser: browserCompared, difference, fieldsDiffering: Object.keys(compared).filter((k) => JSON.stringify((compared as Fields)[k]) !== JSON.stringify((browserCompared as Fields)[k])) });
  }
  return {
    schemaVersion: '1',
    kind: 'browser-resolver-parity',
    owner: 'japanese-orthography#196 D',
    packDigest: build.manifest.packDigest,
    differenceKinds: PARITY_DIFFERENCE_KINDS,
    summary: {
      cases: cases.length,
      identical: cases.filter((c) => c.difference === null).length,
      classified: cases.filter((c) => c.difference !== null && c.difference !== 'MISMATCH').length,
      mismatches: cases.filter((c) => c.difference === 'MISMATCH').length
    },
    cases
  };
}
