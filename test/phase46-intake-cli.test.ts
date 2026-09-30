import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(process.cwd());
const validator = resolve(repositoryRoot, 'tools', 'validate-intake.ts');

function runValidator(root: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', validator], {
    cwd: repositoryRoot,
    env: { ...process.env, ORTHOGRAPHY_ROOT: root },
    encoding: 'utf8'
  });
}

test('intake validation CLI succeeds for canonical repository intake', () => {
  const result = runValidator(repositoryRoot);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('intake validation CLI fails closed on an unknown sourceRef', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase46-intake-cli-'));
  try {
    await mkdir(join(root, 'data', 'intake'), { recursive: true });
    await writeFile(join(root, 'data', 'intake', 'bad.json'), JSON.stringify({
      schemaVersion: '1',
      kind: 'orthography_intake_bundle',
      snapshots: [{
        sourceId: 'declared-source',
        sourceClass: 'committed-reference',
        path: 'fixture.txt',
        coverageRole: 'candidate-only'
      }],
      records: [{
        id: 'orphan-record',
        sourceRef: 'missing-source',
        sourceLocator: '/row/1',
        sourceRecordKind: 'mapping',
        responsibility: 'character_form',
        disposition: 'admitted',
        modernSurface: '学',
        historicalSurface: '學',
        evidenceRefs: ['fixture-evidence']
      }]
    }, null, 2));

    const result = runValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /E_UNKNOWN_INTAKE_SOURCE/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('intake validation CLI rejects moving branch names as repository snapshot pins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'phase46-intake-pin-'));
  try {
    await mkdir(join(root, 'data', 'intake'), { recursive: true });
    await writeFile(join(root, 'data', 'intake', 'moving.json'), JSON.stringify({
      schemaVersion: '1',
      kind: 'orthography_intake_bundle',
      snapshots: [{
        sourceId: 'moving-source',
        sourceClass: 'external-repository',
        repository: 'example/source',
        commit: 'main',
        path: 'dictionary.txt',
        blobSha: '0123456789abcdef0123456789abcdef01234567',
        coverageRole: 'coverage-contract'
      }],
      records: []
    }, null, 2));

    const result = runValidator(root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /E_INTAKE_UNPINNED_SOURCE/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('package scripts put intake validation on the repository check path', async () => {
  const pkg = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts['validate:intake'], 'node --import tsx tools/validate-intake.ts');
  assert.match(pkg.scripts.check ?? '', /npm run validate:intake/);
});
