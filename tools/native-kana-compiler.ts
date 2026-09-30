import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  IntakeBundleDocument,
  IntakeRecord,
  SourceSnapshot
} from './intake-model.ts';

type JsonRecord = Record<string, any>;

export interface NativeKanaCompilerOptions {
  identitySlice: JsonRecord;
}

export interface NativeExactSurfaceRelation {
  surface: string;
  historicalSurface: string;
  sourceRefs: string[];
  evidenceRefs: string[];
}

export interface NativeExactReadingRelation {
  surface: string;
  historicalReading: string;
  sourceRefs: string[];
  evidenceRefs: string[];
}

export interface NativeCandidateRelation {
  surface: string;
  alternatives: string[];
  sourceRefs: string[];
  evidenceRefs: string[];
}

export interface NativeKanaArtifact {
  schemaVersion: '2';
  kind: 'japanese-orthography-historical-native-artifact';
  lexicalNamespaceId: string;
  sources: SourceSnapshot[];
  identityRelations: JsonRecord[];
  surfaceRelations: NativeExactSurfaceRelation[];
  readingRelations: NativeExactReadingRelation[];
  ambiguousSurfaceCandidates: NativeCandidateRelation[];
  ambiguousReadingCandidates: NativeCandidateRelation[];
}

interface TargetEvidence {
  sourceRefs: Set<string>;
  evidenceRefs: Set<string>;
}

type ClaimIndex = Map<string, Map<string, TargetEvidence>>;

const NATIVE_DICTIONARY_SOURCE_IDS = new Set([
  'phase46d-native-dictionary',
  'phase46d-animal-plant'
]);

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function cloneCanonical<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => cloneCanonical(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareText)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = cloneCanonical(child);
    }
    return output as T;
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Native kana compiler requires ${label}`);
  }
  return value;
}

function addClaim(
  index: ClaimIndex,
  surface: string,
  target: string,
  record: IntakeRecord
): void {
  if (!surface || !target) return;
  const targets = index.get(surface) ?? new Map<string, TargetEvidence>();
  const evidence = targets.get(target) ?? {
    sourceRefs: new Set<string>(),
    evidenceRefs: new Set<string>()
  };
  evidence.sourceRefs.add(record.sourceRef);
  record.evidenceRefs.forEach(ref => evidence.evidenceRefs.add(ref));
  targets.set(target, evidence);
  index.set(surface, targets);
}

function isKanaSurface(value: string): boolean {
  return /^[\p{Script=Hiragana}\p{Script=Katakana}ーゝゞヽヾ]+$/u.test(value);
}

function relevantNativeRecords(intake: IntakeBundleDocument): IntakeRecord[] {
  return intake.records.filter(record => record.responsibility === 'historical_kana_native');
}

function compileClaimIndex<TExact extends NativeExactSurfaceRelation | NativeExactReadingRelation>(
  index: ClaimIndex,
  exactTargetKey: 'historicalSurface' | 'historicalReading'
): {
  exact: TExact[];
  candidates: NativeCandidateRelation[];
} {
  const exact: TExact[] = [];
  const candidates: NativeCandidateRelation[] = [];

  for (const surface of [...index.keys()].sort(compareText)) {
    const targets = index.get(surface)!;
    const targetNames = [...targets.keys()].sort(compareText);
    const allSourceRefs = new Set<string>();
    const allEvidenceRefs = new Set<string>();
    for (const evidence of targets.values()) {
      evidence.sourceRefs.forEach(ref => allSourceRefs.add(ref));
      evidence.evidenceRefs.forEach(ref => allEvidenceRefs.add(ref));
    }

    if (targetNames.length === 1) {
      const target = targetNames[0]!;
      const evidence = targets.get(target)!;
      exact.push({
        surface,
        [exactTargetKey]: target,
        sourceRefs: canonicalStrings(evidence.sourceRefs),
        evidenceRefs: canonicalStrings(evidence.evidenceRefs)
      } as TExact);
      continue;
    }

    if (targetNames.length > 1) {
      candidates.push({
        surface,
        alternatives: targetNames,
        sourceRefs: canonicalStrings(allSourceRefs),
        evidenceRefs: canonicalStrings(allEvidenceRefs)
      });
    }
  }

  return { exact, candidates };
}

function addAdmittedRecord(
  record: IntakeRecord,
  surfaceClaims: ClaimIndex,
  readingClaims: ClaimIndex
): void {
  const surface = record.modernSurface ?? '';
  if (!surface) return;

  if (record.historicalSurface) {
    addClaim(surfaceClaims, surface, record.historicalSurface, record);
  }

  if (record.historicalReading) {
    addClaim(readingClaims, surface, record.historicalReading, record);
    if (NATIVE_DICTIONARY_SOURCE_IDS.has(record.sourceRef) && isKanaSurface(surface)) {
      addClaim(surfaceClaims, surface, record.historicalReading, record);
    }
  }
}

function addAmbiguousRecord(
  record: IntakeRecord,
  surfaceClaims: ClaimIndex,
  readingClaims: ClaimIndex
): void {
  const surface = record.modernSurface ?? '';
  const alternatives = record.alternatives ?? [];
  if (!surface || alternatives.length === 0) return;

  if (record.sourceRef === 'phase46d-kkh-kana') {
    alternatives.forEach(target => addClaim(surfaceClaims, surface, target, record));
    return;
  }

  if (NATIVE_DICTIONARY_SOURCE_IDS.has(record.sourceRef)) {
    alternatives.forEach(target => addClaim(readingClaims, surface, target, record));
    if (isKanaSurface(surface)) {
      alternatives.forEach(target => addClaim(surfaceClaims, surface, target, record));
    }
  }
}

function canonicalSources(snapshots: SourceSnapshot[]): SourceSnapshot[] {
  return [...snapshots]
    .sort((a, b) => compareText(a.sourceId, b.sourceId))
    .map(snapshot => cloneCanonical(snapshot));
}

function canonicalIdentityRelations(identitySlice: JsonRecord): JsonRecord[] {
  const relations = Array.isArray(identitySlice?.relations) ? identitySlice.relations : [];
  return relations
    .map((relation: JsonRecord) => cloneCanonical(relation))
    .sort((a: JsonRecord, b: JsonRecord) => (
      compareText(`${a.lexicalIdentity ?? ''}`, `${b.lexicalIdentity ?? ''}`) ||
      compareText(`${a.surface ?? ''}`, `${b.surface ?? ''}`) ||
      compareText(`${a.historicalSurface ?? ''}`, `${b.historicalSurface ?? ''}`)
    ));
}

export function compileNativeKanaArtifact(
  intake: IntakeBundleDocument,
  options: NativeKanaCompilerOptions
): NativeKanaArtifact {
  if (intake?.schemaVersion !== '1' || intake?.kind !== 'orthography_intake_bundle') {
    throw new TypeError('Native kana compiler requires orthography intake bundle v1');
  }
  const identitySlice = options?.identitySlice;
  if (
    identitySlice?.schemaVersion !== '1' ||
    identitySlice?.kind !== 'japanese-orthography-historical-native-slice'
  ) {
    throw new TypeError('Native kana compiler requires the accepted identity slice');
  }

  const lexicalNamespaceId = requireString(
    identitySlice.lexicalNamespaceId,
    'identity slice lexical namespace'
  );
  const surfaceClaims: ClaimIndex = new Map();
  const readingClaims: ClaimIndex = new Map();

  for (const record of relevantNativeRecords(intake)) {
    if (record.disposition === 'admitted') {
      addAdmittedRecord(record, surfaceClaims, readingClaims);
    } else if (record.disposition === 'candidate_ambiguous') {
      addAmbiguousRecord(record, surfaceClaims, readingClaims);
    }
  }

  const surfaces = compileClaimIndex<NativeExactSurfaceRelation>(
    surfaceClaims,
    'historicalSurface'
  );
  const readings = compileClaimIndex<NativeExactReadingRelation>(
    readingClaims,
    'historicalReading'
  );

  return {
    schemaVersion: '2',
    kind: 'japanese-orthography-historical-native-artifact',
    lexicalNamespaceId,
    sources: canonicalSources(intake.snapshots),
    identityRelations: canonicalIdentityRelations(identitySlice),
    surfaceRelations: surfaces.exact,
    readingRelations: readings.exact,
    ambiguousSurfaceCandidates: surfaces.candidates,
    ambiguousReadingCandidates: readings.candidates
  };
}

export async function writeCanonicalNativeKanaArtifact(rootDir: string): Promise<void> {
  const [intakeText, identitySliceText] = await Promise.all([
    readFile(resolve(rootDir, 'data/intake/phase46d-native-kana.json'), 'utf8'),
    readFile(resolve(rootDir, 'data/historical/native/kkh-kana-first-slice.json'), 'utf8')
  ]);
  const intake = JSON.parse(intakeText) as IntakeBundleDocument;
  const identitySlice = JSON.parse(identitySliceText) as JsonRecord;
  const artifact = compileNativeKanaArtifact(intake, { identitySlice });
  const outputPath = resolve(rootDir, 'data/historical/native/phase46d-native-kana.json');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain(import.meta.url)) {
  await writeCanonicalNativeKanaArtifact(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
}
