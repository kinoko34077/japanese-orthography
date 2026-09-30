import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchemaValidator } from '../tools/schema-validator.ts';
import {
  validateOrthographyIntakeDocument,
  type OrthographyIntakeDocument
} from '../tools/orthography-intake.ts';

const validateSchema = createSchemaValidator();

function validDocument(): OrthographyIntakeDocument {
  return {
    schemaVersion: '1',
    batchId: 'phase46-test',
    sources: [{
      sourceId: 'source-a',
      sourceClass: 'committed-reference',
      repository: 'kinoko34077/japanese-orthography',
      commit: '67c86f18385da5cff45bce91b5c9688523500e1d',
      path: 'data/example.json',
      blobSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      coverageRole: 'coverage-contract'
    }],
    records: [{
      id: 'record-a',
      sourceRef: 'source-a',
      sourceLocator: 'row:1',
      sourceRecordKind: 'mapping',
      responsibility: 'character_form',
      disposition: 'admitted',
      modernSurface: '学',
      historicalSurface: '學',
      evidenceRefs: ['source-a#row:1']
    }],
    coverage: [{
      sourceRef: 'source-a',
      discoveredRecordCount: 1,
      unparsedMappingRecords: 0,
      unclassifiedRecords: 0
    }]
  };
}

test('orthography intake schema accepts a pinned coverage document', () => {
  const document = validDocument();
  assert.deepEqual(validateSchema(document, 'orthography-intake-v1'), []);
  assert.deepEqual(validateOrthographyIntakeDocument(document), []);
});

test('orthography intake rejects duplicate source and record IDs', () => {
  const duplicateSources = validDocument();
  duplicateSources.sources.push({ ...duplicateSources.sources[0]! });
  assert.ok(validateOrthographyIntakeDocument(duplicateSources).some((d) => d.code === 'E_INTAKE_DUPLICATE_SOURCE'));

  const duplicateRecords = validDocument();
  duplicateRecords.records.push({ ...duplicateRecords.records[0]! });
  assert.ok(validateOrthographyIntakeDocument(duplicateRecords).some((d) => d.code === 'E_INTAKE_DUPLICATE_RECORD'));
});

test('orthography intake rejects missing refs and incomplete coverage pins', () => {
  const missingRef = validDocument();
  missingRef.records[0]!.sourceRef = 'missing';
  assert.ok(validateOrthographyIntakeDocument(missingRef).some((d) => d.code === 'E_INTAKE_UNKNOWN_SOURCE'));

  const missingPin = validDocument();
  delete missingPin.sources[0]!.commit;
  assert.ok(validateOrthographyIntakeDocument(missingPin).some((d) => d.code === 'E_INTAKE_UNPINNED_SOURCE'));
});

test('orthography intake coverage accounting is source-local and fail-closed', () => {
  const remainder = validDocument();
  remainder.coverage[0]!.unparsedMappingRecords = 1;
  assert.ok(validateOrthographyIntakeDocument(remainder).some((d) => d.code === 'E_INTAKE_UNPARSED'));

  const mismatch = validDocument();
  mismatch.coverage[0]!.discoveredRecordCount = 2;
  assert.ok(validateOrthographyIntakeDocument(mismatch).some((d) => d.code === 'E_INTAKE_COVERAGE_MISMATCH'));

  const unclassified = validDocument();
  unclassified.coverage[0]!.unclassifiedRecords = 1;
  assert.ok(validateOrthographyIntakeDocument(unclassified).some((d) => d.code === 'E_INTAKE_UNCLASSIFIED'));
});

test('excluded unresolved records require an explicit reason', () => {
  const document = validDocument();
  document.records[0] = {
    ...document.records[0]!,
    responsibility: 'preserve_unresolved',
    disposition: 'excluded_unresolved'
  };
  assert.ok(validateOrthographyIntakeDocument(document).some((d) => d.code === 'E_INTAKE_EXCLUSION_REASON'));
});
