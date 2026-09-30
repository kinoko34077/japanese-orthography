import type { Diagnostic } from './model.ts';
import type { IntakeRecord, SourceSnapshot } from './intake-model.ts';

export interface ParserRemainder {
  id: string;
  transformationLike: boolean;
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
  unparsed: number;
  unclassified: number;
  discoveredRecordIds: string[];
  classifiedRecordIds: string[];
  missingRecordIds: string[];
  unexpectedRecordIds: string[];
  unparsedRecordIds: string[];
}

function sortUnique(values: string[], locale = 'en'): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, locale));
}

export function canonicalizeAlternatives(values: string[]): string[] {
  return sortUnique(values, 'ja');
}

export function buildCoverageSummary(input: CoverageAccountingInput): CoverageSummary {
  const discoveredRecordIds = sortUnique(input.discoveredRecordIds);
  const discoveredSet = new Set(discoveredRecordIds);
  const sourceRecords = input.records.filter((record) => record.sourceRef === input.snapshot.sourceId);
  const classifiedRecordIds = sortUnique(sourceRecords.map((record) => record.id));
  const classifiedSet = new Set(classifiedRecordIds);
  const missingRecordIds = discoveredRecordIds.filter((id) => !classifiedSet.has(id));
  const unexpectedRecordIds = classifiedRecordIds.filter((id) => !discoveredSet.has(id));
  const unparsedRecordIds = sortUnique(
    input.remainders.filter((remainder) => remainder.transformationLike).map((remainder) => remainder.id)
  );

  return {
    sourceId: input.snapshot.sourceId,
    discovered: discoveredRecordIds.length,
    admitted: sourceRecords.filter((record) => record.disposition === 'admitted').length,
    ambiguous: sourceRecords.filter((record) => record.disposition === 'candidate_ambiguous').length,
    excluded: sourceRecords.filter((record) => record.disposition === 'excluded_unresolved').length,
    unparsed: unparsedRecordIds.length,
    unclassified: missingRecordIds.length,
    discoveredRecordIds,
    classifiedRecordIds,
    missingRecordIds,
    unexpectedRecordIds,
    unparsedRecordIds
  };
}

function diagnostic(code: string, sourceId: string, message: string): Diagnostic {
  return {
    severity: 'ERROR',
    code,
    path: `/coverage/${sourceId}`,
    message
  };
}

export function validateCoverageAccounting(input: CoverageAccountingInput): Diagnostic[] {
  if (input.snapshot.coverageRole !== 'coverage-contract') return [];

  const summary = buildCoverageSummary(input);
  const diagnostics: Diagnostic[] = [];

  if (summary.missingRecordIds.length > 0) {
    diagnostics.push(diagnostic(
      'E_COVERAGE_UNCLASSIFIED',
      summary.sourceId,
      `Discovered records are not classified: ${summary.missingRecordIds.join(', ')}`
    ));
  }

  if (summary.unexpectedRecordIds.length > 0) {
    diagnostics.push(diagnostic(
      'E_COVERAGE_UNEXPECTED_CLASSIFICATION',
      summary.sourceId,
      `Classified records were not discovered: ${summary.unexpectedRecordIds.join(', ')}`
    ));
  }

  if (summary.unparsedRecordIds.length > 0) {
    diagnostics.push(diagnostic(
      'E_COVERAGE_UNPARSED',
      summary.sourceId,
      `Transformation-like parser remainder remains: ${summary.unparsedRecordIds.join(', ')}`
    ));
  }

  const dispositionTotal = summary.admitted + summary.ambiguous + summary.excluded;
  if (summary.discovered !== dispositionTotal) {
    diagnostics.push(diagnostic(
      'E_COVERAGE_PARTITION',
      summary.sourceId,
      `Coverage partition mismatch: discovered=${summary.discovered}, classified=${dispositionTotal}`
    ));
  }

  return diagnostics;
}
