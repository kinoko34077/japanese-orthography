import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { IntakeLoadError, loadIntakeWorkspace } from '../tools/load-intake.ts';
import type { IntakeBundleDocument } from '../tools/intake-model.ts';

function bundle(sourceId: string, recordId: string, sourceRef = sourceId): IntakeBundleDocument {
  return {
    schemaVersion: '1',
    kind: 'orthography_intake_bundle',
    snapshots: [{
      sourceId,
      sourceClass: 'committed-reference',
      repository: 'kinoko34077/japanese-orthography',
      commit: '44417ecfa6628e4ccc9fd9fe2b3502bcc05bae09',
      path: `sources/${sourceId}.json`,
      blobSha: '1111111111111111111111111111111111111111',
      coverageRole: 'candidate-only'
    }],
    records: [{
      id: recordId,
      sourceRef,
      sourceLocator: `/${recordId}`,
      sourceRecordKind: 'mapping',
      responsibility: 'character_form',
      disposition: 'admitted',
      modernSurface: '学',
      historicalSurface: '學',
      evidenceRefs: [`${sourceId}:${recordId}`]
    }]
  };
}

async function root(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'orthography-intake-'));
}

async function writeBundle(rootDir: string, relativePath: string, document: unknown): Promise<void> {
  const absolutePath = join(rootDir, 'data', 'intake', relativePath);
  await mkdir(join(absolutePath, '..'), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(document), 'utf8');
}

async function expectLoadError(promise: Promise<unknown>, code: string): Promise<IntakeLoadError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof IntakeLoadError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`Expected ${code}`);
}

test('intake loader recursively loads JSON in deterministic lexical path order', async () => {
  const rootDir = await root();
  await writeBundle(rootDir, 'z/b.json', bundle('source-b', 'record-b'));
  await writeBundle(rootDir, 'a.json', bundle('source-a', 'record-a'));

  const workspace = await loadIntakeWorkspace(rootDir);
  assert.deepEqual(workspace.snapshots.map(entry => entry.value.sourceId), ['source-a', 'source-b']);
  assert.deepEqual(workspace.records.map(entry => entry.value.id), ['record-a', 'record-b']);
  assert.deepEqual(workspace.snapshots.map(entry => entry.location.file), [
    'data/intake/a.json',
    'data/intake/z/b.json'
  ]);
  assert.equal(workspace.records[1]?.location.pointer, '/records/0');
});

test('intake loader fails closed on schema-invalid documents', async () => {
  const rootDir = await root();
  const invalid = bundle('source-a', 'record-a') as unknown as Record<string, any>;
  invalid.records[0].responsibility = 'mystery';
  await writeBundle(rootDir, 'invalid.json', invalid);

  await expectLoadError(loadIntakeWorkspace(rootDir), 'E_INTAKE_SCHEMA_DOCUMENT');
});

test('intake loader rejects duplicate source identities across documents', async () => {
  const rootDir = await root();
  await writeBundle(rootDir, 'a.json', bundle('source-a', 'record-a'));
  await writeBundle(rootDir, 'b.json', bundle('source-a', 'record-b'));

  await expectLoadError(loadIntakeWorkspace(rootDir), 'E_DUPLICATE_INTAKE_SOURCE');
});

test('intake loader rejects duplicate intake record identities', async () => {
  const rootDir = await root();
  await writeBundle(rootDir, 'a.json', bundle('source-a', 'record-same'));
  await writeBundle(rootDir, 'b.json', bundle('source-b', 'record-same'));

  await expectLoadError(loadIntakeWorkspace(rootDir), 'E_DUPLICATE_INTAKE_RECORD');
});

test('intake loader rejects records whose sourceRef is not declared by the workspace', async () => {
  const rootDir = await root();
  await writeBundle(rootDir, 'a.json', bundle('source-a', 'record-a', 'missing-source'));

  const error = await expectLoadError(loadIntakeWorkspace(rootDir), 'E_UNKNOWN_INTAKE_SOURCE');
  assert.equal(error.file, 'data/intake/a.json');
});
