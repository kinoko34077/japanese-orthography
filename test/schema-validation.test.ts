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

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCanonicalWorkspace } from '../tools/load-workspace.ts';

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'orthography-workspace-'));
  try {
    await mkdir(join(root, 'data', 'evidence'), { recursive: true });
    await mkdir(join(root, 'data', 'lexical', 'constraints'), { recursive: true });
    await mkdir(join(root, 'data', 'packs', 'contextual-kanji'), { recursive: true });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function emptyPack(packId = 'contextual-kanji') {
  return { schemaVersion: '1', packId, restorationUnits: [], positiveRelations: [], safetyConstraints: [], reviewHints: [] };
}
test('workspace discovery is deterministic and retains diagnostic source locations', async () => {
  await withWorkspace(async (root) => {
    const claim = { type: 'attestation', form: '熔接' };
    await writeJson(join(root, 'data', 'evidence', 'z.json'), {
      ...evidenceDoc(claim), source: { ...source, id: 'source-z' }
    });
    await writeJson(join(root, 'data', 'evidence', 'a.json'), {
      ...evidenceDoc(claim), source: { ...source, id: 'source-a' }
    });
    await writeJson(join(root, 'data', 'lexical', 'constraints', 'contextual-kanji.json'), {
      schemaVersion: '1', lexicalEvidence: [], constraintSets: []
    });
    await writeJson(join(root, 'data', 'packs', 'contextual-kanji', 'base.json'), emptyPack());

    const workspace = await loadCanonicalWorkspace(root);
    assert.deepEqual(workspace.sources.map((x) => x.value.id), ['source-a', 'source-z']);
    assert.equal(workspace.sources[0]!.location.file, 'data/evidence/a.json');
    assert.equal(workspace.packMetadata.length, 1);
  });
});

test('workspace loader fails closed on duplicate source document identity', async () => {
  await withWorkspace(async (root) => {
    const doc = evidenceDoc({ type: 'attestation', form: '熔接' });
    await writeJson(join(root, 'data', 'evidence', 'one.json'), doc);
    await writeJson(join(root, 'data', 'evidence', 'two.json'), doc);
    await assert.rejects(loadCanonicalWorkspace(root), { code: 'E_DUPLICATE_DOCUMENT_IDENTITY' });
  });
});
test('workspace loader rejects malformed JSON and malformed UTF-8', async () => {
  await withWorkspace(async (root) => {
    const jsonPath = join(root, 'data', 'evidence', 'bad-json.json');
    await writeFile(jsonPath, '{ nope', 'utf8');
    await assert.rejects(loadCanonicalWorkspace(root), { code: 'E_INVALID_JSON' });
  });
  await withWorkspace(async (root) => {
    const utf8Path = join(root, 'data', 'evidence', 'bad-utf8.json');
    await writeFile(utf8Path, Buffer.from([0xff, 0xfe, 0xfd]));
    await assert.rejects(loadCanonicalWorkspace(root), { code: 'E_INVALID_UTF8' });
  });
});

test('workspace loader preserves duplicate record IDs for semantic validation', async () => {
  await withWorkspace(async (root) => {
    const doc = evidenceDoc({ type: 'attestation', form: '熔接' });
    doc.evidence.push({ ...doc.evidence[0]!, locator: 'row-2' });
    await writeJson(join(root, 'data', 'evidence', 'evidence.json'), doc);
    const workspace = await loadCanonicalWorkspace(root);
    assert.equal(workspace.evidence.length, 2);
    assert.deepEqual(workspace.evidence.map((x) => x.value.id), ['ev-1', 'ev-1']);
    assert.equal(workspace.evidence[1]!.location.file, 'data/evidence/evidence.json');
  });
});
