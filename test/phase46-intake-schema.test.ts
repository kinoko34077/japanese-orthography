import test from 'node:test';
import assert from 'node:assert/strict';
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
      path: 'data/profiles/kinotch/legacy-kanji.json',
      blobSha: '23239f87420d8b938250b932319a6f8422fdd45f',
      coverageRole: 'candidate-only'
    }],
    records: [{
      id: 'legacy-ben',
      sourceRef: 'legacy-stage40',
      sourceLocator: '/characterMap/弁',
      sourceRecordKind: 'alternative',
      responsibility: 'merged_character',
      disposition: 'candidate_ambiguous',
      modernSurface: '弁',
      historicalSurface: '辨',
      alternatives: ['辨', '瓣', '辯', '辦'],
      evidenceRefs: ['data/packs/contextual-kanji/merged-ben.json']
    }]
  };
}

test('Phase 4.6 intake schema accepts the approved responsibility model', () => {
  assert.deepEqual(validate(validBundle(), 'orthography-intake-bundle-v1'), []);
});

test('Phase 4.6 intake schema rejects an unknown responsibility', () => {
  const bundle = validBundle() as any;
  bundle.records[0].responsibility = 'legacy_old_character';
  assert.ok(validate(bundle, 'orthography-intake-bundle-v1').length > 0);
});

test('excluded unresolved intake records require an exclusion reason', () => {
  const bundle = validBundle() as any;
  bundle.records[0] = {
    ...bundle.records[0],
    responsibility: 'preserve_unresolved',
    disposition: 'excluded_unresolved'
  };
  delete bundle.records[0].exclusionReason;
  assert.ok(validate(bundle, 'orthography-intake-bundle-v1').length > 0);
});

test('intake records require non-empty evidence refs', () => {
  const bundle = validBundle() as any;
  bundle.records[0].evidenceRefs = [];
  assert.ok(validate(bundle, 'orthography-intake-bundle-v1').length > 0);
});

test('source snapshots reject unknown coverage roles', () => {
  const bundle = validBundle() as any;
  bundle.snapshots[0].coverageRole = 'sample';
  assert.ok(validate(bundle, 'orthography-intake-bundle-v1').length > 0);
});
