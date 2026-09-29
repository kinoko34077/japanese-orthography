import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchemaValidator } from '../tools/schema-validator.ts';

const validate = createSchemaValidator();

const source = {
  id: 'culture-agency-1956-douon',
  kind: 'primary_official',
  title: '同音の漢字による書きかえ',
  locator: 'primary-table'
};

function evidenceDoc(claim: unknown) {
  return {
    schemaVersion: '1',
    source,
    evidence: [{
      id: 'ev-1',
      sourceRef: source.id,
      locator: 'row-1',
      sourceClass: 'official',
      claim
    }]
  };
}
test('schema accepts mapping, attestation, and exclusion evidence claims', () => {
  const claims = [
    { type: 'mapping', direction: 'historical_to_modern', rawFrom: '熔接', rawTo: '溶接' },
    { type: 'attestation', form: '熔接', reading: 'ヨウセツ' },
    { type: 'exclusion', form: '付す', senseNote: 'transfer/issue sense' }
  ];

  for (const claim of claims) {
    assert.deepEqual(validate(evidenceDoc(claim), 'evidence-bundle-v1'), []);
  }
});

test('schema rejects evidence claim without discriminator', () => {
  const diagnostics = validate(
    evidenceDoc({ direction: 'historical_to_modern', rawFrom: '熔接', rawTo: '溶接' }),
    'evidence-bundle-v1'
  );
  assert.ok(diagnostics.some((d) => d.severity === 'ERROR'));
});

test('schema rejects unknown schema version and enum values', () => {
  const unknownVersion = { ...evidenceDoc({ type: 'attestation', form: '熔接' }), schemaVersion: '2' };
  assert.ok(validate(unknownVersion, 'evidence-bundle-v1').length > 0);
  const badClass = evidenceDoc({ type: 'attestation', form: '熔接' });
  badClass.evidence[0]!.sourceClass = 'mystery';
  assert.ok(validate(badClass, 'evidence-bundle-v1').length > 0);
});
test('external relation ref requires non-empty packId and relationId', () => {
  assert.deepEqual(
    validate({ packId: 'safe-kanji', relationId: '台-臺' }, 'external-relation-ref-v1'),
    []
  );
  assert.ok(validate({ packId: '', relationId: '台-臺' }, 'external-relation-ref-v1').length > 0);
  assert.ok(validate({ packId: 'safe-kanji', relationId: '' }, 'external-relation-ref-v1').length > 0);
});

test('contextual schema accepts explicit block_fallback refs and rejects unknown fields', () => {
  const document = {
    schemaVersion: '1',
    packId: 'contextual-kanji',
    restorationUnits: [],
    positiveRelations: [],
    safetyConstraints: [{
      id: 'safe-tai-mitsu', kind: 'contextual_kanji', channel: 'surface',
      match: '台密', effect: 'block_fallback', evidenceRefs: ['ev-1'],
      blocks: [{ packId: 'safe-kanji', relationId: 'char-tai' }], admission: 'admitted'
    }],
    reviewHints: []
  };
  assert.deepEqual(validate(document, 'contextual-kanji-pack-v1'), []);
  assert.ok(validate({ ...document, surprise: true }, 'contextual-kanji-pack-v1').length > 0);
});
