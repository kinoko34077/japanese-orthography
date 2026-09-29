import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = process.cwd();

function runTool(tool: string, extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', join(root, 'tools', tool)], {
    cwd: root,
    env: { ...process.env, ORTHOGRAPHY_ROOT: root, ...extraEnv },
    encoding: 'utf8'
  });
}

test('profile validate CLI accepts the canonical fixed profile', () => {
  const result = runTool('validate-profile.ts');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('profile compile CLI writes exactly the deterministic bridge files', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'kinotch-profile-'));
  const outDir = join(temp, 'dist');
  try {
    const result = runTool('compile-profile.ts', { ORTHOGRAPHY_PROFILE_OUT_DIR: outDir });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual((await readdir(outDir)).sort(), [
      '40-legacy-kanji.json5',
      '50-official-homophone-restoration.json5',
      '55-homophone-kanji.json5',
      'manifest.json'
    ]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('profile check CLI verifies canonical data and generated golden semantics', () => {
  const result = runTool('check-profile.ts');
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
