import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { buildCoverageSummary, canonicalizeAlternatives, type CoverageSummary } from './intake-accounting.ts';
import type { IntakeBundleDocument, IntakeRecord, SourceSnapshot } from './intake-model.ts';
import { parseSinoReadingClassWorkbook, type SinoReadingClassEntry, type SinoReadingClassParseResult } from './sino-reading-class.ts';
import { parseSinoTableHtml, type SinoTableParseResult, type SinoTableRecord } from './sino-table-parser.ts';
import { normalizeCheckoutText } from './verification-text.ts';

export const PHASE46E_TABLE_PATH = '仮名遣等資料/字音仮名遣い表.html';
export const PHASE46E_READING_CLASS_PATH = '仮名遣等資料/字音仮名_まとめ.xlsx';
export const PHASE46E_INTAKE_PATH = 'data/intake/phase46e-sino-kana.json';
export const PHASE46E_COVERAGE_REPORT_PATH = 'data/reports/phase46e-sino-kana-coverage.json';
export const PHASE46E_ARTIFACT_PATH = 'data/historical/sino/phase46e-sino-kana.json';
const IDENTITY_SLICE_PATH = 'data/historical/sino/kkh-jion-first-slice.json';
export const PHASE46E_SYMBOL_REGISTRY_GENERATION = 1;

export const PHASE46E_SINO_SOURCE_SNAPSHOT: SourceSnapshot = {
  sourceId: 'phase46e-sino-table',
  sourceClass: 'committed-reference',
  repository: 'kinoko34077/japanese-orthography',
  commit: '1af5f2dfb8825a19ec1e51cd36650a596ac61f44',
  path: PHASE46E_TABLE_PATH,
  blobSha: '89dd7a10ed9fd5ef12ea33b227bb513c2847818a',
  coverageRole: 'coverage-contract'
};

export const PHASE46E_READING_CLASS_SOURCE_SNAPSHOT: SourceSnapshot = {
  sourceId: 'phase46e-sino-reading-class',
  sourceClass: 'committed-reference',
  repository: 'kinoko34077/japanese-orthography',
  commit: '1af5f2dfb8825a19ec1e51cd36650a596ac61f44',
  path: PHASE46E_READING_CLASS_PATH,
  blobSha: '7d021eca0408f2b9e9a203c6733dacb48a1ed39f',
  coverageRole: 'supplemental'
};

type JsonRecord = Record<string, any>;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function evidenceRef(record: SinoTableRecord): string {
  return `${record.sourceRef}:${record.sourceLocator}`;
}

// Semantic key: (character, identified modern Sino-Japanese reading, optional context).
function semanticKey(record: SinoTableRecord): string {
  return JSON.stringify([record.character, record.modernReading, record.context ?? '']);
}

export function buildPhase46eSinoIntake(parsed: SinoTableParseResult): IntakeBundleDocument {
  const readingsByKey = new Map<string, Set<string>>();
  for (const record of parsed.records) {
    if (!record.character || record.exclusionReason) continue;
    const set = readingsByKey.get(semanticKey(record)) ?? new Set<string>();
    set.add(record.historicalReading);
    readingsByKey.set(semanticKey(record), set);
  }

  const records: IntakeRecord[] = parsed.records.map((record) => {
    const base: IntakeRecord = {
      id: `phase46e:${record.sourceRef}:${record.sourceLocator}`,
      sourceRef: record.sourceRef,
      sourceLocator: record.sourceLocator,
      sourceRecordKind: record.sourceRecordKind,
      responsibility: 'historical_kana_sino',
      disposition: 'admitted',
      ...(record.character ? { modernSurface: record.character } : {}),
      modernReading: record.modernReading,
      historicalReading: record.historicalReading,
      ...(record.context ? { morphology: { usage: record.context } } : {}),
      evidenceRefs: [evidenceRef(record)]
    };
    if (record.exclusionReason) {
      return { ...base, disposition: 'excluded_unresolved', exclusionReason: record.exclusionReason };
    }
    const alternatives = canonicalizeAlternatives([...(readingsByKey.get(semanticKey(record)) ?? [])]);
    if (alternatives.length > 1) {
      return { ...base, disposition: 'candidate_ambiguous', alternatives };
    }
    return base;
  });

  return {
    schemaVersion: '1',
    kind: 'orthography_intake_bundle',
    snapshots: [PHASE46E_SINO_SOURCE_SNAPSHOT, PHASE46E_READING_CLASS_SOURCE_SNAPSHOT],
    records
  };
}

export function buildPhase46eCoverageReport(bundle: IntakeBundleDocument, parsed: SinoTableParseResult, readingClass: SinoReadingClassParseResult) {
  const summary: CoverageSummary = buildCoverageSummary({
    snapshot: PHASE46E_SINO_SOURCE_SNAPSHOT,
    discoveredRecordIds: parsed.discoveredRecordIds,
    records: bundle.records,
    remainders: parsed.remainders
  });
  const { discoveredRecordIds, admittedRecordIds, ambiguousRecordIds, excludedRecordIds, ...counts } = summary;
  return {
    schemaVersion: '1',
    kind: 'phase46e_sino_kana_coverage_report',
    sources: [{
      ...counts,
      identityRecords: bundle.records.filter((record) => record.sourceRecordKind === 'identity').length,
      contextQualifiedRecords: bundle.records.filter((record) => record.morphology?.usage).length,
      headingReadings: parsed.headingReadings.length,
      excludedRecordIds
    }],
    readingClass: {
      sourceId: PHASE46E_READING_CLASS_SOURCE_SNAPSHOT.sourceId,
      entries: readingClass.entries.length,
      remainders: readingClass.remainders,
      rowCount: readingClass.rowCount
    }
  };
}

function relationKey(character: string, modernReading: string, context: string | null = null): string {
  return JSON.stringify([character, modernReading, context]);
}

function classIdentityRelations(
  parsed: SinoTableParseResult,
  readingClass: SinoReadingClassParseResult,
  runtimeSymbols: ReadonlySet<string>
): JsonRecord[] {
  const htmlKeys = new Set(parsed.records.filter((record) => record.character).map((record) => relationKey(record.character!, record.modernReading, record.context)));
  const catchAll = parsed.records.find((record) => record.exclusionReason === 'catch_all_statement');
  if (!catchAll) throw new Error('Phase 4.6E catch-all authority record is missing');
  const catchAllRef = evidenceRef(catchAll);
  // XLSXの分類は、HTMLの歴史的綴りを単独で発明しない。一方、HTMLには
  // 「現代仮名遣いと同じ」と明記された文字が載らない場合があるため、
  // compact runtimeへ投影できる既存Symbol Registryの文字だけを昇格させる。
  // 未投影の分類証拠はreadingClassEvidenceに全件保持し、ここで黙って捨てない。
  return readingClass.entries
    .filter((entry) => runtimeSymbols.has(entry.character)
      // 一つ以上の分類を持つentryをHTML catch-allのidentityとして投影する。
      // 複数分類のentryもbit flagの組み合わせとして保持し、曖昧性を削らない。
      && entry.classes.length > 0
      && !htmlKeys.has(relationKey(entry.character, entry.modernReading)))
    .map((entry) => ({
      character: entry.character,
      modernReading: entry.modernReading,
      context: null,
      historicalReadings: [entry.modernReading],
      readingClasses: entry.classes,
      evidenceRefs: [...new Set([...entry.evidenceRefs, catchAllRef])].sort(compareText)
    }));
}

export function compileSinoKanaArtifact(
  bundle: IntakeBundleDocument,
  parsed: SinoTableParseResult,
  identitySlice: JsonRecord,
  readingClass: SinoReadingClassParseResult,
  runtimeSymbols: ReadonlySet<string>
) {
  const readingClassByKey = new Map(readingClass.entries.map((entry) => [relationKey(entry.character, entry.modernReading), entry]));
  const groups = new Map<string, { character: string; modernReading: string; context: string | null; historicalReadings: Set<string>; evidenceRefs: Set<string>; readingClasses: Set<string> }>();
  for (const record of bundle.records) {
    if (record.disposition === 'excluded_unresolved' || !record.modernSurface) continue;
    const context = record.morphology?.usage ?? null;
    const key = JSON.stringify([record.modernSurface, record.modernReading, context ?? '']);
    const group = groups.get(key) ?? {
      character: record.modernSurface, modernReading: record.modernReading!, context,
      historicalReadings: new Set<string>(), evidenceRefs: new Set<string>(), readingClasses: new Set<string>()
    };
    group.historicalReadings.add(record.historicalReading!);
    record.evidenceRefs.forEach((ref) => group.evidenceRefs.add(ref));
    readingClassByKey.get(relationKey(record.modernSurface, record.modernReading!, context))?.classes.forEach((value) => group.readingClasses.add(value));
    groups.set(key, group);
  }
  const explicitRelations = [...groups.values()]
    .map((group) => ({
      character: group.character,
      modernReading: group.modernReading,
      context: group.context,
      historicalReadings: [...group.historicalReadings].sort(compareText),
      evidenceRefs: [...group.evidenceRefs].sort(compareText),
      ...(group.readingClasses.size > 0 ? { readingClasses: [...group.readingClasses].sort(compareText) } : {})
    }))
    .sort((a, b) => compareText(a.character, b.character) || compareText(a.modernReading, b.modernReading)
      || compareText(a.context ?? '', b.context ?? ''));
  const componentRelations = [...explicitRelations, ...classIdentityRelations(parsed, readingClass, runtimeSymbols)]
    .sort((a, b) => compareText(a.character, b.character) || compareText(a.modernReading, b.modernReading)
      || compareText(a.context ?? '', b.context ?? ''));

  return {
    schemaVersion: '2',
    kind: 'japanese-orthography-historical-sino-artifact',
    lexicalNamespaceId: identitySlice.lexicalNamespaceId,
    sources: [PHASE46E_SINO_SOURCE_SNAPSHOT, PHASE46E_READING_CLASS_SOURCE_SNAPSHOT],
    identitySlice,
    headingReadings: parsed.headingReadings,
    readingClassEvidence: readingClass.entries,
    componentRelations
  };
}

async function tableText(rootDir: string): Promise<string> {
  return normalizeCheckoutText(
    new TextDecoder('shift_jis').decode(await readFile(resolve(rootDir, PHASE46E_TABLE_PATH)))
  );
}

async function readingClassBytes(rootDir: string): Promise<Uint8Array> {
  return readFile(resolve(rootDir, PHASE46E_READING_CLASS_PATH));
}

function canonicalJson(value: unknown, pretty = false): string {
  return `${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`;
}

export async function buildPhase46eSinoArtifacts(rootDir: string) {
  const parsed = parseSinoTableHtml(await tableText(rootDir), PHASE46E_SINO_SOURCE_SNAPSHOT.sourceId);
  const readingClass = parseSinoReadingClassWorkbook(await readingClassBytes(rootDir), PHASE46E_READING_CLASS_SOURCE_SNAPSHOT.sourceId);
  const bundle = buildPhase46eSinoIntake(parsed);
  const coverageReport = buildPhase46eCoverageReport(bundle, parsed, readingClass);
  const identitySlice = JSON.parse(await readFile(resolve(rootDir, IDENTITY_SLICE_PATH), 'utf8')) as JsonRecord;
  const symbolRegistry = JSON.parse(await readFile(resolve(rootDir, 'data/runtime/symbol-registry.json'), 'utf8')) as JsonRecord;
  // Phase 4.6E identity projection was accepted against the first append-only Symbol Registry
  // generation. Later profile/migration atoms (for example TAR) must not silently expand generic
  // historical-sino authority. Keep the accepted prefix as the projection boundary.
  const projectionGeneration = (symbolRegistry.generations as JsonRecord[] | undefined)
    ?.find((generation) => generation.generation === PHASE46E_SYMBOL_REGISTRY_GENERATION);
  if (!projectionGeneration || !Number.isInteger(projectionGeneration.size)
    || projectionGeneration.size < 1 || projectionGeneration.size > symbolRegistry.atoms.length) {
    throw new Error('Phase 4.6E Symbol Registry projection generation is missing or invalid');
  }
  const runtimeSymbols = new Set((symbolRegistry.atoms as unknown[])
    .slice(0, projectionGeneration.size)
    .filter((atom): atom is string => typeof atom === 'string'));
  const artifact = compileSinoKanaArtifact(bundle, parsed, identitySlice, readingClass, runtimeSymbols);
  return {
    parsed,
    readingClass,
    bundle,
    coverageReport,
    artifact,
    texts: {
      [PHASE46E_INTAKE_PATH]: canonicalJson(bundle),
      [PHASE46E_COVERAGE_REPORT_PATH]: canonicalJson(coverageReport),
      [PHASE46E_ARTIFACT_PATH]: canonicalJson(artifact, true)
    } as Record<string, string>
  };
}

export async function writePhase46eSinoArtifacts(rootDir: string): Promise<void> {
  const { texts } = await buildPhase46eSinoArtifacts(rootDir);
  for (const [relativePath, text] of Object.entries(texts)) {
    const absolutePath = resolve(rootDir, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, text, 'utf8');
  }
}

function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain(import.meta.url)) {
  await writePhase46eSinoArtifacts(resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd()));
}
