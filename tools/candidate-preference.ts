import type { ResultBasis } from './normalized-relation-model.ts';
import {
  applyFullSizeSokuonPreference,
  collapsePresentationCandidates
} from './kana-orthography.ts';

type JsonRecord = Record<string, any>;

export interface AuthoritativeSelection {
  result: string;
  basis: ResultBasis;
  ruleRef: string;
  sourceRefs?: string[];
  evidenceRefs?: string[];
}

export interface ExactCrossChannelSelection {
  value: string;
  ruleRef: string;
  sourceRefs?: string[];
  evidenceRefs?: string[];
}

export interface DiachronicPreferenceRule {
  id: string;
  admissibleCandidates: string[];
  preferred: string;
  sourceRefs?: string[];
  evidenceRefs?: string[];
}

export interface RenderingPreference {
  id: string;
  preferFullSizeSokuon?: boolean;
  sameHistoricalRepresentation?: boolean;
}

export interface ManualPriority {
  id: string;
  candidateSet: string[];
  preferred: string;
  rationale: string;
  sourceRefs?: string[];
  evidenceRefs?: string[];
}

export interface CandidateSelectionInput {
  sourceCandidates: string[];
  authoritativeSelection?: AuthoritativeSelection;
  exactCrossChannel?: ExactCrossChannelSelection;
  diachronicRules?: DiachronicPreferenceRule[];
  renderingPreference?: RenderingPreference;
  manualPriority?: ManualPriority;
}

export interface CandidateSelectionResult {
  status: 'selected' | 'candidates';
  selectedResult: string | null;
  basis: ResultBasis;
  sourceCandidates: string[];
  appliedRuleRefs: string[];
  blockedRuleRefs: string[];
  sourceRefs: string[];
  evidenceRefs: string[];
}

export interface NativeResidualCensusEntry extends CandidateSelectionResult {
  surface: string;
  channel: 'surface' | 'reading';
}

export interface NativeResidualCandidateCensus {
  schemaVersion: '1';
  kind: 'phase47e_native_residual_candidate_census';
  entries: NativeResidualCensusEntry[];
  totalEntries: number;
  selectedEntries: number;
  residualEntries: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function sameStringSet(a: Iterable<string>, b: Iterable<string>): boolean {
  const left = canonicalStrings(a);
  const right = canonicalStrings(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function mergeRefs(...collections: Array<Iterable<string> | undefined>): string[] {
  return canonicalStrings(collections.flatMap(values => values ? [...values] : []));
}

function baseResult(sourceCandidates: string[]): CandidateSelectionResult {
  return {
    status: 'candidates',
    selectedResult: null,
    basis: 'unresolved',
    sourceCandidates: canonicalStrings(sourceCandidates),
    appliedRuleRefs: [],
    blockedRuleRefs: [],
    sourceRefs: [],
    evidenceRefs: []
  };
}

function downstreamRuleRefs(input: CandidateSelectionInput): string[] {
  return canonicalStrings([
    ...(input.diachronicRules ?? []).map(rule => rule.id),
    ...(input.renderingPreference ? [input.renderingPreference.id] : []),
    ...(input.manualPriority ? [input.manualPriority.id] : [])
  ]);
}

function crossChannelCompatible(
  value: string,
  sourceCandidates: string[]
): string | null {
  if (sourceCandidates.includes(value)) return value;

  const matching: string[] = [];
  for (const candidate of sourceCandidates) {
    const groups = collapsePresentationCandidates(
      [candidate, value],
      { scriptFoldable: false }
    );
    if (groups.length === 1) matching.push(candidate);
  }
  const unique = canonicalStrings(matching);
  return unique.length === 1 ? unique[0]! : null;
}

function selectResult(
  base: CandidateSelectionResult,
  selectedResult: string,
  basis: ResultBasis,
  appliedRuleRefs: Iterable<string>,
  blockedRuleRefs: Iterable<string>,
  sourceRefs: Iterable<string> = [],
  evidenceRefs: Iterable<string> = []
): CandidateSelectionResult {
  return {
    ...base,
    status: 'selected',
    selectedResult,
    basis,
    appliedRuleRefs: canonicalStrings(appliedRuleRefs),
    blockedRuleRefs: canonicalStrings(blockedRuleRefs),
    sourceRefs: canonicalStrings(sourceRefs),
    evidenceRefs: canonicalStrings(evidenceRefs)
  };
}

export function selectHistoricalCandidate(
  input: CandidateSelectionInput
): CandidateSelectionResult {
  const base = baseResult(input.sourceCandidates);
  if (base.sourceCandidates.length === 0) return base;

  const authoritative = input.authoritativeSelection;
  if (authoritative) {
    if (!base.sourceCandidates.includes(authoritative.result)) {
      return {
        ...base,
        blockedRuleRefs: canonicalStrings([
          authoritative.ruleRef,
          ...downstreamRuleRefs(input)
        ])
      };
    }
    return selectResult(
      base,
      authoritative.result,
      authoritative.basis,
      [authoritative.ruleRef],
      downstreamRuleRefs(input),
      authoritative.sourceRefs,
      authoritative.evidenceRefs
    );
  }

  const cross = input.exactCrossChannel;
  if (cross) {
    const compatible = crossChannelCompatible(cross.value, base.sourceCandidates);
    if (compatible) {
      return selectResult(
        base,
        compatible,
        'cross_channel_selected',
        [cross.ruleRef],
        downstreamRuleRefs(input),
        cross.sourceRefs,
        cross.evidenceRefs
      );
    }
  }

  const diachronic = [...(input.diachronicRules ?? [])]
    .sort((a, b) => compareText(a.id, b.id));
  const applicableDiachronic = diachronic.filter(rule =>
    sameStringSet(rule.admissibleCandidates, base.sourceCandidates) &&
    base.sourceCandidates.includes(rule.preferred)
  );
  if (applicableDiachronic.length > 0) {
    const preferred = canonicalStrings(applicableDiachronic.map(rule => rule.preferred));
    if (preferred.length === 1) {
      return selectResult(
        base,
        preferred[0]!,
        'generated_diachronic',
        applicableDiachronic.map(rule => rule.id),
        [
          ...(input.renderingPreference ? [input.renderingPreference.id] : []),
          ...(input.manualPriority ? [input.manualPriority.id] : [])
        ],
        mergeRefs(...applicableDiachronic.map(rule => rule.sourceRefs)),
        mergeRefs(...applicableDiachronic.map(rule => rule.evidenceRefs))
      );
    }
    return {
      ...base,
      blockedRuleRefs: canonicalStrings([
        ...applicableDiachronic.map(rule => rule.id),
        ...(input.renderingPreference ? [input.renderingPreference.id] : []),
        ...(input.manualPriority ? [input.manualPriority.id] : [])
      ])
    };
  }

  const rendering = input.renderingPreference;
  if (rendering?.preferFullSizeSokuon) {
    if (rendering.sameHistoricalRepresentation) {
      const rendered = canonicalStrings(
        base.sourceCandidates.map(candidate =>
          applyFullSizeSokuonPreference(candidate, {
            sameHistoricalRepresentation: true
          })
        )
      );
      if (rendered.length === 1) {
        return selectResult(
          base,
          rendered[0]!,
          'generated_rendering',
          [rendering.id],
          input.manualPriority ? [input.manualPriority.id] : []
        );
      }
    }
  }

  const manual = input.manualPriority;
  if (
    manual &&
    sameStringSet(manual.candidateSet, base.sourceCandidates) &&
    base.sourceCandidates.includes(manual.preferred)
  ) {
    return selectResult(
      base,
      manual.preferred,
      'manual_preference',
      [manual.id],
      [],
      manual.sourceRefs,
      manual.evidenceRefs
    );
  }

  const blocked: string[] = [];
  if (cross) blocked.push(cross.ruleRef);
  for (const rule of diachronic) {
    if (!applicableDiachronic.includes(rule)) blocked.push(rule.id);
  }
  if (rendering) blocked.push(rendering.id);
  if (manual) blocked.push(manual.id);
  return {
    ...base,
    blockedRuleRefs: canonicalStrings(blocked)
  };
}

function exactSurfaceIndex(artifact: JsonRecord): Map<string, JsonRecord> {
  const map = new Map<string, JsonRecord>();
  for (const relation of artifact.surfaceRelations ?? []) {
    if (typeof relation?.surface === 'string' && typeof relation?.historicalSurface === 'string') {
      map.set(relation.surface, relation);
    }
  }
  return map;
}

function exactReadingIndex(artifact: JsonRecord): Map<string, JsonRecord> {
  const map = new Map<string, JsonRecord>();
  for (const relation of artifact.readingRelations ?? []) {
    if (typeof relation?.surface === 'string' && typeof relation?.historicalReading === 'string') {
      map.set(relation.surface, relation);
    }
  }
  return map;
}

function presentationOnlySelection(
  sourceCandidates: string[]
): CandidateSelectionResult | null {
  const groups = collapsePresentationCandidates(
    canonicalStrings(sourceCandidates),
    { scriptFoldable: false }
  );
  if (groups.length !== 1 || sourceCandidates.length < 2) return null;
  const base = baseResult(sourceCandidates);
  return selectResult(
    base,
    groups[0]!.canonical,
    'generated_rendering',
    ['render:presentation-equivalent'],
    []
  );
}

function censusEntry(
  relation: JsonRecord,
  channel: 'surface' | 'reading',
  surfaceExact: Map<string, JsonRecord>,
  readingExact: Map<string, JsonRecord>
): NativeResidualCensusEntry {
  const surface = String(relation.surface ?? '');
  const sourceCandidates = canonicalStrings(relation.alternatives ?? []);

  const exactOther = channel === 'surface'
    ? readingExact.get(surface)
    : surfaceExact.get(surface);
  const exactValue = channel === 'surface'
    ? exactOther?.historicalReading
    : exactOther?.historicalSurface;

  let result: CandidateSelectionResult | null = null;
  if (typeof exactValue === 'string' && exactValue !== '') {
    result = selectHistoricalCandidate({
      sourceCandidates,
      exactCrossChannel: {
        value: exactValue,
        ruleRef: channel === 'surface' ? 'cross:exact-reading' : 'cross:exact-surface',
        sourceRefs: exactOther?.sourceRefs ?? [],
        evidenceRefs: exactOther?.evidenceRefs ?? []
      }
    });
    if (result.status !== 'selected') result = null;
  }

  if (!result) {
    result = presentationOnlySelection(sourceCandidates) ??
      selectHistoricalCandidate({ sourceCandidates });
  }

  return {
    surface,
    channel,
    ...result,
    sourceRefs: mergeRefs(relation.sourceRefs ?? [], result.sourceRefs),
    evidenceRefs: mergeRefs(relation.evidenceRefs ?? [], result.evidenceRefs)
  };
}

export function buildNativeResidualCandidateCensus(
  artifact: JsonRecord
): NativeResidualCandidateCensus {
  if (
    artifact?.schemaVersion !== '2' ||
    artifact?.kind !== 'japanese-orthography-historical-native-artifact'
  ) {
    throw new TypeError('Phase 4.7E census requires the accepted native artifact');
  }

  const surfaceExact = exactSurfaceIndex(artifact);
  const readingExact = exactReadingIndex(artifact);
  const entries: NativeResidualCensusEntry[] = [];

  for (const relation of artifact.ambiguousSurfaceCandidates ?? []) {
    entries.push(censusEntry(
      relation,
      'surface',
      surfaceExact,
      readingExact
    ));
  }
  for (const relation of artifact.ambiguousReadingCandidates ?? []) {
    entries.push(censusEntry(
      relation,
      'reading',
      surfaceExact,
      readingExact
    ));
  }

  entries.sort((a, b) =>
    compareText(a.surface, b.surface) ||
    compareText(a.channel, b.channel)
  );

  const residualEntries = entries.filter(entry => entry.status === 'candidates').length;
  return {
    schemaVersion: '1',
    kind: 'phase47e_native_residual_candidate_census',
    entries,
    totalEntries: entries.length,
    selectedEntries: entries.length - residualEntries,
    residualEntries
  };
}
