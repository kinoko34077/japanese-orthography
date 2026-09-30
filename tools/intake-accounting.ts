import type { IntakeRecord, SourceSnapshot } from './intake-model.ts';
import type { Diagnostic } from './model.ts';

export interface ParserRemainder {
  sourceRecordId: string;
  kind: 'mapping' | 'other';
  detail?: string;
}

export interface CoverageAccountingInput {
  snapshot: SourceSnapshot;
  discoveredRecordIds: string[];
  records: IntakeRecord[];
  remainders: ParserRemainder[];
}

export interface CoverageSummary {
  sourceId: string;
  discovered: number;
  admitted: number;
  ambiguous: number;
  excluded: number;
  unclassified: number;
  unexpected: number;
  unparsedMappingRecords: number;
  discoveredRecordIds: string[];
  admittedRecordIds: string[];
  ambiguousRecordIds: string[];
  excludedRecordIds: string[];
  unclassifiedRecordIds: string[];
  unexpectedRecordIds: string[];
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function canonicalizeAlternatives(alternatives: string[]): string[] {
  return sortedUnique(alternatives);
}

function recordsForSource(input: CoverageAccountingInput): IntakeRecord[] {
  return input.records.filter(record => record.sourceRef === input.snapshot.sourceId);
}

export function buildCoverageSummary(input: CoverageAccountingInput): CoverageSummary {
  const discoveredRecordIds = sortedUnique(input.discoveredRecordIds);
  const discovered = new Set(discoveredRecordIds);
  const sourceRecords = recordsForSource(input);

  const admittedRecordIds = sortedUnique(
    sourceRecords.filter(record => record.disposition === 'admitted').map(record => record.sourceLocator)
  );
  const ambiguousRecordIds = sortedUnique(
    sourceRecords.filter(record => record.disposition === 'candidate_ambiguous').map(record => record.sourceLocator)
  );
  const excludedRecordIds = sortedUnique(
    sourceRecords.filter(record => record.disposition === 'excluded_unresolved').map(record => record.sourceLocator)
  );
  const classified = new Set([
    ...admittedRecordIds,
    ...ambiguousRecordIds,
    ...excludedRecordIds
  ]);
  const unclassifiedRecordIds = discoveredRecordIds.filter(recordId => !classified.has(recordId));
  const unexpectedRecordIds = sortedUnique([...classified].filter(recordId => !discovered.has(recordId)));

  return {
    sourceId: input.snapshot.sourceId,
    discovered: discoveredRecordIds.length,
    admitted: admittedRecordIds.length,
    ambiguous: ambiguousRecordIds.length,
    excluded: excludedRecordIds.length,
    unclassified: unclassifiedRecordIds.length,
    unexpected: unexpectedRecordIds.length,
    unparsedMappingRecords: input.remainders.filter(remainder => remainder.kind === 'mapping').length,
    discoveredRecordIds,
    admittedRecordIds,
    ambiguousRecordIds,
    excludedRecordIds,
    unclassifiedRecordIds,
    unexpectedRecordIds
  };
}

function coverageDiagnostic(code: string, snapshot: SourceSnapshot, message: string): Diagnostic {
  return {
    severity: 'ERROR',
    code,
    path: `/sources/${snapshot.sourceId}`,
    message
  };
}

export function validateCoverageAccounting(input: CoverageAccountingInput): Diagnostic[] {
  if (input.snapshot.coverageRole !== 'coverage-contract') return [];

  const summary = buildCoverageSummary(input);
  const diagnostics: Diagnostic[] = [];

  if (summary.unclassifiedRecordIds.length > 0) {
    diagnostics.push(coverageDiagnostic(
      'E_COVERAGE_UNCLASSIFIED',
      input.snapshot,
      `Discovered source records lack a disposition: ${summary.unclassifiedRecordIds.join(', ')}`
    ));
  }

  if (summary.unexpectedRecordIds.length > 0) {
    diagnostics.push(coverageDiagnostic(
      'E_COVERAGE_UNEXPECTED_RECORD',
      input.snapshot,
      `Intake classifies source records that were not discovered: ${summary.unexpectedRecordIds.join(', ')}`
    ));
  }

  const dispositionByLocator = new Map<string, Set<IntakeRecord['disposition']>>();
  for (const record of recordsForSource(input)) {
    const dispositions = dispositionByLocator.get(record.sourceLocator) ?? new Set<IntakeRecord['disposition']>();
    dispositions.add(record.disposition);
    dispositionByLocator.set(record.sourceLocator, dispositions);
  }
  const conflicts = sortedUnique(
    [...dispositionByLocator.entries()]
      .filter(([, dispositions]) => dispositions.size > 1)
      .map(([locator]) => locator)
  );
  if (conflicts.length > 0) {
    diagnostics.push(coverageDiagnostic(
      'E_COVERAGE_MULTIPLE_DISPOSITIONS',
      input.snapshot,
      `Source records have conflicting dispositions: ${conflicts.join(', ')}`
    ));
  }

  const unparsedMappings = input.remainders.filter(remainder => remainder.kind === 'mapping');
  if (unparsedMappings.length > 0) {
    diagnostics.push(coverageDiagnostic(
      'E_COVERAGE_UNPARSED_MAPPING',
      input.snapshot,
      `Transformation-like source records remain unparsed: ${sortedUnique(unparsedMappings.map(item => item.sourceRecordId)).join(', ')}`
    ));
  }

  if (
    summary.unclassified === 0 &&
    summary.unexpected === 0 &&
    conflicts.length === 0 &&
    summary.discovered !== summary.admitted + summary.ambiguous + summary.excluded
  ) {
    diagnostics.push(coverageDiagnostic(
      'E_COVERAGE_PARTITION_MISMATCH',
      input.snapshot,
      `Coverage partition mismatch: discovered=${summary.discovered}, admitted=${summary.admitted}, ambiguous=${summary.ambiguous}, excluded=${summary.excluded}`
    ));
  }

  return diagnostics;
}
