import { createHash } from 'node:crypto';
import type { IntakeBundleDocument, IntakeRecord, SourceSnapshot } from './intake-model.ts';

export type NativeKanaProvenance = [sourceIndex: number, sourceLocator: string];
export type NativeKanaExactTuple = [surface: string, target: string, provenance: NativeKanaProvenance[]];
export type NativeKanaCandidateTuple = [surface: string, alternatives: string[], provenance: NativeKanaProvenance[]];

export interface NativeKanaIdentityRelation {
  lexicalIdentity: string;
  surface: string;
  historicalSurface: string;
  requiredMorphology?: Record<string, string>;
  provenance: NativeKanaProvenance[];
}

export interface Phase46dNativeKanaArtifact {
  schemaVersion: '2';
  kind: 'japanese-orthography-historical-native-slice';
  purpose: string;
  lexicalNamespaceId: string;
  sources: SourceSnapshot[];
  identityRelations: NativeKanaIdentityRelation[];
  surfaceRelations: NativeKanaExactTuple[];
  readingRelations: NativeKanaExactTuple[];
  surfaceCandidates: NativeKanaCandidateTuple[];
  readingCandidates: NativeKanaCandidateTuple[];
  artifactContentId: string;
}

export interface CompileNativeKanaOptions {
  legacyAnchorSlice: Record<string, any>;
}

interface Claim {
  target: string;
  sourceRef: string;
  sourceLocator: string;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareText)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = canonicalize(child);
    }
    return output;
  }
  throw new TypeError('Unsupported native kana artifact value: ' + typeof value);
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex');
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function pureKanaSurface(value: string): boolean {
  return /^[\p{Script=Hiragana}\p{Script=Katakana}ー・]+$/u.test(value);
}

function sourceMap(sources: SourceSnapshot[]): Map<string, number> {
  return new Map(sources.map((source, index) => [source.sourceId, index]));
}

function provenance(
  sourceIndex: Map<string, number>,
  refs: Array<{ sourceRef: string; sourceLocator: string }>
): NativeKanaProvenance[] {
  const keyed = new Map<string, NativeKanaProvenance>();
  for (const ref of refs) {
    const index = sourceIndex.get(ref.sourceRef);
    if (index === undefined) throw new Error('Unknown native kana source ref: ' + ref.sourceRef);
    keyed.set(index + ':' + ref.sourceLocator, [index, ref.sourceLocator]);
  }
  return [...keyed.values()].sort((a, b) => a[0] - b[0] || compareText(a[1], b[1]));
}

function addClaim(map: Map<string, Claim[]>, surface: string, target: string, record: IntakeRecord): void {
  if (!surface || !target) return;
  const claims = map.get(surface) ?? [];
  claims.push({ target, sourceRef: record.sourceRef, sourceLocator: record.sourceLocator });
  map.set(surface, claims);
}

function addCandidateClaims(map: Map<string, Claim[]>, record: IntakeRecord): void {
  if (!record.modernSurface || !Array.isArray(record.alternatives)) return;
  for (const target of record.alternatives) addClaim(map, record.modernSurface, target, record);
}

function compileClaims(
  claimsBySurface: Map<string, Claim[]>,
  sourceIndex: Map<string, number>
): { exact: NativeKanaExactTuple[]; candidates: NativeKanaCandidateTuple[] } {
  const exact: NativeKanaExactTuple[] = [];
  const candidates: NativeKanaCandidateTuple[] = [];

  for (const surface of [...claimsBySurface.keys()].sort(compareText)) {
    const claims = claimsBySurface.get(surface) ?? [];
    const targets = sortedUnique(claims.map(claim => claim.target));
    const refs = claims.map(claim => ({ sourceRef: claim.sourceRef, sourceLocator: claim.sourceLocator }));
    const prov = provenance(sourceIndex, refs);
    if (targets.length === 1) exact.push([surface, targets[0]!, prov]);
    else if (targets.length > 1) candidates.push([surface, targets, prov]);
  }

  return { exact, candidates };
}

function compileIdentityRelations(
  intake: IntakeBundleDocument,
  anchor: Record<string, any>,
  sourceIndex: Map<string, number>
): NativeKanaIdentityRelation[] {
  if (anchor?.schemaVersion !== '1' || anchor?.kind !== 'japanese-orthography-historical-native-slice') {
    throw new TypeError('Invalid legacy native anchor slice');
  }
  if (typeof anchor.lexicalNamespaceId !== 'string' || anchor.lexicalNamespaceId === '') {
    throw new TypeError('Legacy native anchor requires lexical namespace');
  }

  const relations: NativeKanaIdentityRelation[] = [];
  for (const relation of Array.isArray(anchor.relations) ? anchor.relations : []) {
    const matches = intake.records.filter(record => (
      record.disposition === 'admitted' &&
      record.responsibility === 'historical_kana_native' &&
      record.modernSurface === relation.surface &&
      record.historicalSurface === relation.historicalSurface
    ));
    if (matches.length === 0) {
      throw new Error('Legacy native anchor lacks Phase 4.6D intake provenance: ' + relation.surface);
    }
    relations.push({
      lexicalIdentity: relation.lexicalIdentity,
      surface: relation.surface,
      historicalSurface: relation.historicalSurface,
      ...(relation.requiredMorphology ? { requiredMorphology: structuredClone(relation.requiredMorphology) } : {}),
      provenance: provenance(sourceIndex, matches.map(record => ({
        sourceRef: record.sourceRef,
        sourceLocator: record.sourceLocator
      })))
    });
  }

  return relations.sort((a, b) => (
    compareText(a.lexicalIdentity, b.lexicalIdentity) ||
    compareText(a.surface, b.surface) ||
    compareText(a.historicalSurface, b.historicalSurface)
  ));
}

export function compileNativeKanaArtifact(
  intake: IntakeBundleDocument,
  options: CompileNativeKanaOptions
): Phase46dNativeKanaArtifact {
  if (intake?.schemaVersion !== '1' || intake?.kind !== 'orthography_intake_bundle') {
    throw new TypeError('Invalid Phase 4.6D intake bundle');
  }

  const sources = [...intake.snapshots]
    .map(source => structuredClone(source))
    .sort((a, b) => compareText(a.sourceId, b.sourceId));
  const sourceIndex = sourceMap(sources);
  const surfaceClaims = new Map<string, Claim[]>();
  const readingClaims = new Map<string, Claim[]>();

  for (const record of intake.records) {
    if (record.responsibility !== 'historical_kana_native') continue;
    if (!sourceIndex.has(record.sourceRef)) throw new Error('Unknown native kana source ref: ' + record.sourceRef);

    if (record.disposition === 'admitted') {
      if (record.modernSurface && record.historicalSurface) {
        addClaim(surfaceClaims, record.modernSurface, record.historicalSurface, record);
      }
      if (record.modernSurface && record.historicalReading) {
        const isGeneralDictionary = record.sourceRef === 'phase46d-committed-native-dictionary';
        const isAnimalPureKana = (
          record.sourceRef === 'phase46d-committed-animal-plant' &&
          pureKanaSurface(record.modernSurface)
        );
        if (isGeneralDictionary || isAnimalPureKana) {
          addClaim(readingClaims, record.modernSurface, record.historicalReading, record);
        }
        if (pureKanaSurface(record.modernSurface)) {
          addClaim(surfaceClaims, record.modernSurface, record.historicalReading, record);
        }
      }
      continue;
    }

    if (record.disposition === 'candidate_ambiguous' && record.modernSurface && record.alternatives) {
      if (record.sourceRef === 'phase46d-kkh-kana-jisyo') {
        addCandidateClaims(surfaceClaims, record);
        continue;
      }
      if (record.sourceRef === 'phase46d-committed-native-dictionary') {
        addCandidateClaims(readingClaims, record);
        if (pureKanaSurface(record.modernSurface)) addCandidateClaims(surfaceClaims, record);
        continue;
      }
      if (
        record.sourceRef === 'phase46d-committed-animal-plant' &&
        pureKanaSurface(record.modernSurface)
      ) {
        addCandidateClaims(readingClaims, record);
        addCandidateClaims(surfaceClaims, record);
      }
    }
  }

  const surfaces = compileClaims(surfaceClaims, sourceIndex);
  const readings = compileClaims(readingClaims, sourceIndex);
  const identityRelations = compileIdentityRelations(intake, options.legacyAnchorSlice, sourceIndex);
  const core = {
    schemaVersion: '2' as const,
    kind: 'japanese-orthography-historical-native-slice' as const,
    purpose: 'Phase 4.6D source-complete compiled native historical-kana authority',
    lexicalNamespaceId: options.legacyAnchorSlice.lexicalNamespaceId as string,
    sources,
    identityRelations,
    surfaceRelations: surfaces.exact,
    readingRelations: readings.exact,
    surfaceCandidates: surfaces.candidates,
    readingCandidates: readings.candidates
  };

  return {
    ...core,
    artifactContentId: sha256(core)
  };
}

export function serializeNativeKanaArtifact(artifact: Phase46dNativeKanaArtifact): string {
  return JSON.stringify(artifact) + '\n';
}
