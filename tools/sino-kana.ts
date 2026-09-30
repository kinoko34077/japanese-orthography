import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';
import { buildCoverageSummary, canonicalizeAlternatives, type CoverageSummary } from './intake-accounting.ts';
import type { IntakeBundleDocument, IntakeRecord, SourceSnapshot } from './intake-model.ts';
import { parseSinoTableHtml, type SinoTableParseResult, type SinoTableRecord } from './sino-table-parser.ts';

export const PHASE46E_TABLE_PATH = '仮名遣等資料/字音仮名遣い表.html';
export const PHASE46E_INTAKE_PATH = 'data/intake/phase46e-sino-kana.json';
export const PHASE46E_COVERAGE_REPORT_PATH = 'data/reports/phase46e-sino-kana-coverage.json';
export const PHASE46E_ARTIFACT_PATH = 'data/historical/sino/phase46e-sino-kana.json';
const IDENTITY_SLICE_PATH = 'data/historical/sino/kkh-jion-first-slice.json';

export const PHASE46E_SINO_SOURCE_SNAPSHOT: SourceSnapshot = {
  sourceId: 'phase46e-sino-table',
  sourceClass: 'committed-reference',
  repository: 'kinoko34077/japanese-orthography',
  commit: '1af5f2dfb8825a19ec1e51cd36650a596ac61f44',
  path: PHASE46E_TABLE_PATH,
  blobSha: '89dd7a10ed9fd5ef12ea33b227bb513c2847818a',
  coverageRole: 'coverage-contract'
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
    snapshots: [PHASE46E_SINO_SOURCE_SNAPSHOT],
    records
  };
}

export function buildPhase46eCoverageReport(bundle: IntakeBundleDocument, parsed: SinoTableParseResult) {
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
    }]
  };
}

export function compileSinoKanaArtifact(bundle: IntakeBundleDocument, parsed: SinoTableParseResult, identitySlice: JsonRecord) {
  const groups = new Map<string, { character: string; modernReading: string; context: string | null; historicalReadings: Set<string>; evidenceRefs: Set<string> }>();
  for (const record of bundle.records) {
    if (record.disposition === 'excluded_unresolved' || !record.modernSurface) continue;
    const context = record.morphology?.usage ?? null;
    const key = JSON.stringify([record.modernSurface, record.modernReading, context ?? '']);
    const group = groups.get(key) ?? {
      character: record.modernSurface, modernReading: record.modernReading!, context,
      historicalReadings: new Set<string>(), evidenceRefs: new Set<string>()
    };
    group.historicalReadings.add(record.historicalReading!);
    record.evidenceRefs.forEach((ref) => group.evidenceRefs.add(ref));
    groups.set(key, group);
  }
  const componentRelations = [...groups.values()]
    .map((group) => ({
      character: group.character,
      modernReading: group.modernReading,
      context: group.context,
      historicalReadings: [...group.historicalReadings].sort(compareText),
      evidenceRefs: [...group.evidenceRefs].sort(compareText)
    }))
    .sort((a, b) => compareText(a.character, b.character) || compareText(a.modernReading, b.modernReading)
      || compareText(a.context ?? '', b.context ?? ''));

  return {
    schemaVersion: '2',
    kind: 'japanese-orthography-historical-sino-artifact',
    lexicalNamespaceId: identitySlice.lexicalNamespaceId,
    sources: [PHASE46E_SINO_SOURCE_SNAPSHOT],
    identitySlice,
    headingReadings: parsed.headingReadings,
    componentRelations
  };
}

async function tableText(rootDir: string): Promise<string> {
  return new TextDecoder('shift_jis').decode(await readFile(resolve(rootDir, PHASE46E_TABLE_PATH)));
}

function canonicalJson(value: unknown, pretty = false): string {
  return `${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`;
}

export async function buildPhase46eSinoArtifacts(rootDir: string) {
  const parsed = parseSinoTableHtml(await tableText(rootDir), PHASE46E_SINO_SOURCE_SNAPSHOT.sourceId);
  const bundle = buildPhase46eSinoIntake(parsed);
  const coverageReport = buildPhase46eCoverageReport(bundle, parsed);
  const identitySlice = JSON.parse(await readFile(resolve(rootDir, IDENTITY_SLICE_PATH), 'utf8')) as JsonRecord;
  const artifact = compileSinoKanaArtifact(bundle, parsed, identitySlice);
  return {
    parsed,
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
