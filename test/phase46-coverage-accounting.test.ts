import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCoverageSummary,
  canonicalizeAlternatives,
  validateCoverageAccounting
} from '../tools/intake-accounting.ts';
import type { IntakeRecord, SourceSnapshot } from '../tools/intake-model.ts';

function snapshot(coverageRole: SourceSnapshot['coverageRole'] = 'coverage-contract'): SourceSnapshot {
  return {
    sourceId: 'coverage-source',
    sourceClass: 'committed-reference',
    repository: 'kinoko34077/japanese-orthography',
    commit: '44417ecfa6628e4ccc9fd9fe2b3502bcc05bae09',
    path: 'source.txt',
    blobSha: 'blob-source',
    coverageRole
  };
}

function record(
  id: string,
  sourceLocator: string,
  disposition: IntakeRecord['disposition'],
  sourceRecordKind: IntakeRecord['sourceRecordKind'] = 'mapping'
): IntakeRecord {
  return {
    id,
    sourceRef: 'coverage-source',
    sourceLocator,
    sourceRecordKind,
    responsibility: disposition === 'excluded_unresolved' ? 'preserve_unresolved' : 'historical_kana_native',
    disposition,
    ...(disposition === 'excluded_unresolved'
      ? { exclusionReason: 'explicit_source_exclusion' }
      : {}),
    evidenceRefs: [`coverage-source:${sourceLocator}`]
  };
}

test('coverage summary exactly partitions discovered records by disposition', () => {
  const input = {
    snapshot: snapshot(),
    discoveredRecordIds: ['r1', 'r2', 'r3'],
    records: [
      record('intake-1', 'r1', 'admitted'),
      record('intake-2', 'r2', 'candidate_ambiguous'),
      record('intake-3', 'r3', 'excluded_unresolved')
    ],
    remainders: []
  };

  assert.deepEqual(buildCoverageSummary(input), {
    sourceId: 'coverage-source',
    discovered: 3,
    admitted: 1,
    ambiguous: 1,
    excluded: 1,
    unclassified: 0,
    unexpected: 0,
    unparsedMappingRecords: 0,
    discoveredRecordIds: ['r1', 'r2', 'r3'],
    admittedRecordIds: ['r1'],
    ambiguousRecordIds: ['r2'],
    excludedRecordIds: ['r3'],
    unclassifiedRecordIds: [],
    unexpectedRecordIds: []
  });
  assert.deepEqual(validateCoverageAccounting(input), []);
});

test('coverage contract rejects discovered records that receive no disposition', () => {
  const diagnostics = validateCoverageAccounting({
    snapshot: snapshot(),
    discoveredRecordIds: ['r1', 'r2'],
    records: [record('intake-1', 'r1', 'admitted')],
    remainders: []
  });

  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'E_COVERAGE_UNCLASSIFIED'));
});

test('coverage contract rejects classifications for records not discovered in the source', () => {
  const diagnostics = validateCoverageAccounting({
    snapshot: snapshot(),
    discoveredRecordIds: ['r1'],
    records: [
      record('intake-1', 'r1', 'admitted'),
      record('intake-extra', 'not-discovered', 'candidate_ambiguous')
    ],
    remainders: []
  });

  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'E_COVERAGE_UNEXPECTED_RECORD'));
});

test('coverage contract rejects unparsed transformation-like source remainder', () => {
  const diagnostics = validateCoverageAccounting({
    snapshot: snapshot(),
    discoveredRecordIds: ['r1'],
    records: [record('intake-1', 'r1', 'admitted')],
    remainders: [{ sourceRecordId: 'raw-9', kind: 'mapping', detail: 'unparsed A -> B' }]
  });

  assert.ok(diagnostics.some(diagnostic => diagnostic.code === 'E_COVERAGE_UNPARSED_MAPPING'));
});

test('supplemental sources are summarized but do not activate coverage-contract completeness errors', () => {
  const input = {
    snapshot: snapshot('supplemental'),
    discoveredRecordIds: ['r1', 'r2'],
    records: [record('intake-1', 'r1', 'admitted')],
    remainders: [{ sourceRecordId: 'raw-9', kind: 'mapping' as const }]
  };

  const summary = buildCoverageSummary(input);
  assert.equal(summary.unclassified, 1);
  assert.equal(summary.unparsedMappingRecords, 1);
  assert.deepEqual(validateCoverageAccounting(input), []);
});

test('disabled and explanatory records remain part of the discovered accounting partition', () => {
  const input = {
    snapshot: snapshot(),
    discoveredRecordIds: ['disabled-1', 'note-1'],
    records: [
      record('intake-disabled', 'disabled-1', 'excluded_unresolved', 'disabled'),
      record('intake-note', 'note-1', 'excluded_unresolved', 'explanatory')
    ],
    remainders: []
  };

  const summary = buildCoverageSummary(input);
  assert.equal(summary.discovered, 2);
  assert.equal(summary.excluded, 2);
  assert.equal(summary.unclassified, 0);
  assert.deepEqual(validateCoverageAccounting(input), []);
});

test('candidate alternative canonicalization is deterministic and does not select a winner', () => {
  assert.deepEqual(canonicalizeAlternatives(['辯', '辨', '辯', '瓣']), ['瓣', '辨', '辯']);
});
