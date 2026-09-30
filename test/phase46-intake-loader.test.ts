import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadIntakeWorkspace } from '../tools/load-intake.ts';

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'phase46-intake-'));
  try {
    await mkdir(join(root, 'data', 'intake'), { recursive: true });
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function bundle(sourceId: string, recordId: string, sourceRef = sourceId) {
  return {
    schemaVersion: '1',
    kind: 'orthography_intake_bundle',
    snapshots: [{
      sourceId,
      sourceClass: 'committed-reference',
      path: `fixtures/${sourceId}.txt`,
      coverageRole: 'candidate-only'
    }],
    records: [{
      id: recordId,
      sourceRef,
      sourceLocator: '/row/1',
      sourceRecordKind: 'mapping',
      responsibility: 'character_form',
      disposition: 'admitted',
      modernSurface: '学',
      historicalSurface: '學',
      evidenceRefs: ['fixture-evidence']
    }]
  };
}

test('intake loader recursively sorts files and retains source locations', async () => {
  await withRoot(async (root) => {
    await mkdir(join(root, 'data', 'intake', 'nested'));
    await writeJson(join(root, 'data', 'intake', 'z.json'), bundle('source-z', 'record-z'));
    await writeJson(join(root, 'data', 'intake', 'nested', 'a.json'), bundle('source-a', 'record-a'));

    const workspace = await loadIntakeWorkspace(root);
    assert.deepEqual(workspace.snapshots.map((entry) => entry.value.sourceId), ['source-a', 'source-z']);
    assert.deepEqual(workspace.records.map((entry) => entry.value.id), ['record-a', 'record-z']);
    assert.equal(workspace.snapshots[0]!.location.file, 'data/intake/nested/a.json');
    assert.equal(workspace.snapshots[0]!.location.pointer, '/snapshots/0');
    assert.equal(workspace.records[0]!.location.pointer, '/records/0');
  });
});

test('intake loader rejects schema-invalid documents', async () => {
  await withRoot(async (root) => {
    const invalid = bundle('source-a', 'record-a') as any;
    invalid.records[0].evidenceRefs = [];
    await writeJson(join(root, 'data', 'intake', 'invalid.json'), invalid);
    await assert.rejects(loadIntakeWorkspace(root), { code: 'E_SCHEMA_DOCUMENT' });
  });
});

test('intake loader rejects duplicate source snapshot identity', async () => {
  await withRoot(async (root) => {
    await writeJson(join(root, 'data', 'intake', 'a.json'), bundle('source-a', 'record-a'));
    await writeJson(join(root, 'data', 'intake', 'b.json'), bundle('source-a', 'record-b'));
    await assert.rejects(loadIntakeWorkspace(root), { code: 'E_DUPLICATE_INTAKE_SOURCE' });
  });
});

test('intake loader rejects duplicate intake record identity', async () => {
  await withRoot(async (root) => {
    await writeJson(join(root, 'data', 'intake', 'a.json'), bundle('source-a', 'record-x'));
    await writeJson(join(root, 'data', 'intake', 'b.json'), bundle('source-b', 'record-x'));
    await assert.rejects(loadIntakeWorkspace(root), { code: 'E_DUPLICATE_INTAKE_RECORD' });
  });
});

test('intake loader rejects undeclared sourceRef', async () => {
  await withRoot(async (root) => {
    await writeJson(join(root, 'data', 'intake', 'orphan.json'), bundle('source-a', 'record-a', 'missing-source'));
    await assert.rejects(loadIntakeWorkspace(root), { code: 'E_UNKNOWN_INTAKE_SOURCE' });
  });
});
