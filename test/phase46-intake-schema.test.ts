import assert from 'node:assert/strict';
import test from 'node:test';
import { createSchemaValidator } from '../tools/schema-validator.ts';
import type { IntakeBundleDocument } from '../tools/intake-model.ts';

const validate = createSchemaValidator();

function validBundle(): IntakeBundleDocument {
  return {
    schemaVersion: '1',
    kind: 'orthography_intake_bundle',
    snapshots: [{
      sourceId: 'legacy-stage40',
      sourceClass: 'committed-reference',
      repository: 'kinoko34077/japanese-orthography',
      commit: '44417ecfa6628e4ccc9fd9fe2b3502bcc05bae09',
      path: 'test/fixtures/pinned/txt-auto-replace/40-legacy-kanji.json5',
      blobSha: '57177fb8fba471f9c169283dcbae5830d5bac64f',
      coverageRole: 'candidate-only'
    }],
    records: [{
      id: 'legacy-stage40-ben',
      sourceRef: 'legacy-stage40',
      sourceLocator: 'character_map.弁',
      sourceRecordKind: 'mapping',
      responsibility: 'merged_character',
      disposition: 'candidate_ambiguous',
      modernSurface: '弁',
      historicalSurface: '辨',
      alternatives: ['辨', '瓣', '辯', '辦'],
      evidenceRefs: ['legacy-stage40:弁']
    }]
  };
}

test('Phase 4.6 intake schema accepts the approved responsibility/provenance shape', () => {
  assert.deepEqual(validate(validBundle(), 'orthography-intake-bundle-v1'), []);
});

test('Phase 4.6 intake schema rejects an unknown responsibility', () => {
  const document = validBundle() as unknown as Record<string, any>;
  document.records[0].responsibility = 'mystery';
  assert.ok(validate(document, 'orthography-intake-bundle-v1').length > 0);
});

test('excluded_unresolved requires a machine-readable exclusion reason', () => {
  const document = validBundle() as unknown as Record<string, any>;
  document.records[0].disposition = 'excluded_unresolved';
  delete document.records[0].exclusionReason;
  assert.ok(validate(document, 'orthography-intake-bundle-v1').length > 0);

  document.records[0].exclusionReason = 'legacy_relation_not_same_character_form';
  assert.deepEqual(validate(document, 'orthography-intake-bundle-v1'), []);
});

test('intake evidenceRefs cannot be empty', () => {
  const document = validBundle() as unknown as Record<string, any>;
  document.records[0].evidenceRefs = [];
  assert.ok(validate(document, 'orthography-intake-bundle-v1').length > 0);
});

test('source snapshots reject unknown coverage roles', () => {
  const document = validBundle() as unknown as Record<string, any>;
  document.snapshots[0].coverageRole = 'ignored';
  assert.ok(validate(document, 'orthography-intake-bundle-v1').length > 0);
});
