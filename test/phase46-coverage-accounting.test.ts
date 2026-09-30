import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoverageSummary,
  canonicalizeAlternatives,
  validateCoverageAccounting
} from '../tools/intake-accounting.ts';
import type { IntakeRecord, SourceSnapshot } from '../tools/intake-model.ts';

function snapshot(coverageRole: SourceSnapshot['coverageRole'] = 'coverage-contract'): SourceSnapshot {
  return {
    sourceId: 'source-a',
    sourceClass: 'committed-reference',
    path: 'fixtures/source-a.txt',
    coverageRole
  };
}

function record(
  id: string,
  disposition: IntakeRecord['disposition'],
  sourceRecordKind: IntakeRecord['sourceRecordKind'] = 'mapping'
): IntakeRecord {
  const base: IntakeRecord = {
    id,
    sourceRef: 'source-a',
    sourceLocator: `/records/${id}`,
    sourceRecordKind,
    responsibility: sourceRecordKind === 'disabled' || sourceRecordKind === 'explanatory'
      ? 'preserve_unresolved'
      : 'historical_kana_native',
    disposition,
    modernSurface: 'あう',
    historicalSurface: 'あふ',
    evidenceRefs: ['fixture-evidence']
  };
  return disposition === 'excluded_unresolved'
    ? { ...base, exclusionReason: sourceRecordKind === 'disabled' ? 'source_disabled' : 'non_transformational_explanation' }
    : base;
}

test('coverage summary partitions an exact three-record source snapshot', () => {
  const input = {
    snapshot: snapshot(),
    discoveredRecordIds: ['r3', 'r1', 'r2'],
    records: [
      record('r1', 'admitted'),
      record('r2', 'candidate_ambiguous'),
      record('r3', 'excluded_unresolved', 'disabled')
    ],
    remainders: []
  };
  const summary = buildCoverageSummary(input);
  assert.deepEqual(summary.discoveredRecordIds, ['r1', 'r2', 'r3']);
  assert.equal(summary.discovered, 3);
  assert.equal(summary.admitted, 1);
  assert.equal(summary.ambiguous, 1);
  assert.equal(summary.excluded, 1);
  assert.equal(summary.unclassified, 0);
  assert.equal(summary.unparsed, 0);
  assert.deepEqual(validateCoverageAccounting(input), []);
});

test('coverage accounting fails on discovered but unclassified source records', () => {
  const diagnostics = validateCoverageAccounting({
    snapshot: snapshot(),
    discoveredRecordIds: ['r1', 'r2'],
    records: [record('r1', 'admitted')],
    remainders: []
  });
  assert.ok(diagnostics.some((d) => d.code === 'E_COVERAGE_UNCLASSIFIED'));
});

test('coverage accounting fails on classifications absent from discovered IDs', () => {
  const diagnostics = validateCoverageAccounting({
    snapshot: snapshot(),
    discoveredRecordIds: ['r1'],
    records: [record('r1', 'admitted'), record('r2', 'candidate_ambiguous')],
    remainders: []
  });
  assert.ok(diagnostics.some((d) => d.code === 'E_COVERAGE_UNEXPECTED_CLASSIFICATION'));
});

test('coverage accounting fails on transformation-like parser remainder', () => {
  const input = {
    snapshot: snapshot(),
    discoveredRecordIds: ['r1'],
    records: [record('r1', 'admitted')],
    remainders: [{ id: 'line-99', transformationLike: true, detail: 'unparsed mapping-shaped line' }]
  };
  const summary = buildCoverageSummary(input);
  assert.equal(summary.unparsed, 1);
  assert.deepEqual(summary.unparsedRecordIds, ['line-99']);
  assert.ok(validateCoverageAccounting(input).some((d) => d.code === 'E_COVERAGE_UNPARSED'));
});

test('supplemental sources expose accounting but do not promote completeness gaps to errors', () => {
  const diagnostics = validateCoverageAccounting({
    snapshot: snapshot('supplemental'),
    discoveredRecordIds: ['r1', 'r2'],
    records: [record('r1', 'admitted')],
    remainders: [{ id: 'line-9', transformationLike: true }]
  });
  assert.deepEqual(diagnostics, []);
});

test('disabled and explanatory records remain explicit classified source records', () => {
  const input = {
    snapshot: snapshot(),
    discoveredRecordIds: ['disabled-1', 'explanation-1'],
    records: [
      record('disabled-1', 'excluded_unresolved', 'disabled'),
      record('explanation-1', 'excluded_unresolved', 'explanatory')
    ],
    remainders: []
  };
  const summary = buildCoverageSummary(input);
  assert.equal(summary.discovered, 2);
  assert.equal(summary.excluded, 2);
  assert.equal(summary.unclassified, 0);
  assert.deepEqual(validateCoverageAccounting(input), []);
});

test('candidate alternatives canonicalize for comparison without selecting a winner', () => {
  assert.deepEqual(canonicalizeAlternatives(['辨', '辦', '瓣', '辨', '辯']), ['瓣', '辦', '辨', '辯'].sort((a, b) => a.localeCompare(b, 'ja')));
});
