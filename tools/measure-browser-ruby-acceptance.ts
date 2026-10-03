import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';
import { loadJmdictIntake } from './jmdict-intake.ts';
import { buildLexicalModel, jmdictLexemeMorphology, mergeMorphology, unidicLexemeMorphology } from './browser-pack-lexical-compiler.ts';
import { buildAcceptedBrowserPackV3 } from './generate-browser-pack.ts';

export const BROWSER_RUBY_ACCEPTANCE_REPORT = 'data/reports/browser-ruby-acceptance.json';
export const BROWSER_RUBY_ACCEPTANCE_PROFILES = ['modern', 'historical', 'kinotch-fixed'] as const;

/** Stable real-text corpus for #225. The expected rendering is asserted through the real v3 pack. */
export const BROWSER_RUBY_ACCEPTANCE_CORPUS = [
  { id: 'adult-suffix', text: '大人層', purpose: 'whole-word priority display; no per-character decomposition' },
  { id: 'necessary', text: '必要', purpose: 'whole-word lexical reading and component fallback' },
  { id: 'market-property', text: '市場特性', purpose: 'adjacent and overlapping segmentation; ambiguous market is fail-closed' },
  { id: 'publishers', text: '出版各社', purpose: 'compound plus suffix segmentation' },
  { id: 'japan-company', text: '日本企業', purpose: 'Sino whole-word path and opaque component boundary' },
  { id: 'service', text: 'サービス', purpose: 'KKH loanword source/profile behavior' },
  { id: 'same-reading-homograph', text: 'どん底', purpose: 'reading consensus without lexical winner' },
  { id: 'ambiguous-reading', text: '市場', purpose: 'multiple modern readings stay unresolved' },
  { id: 'candidate-reading', text: '阿呆', purpose: 'candidate readings remain candidate; no storage-order winner' },
  { id: 'zero-permitted-reading', text: '少し宛', purpose: 'JMdict restriction leaves no invented head reading' },
  { id: 'modern-historical', text: '南風', purpose: 'multi-reading historical basis does not cross-apply' },
  { id: 'multi-reading-lexeme', text: '狩人', purpose: 'multi-reading lexeme stays candidate' },
  { id: 'component-ruby', text: '｜学《がく》校《こう》', purpose: 'component Ruby is one protected lexical unit' },
  { id: 'protected-unknown', text: 'abc 😀 𠮷 ｜学校《がっこう》', purpose: 'ASCII, emoji, unknown and protected Ruby preservation' }
] as const;

const HAN = /\p{Script=Han}/u;
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function makeSurfaceInventory(model: ReturnType<typeof buildLexicalModel>) {
  const surfaces = new Map<string, {
    lexicalIdentities: Set<string>;
    modernReadings: Set<string>;
    modernCandidate: boolean;
    historicalReadings: Array<{ reading: string; route: number }>;
    han: boolean;
  }>();
  const get = (surface: string) => {
    let row = surfaces.get(surface);
    if (!row) {
      row = { lexicalIdentities: new Set(), modernReadings: new Set(), modernCandidate: false, historicalReadings: [], han: HAN.test(surface) };
      surfaces.set(surface, row);
    }
    return row;
  };
  for (const lexeme of model.lexemes) {
    for (const form of lexeme.forms) {
      const row = get(form.surface);
      row.lexicalIdentities.add(lexeme.lexicalIdentity);
    }
    for (const reading of lexeme.readings) {
      if (reading.surface === null) continue;
      const row = get(reading.surface);
      row.lexicalIdentities.add(lexeme.lexicalIdentity);
      if (reading.period === 1) {
        row.modernReadings.add(reading.reading);
        row.modernCandidate ||= reading.candidate;
      } else if (reading.period === 2) {
        row.historicalReadings.push({ reading: reading.reading, route: reading.route });
      }
    }
  }
  return surfaces;
}

export async function buildBrowserRubyAcceptanceReport(rootDir: string) {
  const { graph } = await normalizeAcceptedOrthographySources(rootDir);
  const { extract } = await loadJmdictIntake(rootDir);
  const unidic = JSON.parse(await readFile(resolve(rootDir, 'data/lexical/sources/unidic-cwj-202512-first-slice.json'), 'utf8'));
  const lexicalIdentities = new Set(graph.facts.flatMap((fact) => fact.lexicalRefs));
  const morphology = mergeMorphology(
    jmdictLexemeMorphology(extract),
    unidicLexemeMorphology(unidic, lexicalIdentities)
  );
  const model = buildLexicalModel(graph, morphology);
  const surfaces = makeSurfaceInventory(model);
  const rows = [...surfaces.entries()].sort(([a], [b]) => cmp(a, b));
  const count = (predicate: (row: ReturnType<typeof makeSurfaceInventory> extends Map<string, infer V> ? V : never, surface: string) => boolean) =>
    rows.filter(([surface, row]) => predicate(row, surface)).length;
  const committedManifest = JSON.parse(await readFile(resolve(rootDir, 'data/browser-pack-v3/manifest.json'), 'utf8'));
  const jmdictManifest = JSON.parse(await readFile(resolve(rootDir, 'data/lexical/sources/jmdict/2026-10-01/manifest.json'), 'utf8'));

  return {
    schemaVersion: '1',
    kind: 'browser-ruby-acceptance',
    owner: 'japanese-orthography#225',
    packDigest: committedManifest.packDigest,
    source: {
      jmdictSnapshot: jmdictManifest.source.createdDate,
      jmdictExtractSha256: jmdictManifest.extract.sha256,
      lexicalNamespaceId: graph.lexicalNamespaceId
    },
    baseline: {
      lexicalIdentities: model.lexemes.length,
      forms: model.lexemes.reduce((n, lexeme) => n + lexeme.forms.length, 0),
      readings: model.lexemes.reduce((n, lexeme) => n + lexeme.readings.length, 0),
      distinctWrittenSurfaces: rows.length
    },
    modernSurfaceReadings: {
      exactlyOneRestrictionValidReading: count((row) => row.modernReadings.size === 1),
      multipleRestrictionValidReadings: count((row) => row.modernReadings.size > 1),
      zeroRestrictionValidReadings: count((row) => row.modernReadings.size === 0),
      sourcePriorityOnUniqueReading: count((row) => row.modernReadings.size === 1 && row.modernCandidate === false)
    },
    entryShape: {
      kanaOnlyOrNoKanjiLexemes: model.lexemes.filter((lexeme) => lexeme.forms.every((form) => !HAN.test(form.surface))).length,
      hanSurfacesEligibleForSafeWholeWordRuby: count((row) => row.han && row.modernReadings.size === 1 && !row.modernCandidate),
      unresolvedOrCandidateSurfacesWithoutSafeRuby: count((row) => row.han && (row.modernReadings.size !== 1 || row.modernCandidate))
    },
    historical: {
      surfacesWithHistoricalReading: count((row) => row.historicalReadings.length > 0),
      surfacesWithReconstructedHistoricalReading: count((row) => row.historicalReadings.some((reading) => reading.route !== 0)),
      surfacesWithModernFallbackOnly: count((row) => row.han && row.modernReadings.size === 1 && row.historicalReadings.length === 0)
    },
    rubyOutputCoverage: {
      profiles: [...BROWSER_RUBY_ACCEPTANCE_PROFILES],
      corpusCases: BROWSER_RUBY_ACCEPTANCE_CORPUS.length,
      profileCases: BROWSER_RUBY_ACCEPTANCE_CORPUS.length * BROWSER_RUBY_ACCEPTANCE_PROFILES.length,
      sourceClasses: ['lexical-modern', 'historical-native', 'historical-sino', 'candidate-display', 'protected-or-unchanged']
    },
    corpus: BROWSER_RUBY_ACCEPTANCE_CORPUS.map(({ id, text, purpose }) => ({ id, text, purpose, profiles: [...BROWSER_RUBY_ACCEPTANCE_PROFILES] }))
  };
}

async function main() {
  const rootDir = resolve(import.meta.dirname, '..');
  const report = await buildBrowserRubyAcceptanceReport(rootDir);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  const path = resolve(rootDir, BROWSER_RUBY_ACCEPTANCE_REPORT);
  if (process.argv.includes('--check')) {
    const committed = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
    if (committed !== output) throw new Error(`${BROWSER_RUBY_ACCEPTANCE_REPORT} is stale; run npm run measure:browser-ruby`);
    console.log(`${BROWSER_RUBY_ACCEPTANCE_REPORT} OK`);
    return;
  }
  await writeFile(path, output);
  console.log(`wrote ${BROWSER_RUBY_ACCEPTANCE_REPORT}: ${report.baseline.lexicalIdentities} lexemes, ${report.baseline.distinctWrittenSurfaces} written surfaces`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
