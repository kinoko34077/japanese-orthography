import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const repositoryRoot = process.cwd();

function runValidateIntake(rootDir: string) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', join(repositoryRoot, 'tools', 'validate-intake.ts')],
    {
      cwd: repositoryRoot,
      env: { ...process.env, ORTHOGRAPHY_ROOT: rootDir },
      encoding: 'utf8'
    }
  );
}

test('intake validation CLI accepts canonical Phase 4.6 foundation data', () => {
  const result = runValidateIntake(repositoryRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('intake validation CLI fails closed on undeclared source provenance', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'orthography-intake-cli-'));
  const intakeDir = join(rootDir, 'data', 'intake');
  await mkdir(intakeDir, { recursive: true });
  await writeFile(join(intakeDir, 'invalid.json'), JSON.stringify({
    schemaVersion: '1',
    kind: 'orthography_intake_bundle',
    snapshots: [{
      sourceId: 'declared-source',
      sourceClass: 'committed-reference',
      path: 'source.txt',
      coverageRole: 'candidate-only'
    }],
    records: [{
      id: 'orphan-record',
      sourceRef: 'missing-source',
      sourceLocator: '/1',
      sourceRecordKind: 'mapping',
      responsibility: 'character_form',
      disposition: 'admitted',
      modernSurface: '学',
      historicalSurface: '學',
      evidenceRefs: ['missing-source:1']
    }]
  }), 'utf8');

  const result = runValidateIntake(rootDir);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /E_UNKNOWN_INTAKE_SOURCE/);
});
