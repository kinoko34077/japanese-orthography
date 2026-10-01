import { createRequire } from 'node:module';
import type {
  ApplicabilityPolicy,
  ApplicationMode,
  NormalizedOrthographyRelation,
  RelationChannel,
  ResultBasis
} from './normalized-relation-model.ts';

type JsonRecord = Record<string, any>;

// Shared with the browser/worker runtime so both resolvers arbitrate identically (4.8E).
const { arbitrate } = createRequire(import.meta.url)('../runtime/occurrence-arbitration.js') as {
  arbitrate: (input: {
    length: number;
    candidates: OccurrenceCandidate[];
    lexical?: LexicalOccurrenceContext | null;
  }) => {
    accepted: OccurrenceCandidate[];
    blocked: { candidate: OccurrenceCandidate; reason: BlockedProductiveRule['reason'] }[];
    unresolved: { start: number; end: number; reasons: string[] }[];
  };
};


/** Lexical occurrence evidence: boundaries/units of each best analysis path (see lexicalOccurrenceContext). */
export type { ApplicabilityPolicy };

export interface LexicalOccurrenceUnit { start: number; end: number; lexemes: string[]; morphology: Record<string, unknown>[] | null }
export interface LexicalOccurrenceEdge { start: number; end: number; internal: number[]; units: LexicalOccurrenceUnit[] }
export type LexicalOccurrenceContext =
  | { dag: { length: number; edges: LexicalOccurrenceEdge[] } }
  | { paths: { boundaries: number[]; units: [number, number][]; lexemes?: Record<string, string[]>; morphology?: Record<string, Record<string, unknown>[]> }[] };

interface OccurrenceCandidate {
  key: string;
  start: number;
  end: number;
  output: string;
  policy: ApplicabilityPolicy;
  lexicalIdentity?: string;
  requiredMorphology?: Record<string, string>;
  match: Match;
}

export interface ProductiveSegment {
  start: number;
  end: number;
  input: string;
  output: string;
  basis: ResultBasis;
  relationIds: string[];
  sourceRefs?: string[];
  evidenceRefs?: string[];
}

export interface AppliedProductiveRule {
  relationId: string;
  applicationMode: ApplicationMode;
  start: number;
  end: number;
  input: string;
  output: string;
  basis: 'generated_productive_span' | 'generated_character' | 'preserve_exact';
  relationBasis: ResultBasis;
  sourceRefs: string[];
  evidenceRefs: string[];
}

export interface BlockedProductiveRule {
  relationId: string;
  start: number;
  end: number;
  input: string;
  reason:
    | 'unsupported_productive_channel'
    | 'non_productive_application_mode'
    | 'non_deterministic_productive_relation'
    | 'invalid_character_productive_relation'
    | 'overlaps_preserve_block'
    | 'conflicting_productive_outputs'
    | 'shadowed_by_longer_match'
    | 'crosses_lexical_boundary'
    | 'ambiguous_lexical_boundary'
    | 'lexical_identity_mismatch'
    | 'lexical_analysis_unavailable'
    | 'ambiguous_lexical_identity'
    | 'ambiguous_morphology'
    | 'morphology_mismatch'
    | 'morphology_unavailable'
    | 'morphology_unsupported'
    | 'outranked_by_overlap'
    | 'equivalent_overlap'
    | 'unresolved_shifted_overlap';
}

export interface ProductiveResolution {
  input: string;
  output: string;
  segments: ProductiveSegment[];
  appliedRules: AppliedProductiveRule[];
  blockedRules: BlockedProductiveRule[];
}

export interface ProductiveResolutionOptions {
  allowedChannels?: RelationChannel[];
  /** When present, substring_productive relations default to the lexical_boundary policy. */
  lexical?: LexicalOccurrenceContext;
}

interface Match {
  relation: NormalizedOrthographyRelation;
  from: string;
  fromChars: string[];
  start: number;
  end: number;
  output: string | null;
  kind: 'productive' | 'preserve' | 'blocked';
  blockedReason?: BlockedProductiveRule['reason'];
}

interface PreserveInterval {
  start: number;
  end: number;
  matches: Match[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function codePoints(value: string): string[] {
  return Array.from(value);
}

function sliceText(chars: string[], start: number, end: number): string {
  return chars.slice(start, end).join('');
}

function matchesAt(input: string[], needle: string[], start: number): boolean {
  if (needle.length === 0 || start + needle.length > input.length) return false;
  for (let offset = 0; offset < needle.length; offset += 1) {
    if (input[start + offset] !== needle[offset]) return false;
  }
  return true;
}

function allStarts(input: string[], needle: string[]): number[] {
  const starts: number[] = [];
  for (let start = 0; start <= input.length - needle.length; start += 1) {
    if (matchesAt(input, needle, start)) starts.push(start);
  }
  return starts;
}

function productiveBasis(mode: ApplicationMode): 'generated_productive_span' | 'generated_character' {
  return mode === 'character_productive'
    ? 'generated_character'
    : 'generated_productive_span';
}

function matchSort(a: Match, b: Match): number {
  return (
    a.start - b.start ||
    b.end - a.end ||
    compareText(a.relation.id, b.relation.id) ||
    compareText(a.from, b.from) ||
    compareText(a.output ?? '', b.output ?? '')
  );
}

function blockedSort(a: BlockedProductiveRule, b: BlockedProductiveRule): number {
  return (
    a.start - b.start ||
    a.end - b.end ||
    compareText(a.relationId, b.relationId) ||
    compareText(a.reason, b.reason)
  );
}

function appliedSort(a: AppliedProductiveRule, b: AppliedProductiveRule): number {
  return (
    a.start - b.start ||
    a.end - b.end ||
    compareText(a.relationId, b.relationId)
  );
}

function relationMatches(
  inputChars: string[],
  relation: NormalizedOrthographyRelation,
  allowedChannels: Set<RelationChannel>
): Match[] {
  const fromForms = canonicalStrings(relation.fromForms ?? []);
  const toForms = canonicalStrings(relation.toForms ?? []);
  const matches: Match[] = [];

  for (const from of fromForms) {
    const fromChars = codePoints(from);
    if (fromChars.length === 0) continue;

    let kind: Match['kind'] = 'blocked';
    let output: string | null = null;
    let blockedReason: BlockedProductiveRule['reason'] | undefined;

    if (!allowedChannels.has(relation.channel)) {
      blockedReason = 'unsupported_productive_channel';
    } else if (relation.applicationMode === 'preserve_block' && relation.relationKind === 'preserve') {
      kind = 'preserve';
      output = from;
    } else if (
      relation.applicationMode === 'substring_productive' ||
      relation.applicationMode === 'character_productive'
    ) {
      if (relation.relationKind !== 'mapping' || toForms.length !== 1) {
        blockedReason = 'non_deterministic_productive_relation';
      } else if (
        relation.applicationMode === 'character_productive' &&
        (fromChars.length !== 1 || codePoints(toForms[0]!).length !== 1)
      ) {
        blockedReason = 'invalid_character_productive_relation';
      } else {
        kind = 'productive';
        output = toForms[0]!;
      }
    } else {
      blockedReason = 'non_productive_application_mode';
    }

    for (const start of allStarts(inputChars, fromChars)) {
      matches.push({
        relation,
        from,
        fromChars,
        start,
        end: start + fromChars.length,
        output,
        kind,
        ...(blockedReason ? { blockedReason } : {})
      });
    }
  }

  return matches;
}

function mergePreserveIntervals(matches: Match[]): PreserveInterval[] {
  const preserve = matches
    .filter(match => match.kind === 'preserve')
    .sort(matchSort);

  const intervals: PreserveInterval[] = [];
  for (const match of preserve) {
    const previous = intervals.at(-1);
    if (!previous || match.start >= previous.end) {
      intervals.push({
        start: match.start,
        end: match.end,
        matches: [match]
      });
      continue;
    }

    previous.end = Math.max(previous.end, match.end);
    previous.matches.push(match);
  }

  for (const interval of intervals) {
    interval.matches.sort(matchSort);
  }
  return intervals;
}

function overlappingPreserve(
  start: number,
  end: number,
  intervals: PreserveInterval[]
): PreserveInterval | null {
  return intervals.find(interval => start < interval.end && end > interval.start) ?? null;
}

function exactPreserveStart(
  index: number,
  intervals: PreserveInterval[]
): PreserveInterval | null {
  return intervals.find(interval => interval.start === index) ?? null;
}

function refsForRelations(relations: NormalizedOrthographyRelation[]): {
  sourceRefs: string[];
  evidenceRefs: string[];
} {
  return {
    sourceRefs: canonicalStrings(relations.flatMap(relation => relation.sourceRefs ?? [])),
    evidenceRefs: canonicalStrings(relations.flatMap(relation => relation.evidenceRefs ?? []))
  };
}

function makeSegment(
  chars: string[],
  start: number,
  end: number,
  output: string,
  basis: ResultBasis,
  relations: NormalizedOrthographyRelation[]
): ProductiveSegment {
  const refs = refsForRelations(relations);
  const segment: ProductiveSegment = {
    start,
    end,
    input: sliceText(chars, start, end),
    output,
    basis,
    relationIds: canonicalStrings(relations.map(relation => relation.id))
  };
  if (refs.sourceRefs.length > 0) segment.sourceRefs = refs.sourceRefs;
  if (refs.evidenceRefs.length > 0) segment.evidenceRefs = refs.evidenceRefs;
  return segment;
}

function pushSegment(segments: ProductiveSegment[], next: ProductiveSegment): void {
  const previous = segments.at(-1);
  if (
    previous &&
    previous.end === next.start &&
    previous.basis === 'unresolved' &&
    next.basis === 'unresolved' &&
    previous.relationIds.length === 0 &&
    next.relationIds.length === 0
  ) {
    previous.end = next.end;
    previous.input += next.input;
    previous.output += next.output;
    return;
  }
  segments.push(next);
}

function appliedTrace(match: Match): AppliedProductiveRule {
  const mode = match.relation.applicationMode;
  const basis = mode === 'preserve_block'
    ? 'preserve_exact'
    : productiveBasis(mode);
  return {
    relationId: match.relation.id,
    applicationMode: mode,
    start: match.start,
    end: match.end,
    input: match.from,
    output: match.output ?? match.from,
    basis,
    relationBasis: match.relation.basis,
    sourceRefs: canonicalStrings(match.relation.sourceRefs ?? []),
    evidenceRefs: canonicalStrings(match.relation.evidenceRefs ?? [])
  };
}

function blockedTrace(
  match: Match,
  reason: BlockedProductiveRule['reason']
): BlockedProductiveRule {
  return {
    relationId: match.relation.id,
    start: match.start,
    end: match.end,
    input: match.from,
    reason
  };
}

export function resolveProductiveOrthography(
  input: string,
  relations: NormalizedOrthographyRelation[] = [],
  options: ProductiveResolutionOptions = {}
): ProductiveResolution {
  const chars = codePoints(input);
  const allowedChannels = new Set<RelationChannel>(
    options.allowedChannels ?? ['surface', 'character_form']
  );
  const canonicalRelations = [...relations].sort((a, b) => compareText(a.id, b.id));
  const matches = canonicalRelations
    .flatMap(relation => relationMatches(chars, relation, allowedChannels))
    .sort(matchSort);

  const preserveIntervals = mergePreserveIntervals(matches);
  const productiveMatches = matches.filter(match => match.kind === 'productive');
  const blockedRules: BlockedProductiveRule[] = matches
    .filter(match => match.kind === 'blocked')
    .map(match => blockedTrace(match, match.blockedReason!));
  const appliedRules: AppliedProductiveRule[] = [];

  const availableProductive: Match[] = [];
  for (const match of productiveMatches) {
    if (overlappingPreserve(match.start, match.end, preserveIntervals)) {
      blockedRules.push(blockedTrace(match, 'overlaps_preserve_block'));
    } else {
      availableProductive.push(match);
    }
  }

  for (const interval of preserveIntervals) {
    for (const match of interval.matches) {
      appliedRules.push(appliedTrace(match));
    }
  }

  const arbitration = arbitrate({
    length: chars.length,
    lexical: options.lexical ?? null,
    candidates: availableProductive.map((match) => {
      const relation = match.relation;
      const policy: ApplicabilityPolicy = relation.applicability
        ?? (options.lexical && relation.applicationMode === 'substring_productive' ? 'lexical_boundary' : 'anywhere');
      return {
        key: `${relation.id} ${match.start} ${match.from}`,
        start: match.start,
        end: match.end,
        output: match.output!,
        policy,
        // identity/morphology constraints always travel with the occurrence (fail closed without evidence)
        ...(relation.lexicalIdentity ? { lexicalIdentity: relation.lexicalIdentity } : {}),
        ...(relation.requiredMorphology ? { requiredMorphology: relation.requiredMorphology } : {}),
        match
      };
    })
  });
  for (const { candidate, reason } of arbitration.blocked) blockedRules.push(blockedTrace(candidate.match, reason));
  const acceptedAt = new Map<number, Match[]>();
  for (const candidate of arbitration.accepted) {
    const list = acceptedAt.get(candidate.start) ?? [];
    list.push(candidate.match);
    acceptedAt.set(candidate.start, list);
  }
  const unresolvedAt = new Map(arbitration.unresolved.map((region) => [region.start, region]));

  const segments: ProductiveSegment[] = [];
  let index = 0;

  while (index < chars.length) {
    const preserve = exactPreserveStart(index, preserveIntervals);
    if (preserve) {
      const relationsForSpan = canonicalRelations.filter(relation =>
        preserve.matches.some(match => match.relation.id === relation.id)
      );
      pushSegment(
        segments,
        makeSegment(
          chars,
          preserve.start,
          preserve.end,
          sliceText(chars, preserve.start, preserve.end),
          'preserve_exact',
          relationsForSpan
        )
      );
      index = preserve.end;
      continue;
    }

    const region = unresolvedAt.get(index);
    if (region) {
      pushSegment(segments, makeSegment(chars, region.start, region.end, sliceText(chars, region.start, region.end), 'unresolved', []));
      index = region.end;
      continue;
    }

    const winners = acceptedAt.get(index) ?? [];
    if (winners.length === 0) {
      pushSegment(
        segments,
        makeSegment(chars, index, index + 1, chars[index]!, 'unresolved', [])
      );
      index += 1;
      continue;
    }

    const end = winners[0]!.end;
    const basis = winners.every(match => match.relation.applicationMode === 'character_productive')
      ? 'generated_character'
      : 'generated_productive_span';
    pushSegment(
      segments,
      makeSegment(chars, index, end, winners[0]!.output!, basis, winners.map(match => match.relation))
    );
    for (const match of winners) {
      appliedRules.push(appliedTrace(match));
    }
    index = end;
  }

  appliedRules.sort(appliedSort);
  blockedRules.sort(blockedSort);

  return {
    input,
    output: segments.map(segment => segment.output).join(''),
    segments,
    appliedRules,
    blockedRules
  };
}

export function projectSafeCharacterSlice(
  slice: JsonRecord
): NormalizedOrthographyRelation[] {
  if (
    slice?.schemaVersion !== '1' ||
    slice?.kind !== 'japanese-orthography-safe-character-slice'
  ) {
    throw new TypeError('Unsupported safe-character slice');
  }

  const evidenceSource = new Map<string, string>();
  for (const evidence of Array.isArray(slice.evidenceRecords) ? slice.evidenceRecords : []) {
    if (typeof evidence?.id === 'string' && typeof evidence?.sourceRef === 'string') {
      evidenceSource.set(evidence.id, evidence.sourceRef);
    }
  }

  const relations: NormalizedOrthographyRelation[] = [];
  for (const mapping of Array.isArray(slice.mappings) ? slice.mappings : []) {
    if (
      mapping?.responsibility !== 'character_form' ||
      mapping?.admission !== 'unconditional' ||
      typeof mapping?.modern !== 'string' ||
      typeof mapping?.historical !== 'string' ||
      typeof mapping?.intakeRecordRef !== 'string'
    ) {
      throw new TypeError('Invalid unconditional safe-character mapping');
    }
    if (codePoints(mapping.modern).length !== 1 || codePoints(mapping.historical).length !== 1) {
      throw new TypeError('Safe-character productive mapping must be one code point');
    }

    const evidenceRefs = canonicalStrings(mapping.evidenceRefs ?? []);
    const sourceRefs = canonicalStrings(
      evidenceRefs.map(ref => evidenceSource.get(ref)).filter((ref): ref is string => Boolean(ref))
    );

    relations.push({
      id: `safe-character:${mapping.intakeRecordRef}`,
      relationKind: 'mapping',
      channel: 'character_form',
      applicationMode: 'character_productive',
      fromForms: [mapping.modern],
      toForms: [mapping.historical],
      basis: 'source_exact',
      sourceRefs,
      evidenceRefs
    });
  }

  return relations.sort((a, b) => compareText(a.id, b.id));
}
