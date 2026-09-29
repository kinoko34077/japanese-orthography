import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();

function runTool(tool: 'validate.ts' | 'compile.ts' | 'check.ts', root: string, outDir?: string) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve(repoRoot, 'tools', tool)],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        ORTHOGRAPHY_ROOT: root,
        ...(outDir ? { ORTHOGRAPHY_OUT_DIR: outDir } : {})
      },
      encoding: 'utf8'
    }
  );
  return result;
}

async function copiedWorkspace(): Promise<{ root: string; cleanup(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'orthography-cli-'));
  await cp(join(repoRoot, 'data'), join(root, 'data'), { recursive: true });
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function mutateHomophone(root: string, mutate: (document: any) => void): Promise<void> {
  const path = join(root, 'data', 'packs', 'contextual-kanji', 'homophone-rewrite.json');
  const document = JSON.parse(await readFile(path, 'utf8'));
  mutate(document);
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

test('CLI validate succeeds for canonical production workspace', () => {
  const result = runTool('validate.ts', repoRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('CLI validate exits non-zero for ERROR diagnostics', async () => {
  const fixture = await copiedWorkspace();
  try {
    await mutateHomophone(fixture.root, (document) => {
      document.positiveRelations[0].evidenceRefs = ['missing-evidence'];
    });
    const result = runTool('validate.ts', fixture.root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /E_UNRESOLVED_EVIDENCE/);
  } finally {
    await fixture.cleanup();
  }
});

test('production check exits non-zero for unresolved REVIEW diagnostics', async () => {
  const fixture = await copiedWorkspace();
  try {
    await mutateHomophone(fixture.root, (document) => {
      document.positiveRelations[0].target = '鎔接';
    });
    const result = runTool('check.ts', fixture.root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /R_LAYER_LEAKAGE_SUSPECTED/);
  } finally {
    await fixture.cleanup();
  }
});

test('compile preserves prior dist generation when validation fails', async () => {
  const fixture = await copiedWorkspace();
  const outDir = join(fixture.root, 'dist', 'contextual-kanji');
  try {
    const valid = runTool('compile.ts', fixture.root, outDir);
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);
    const before = await readFile(join(outDir, 'manifest.json'), 'utf8');

    await mutateHomophone(fixture.root, (document) => {
      document.positiveRelations[0].evidenceRefs = ['missing-evidence'];
    });
    const invalid = runTool('compile.ts', fixture.root, outDir);
    assert.notEqual(invalid.status, 0);
    assert.equal(await readFile(join(outDir, 'manifest.json'), 'utf8'), before);
  } finally {
    await fixture.cleanup();
  }
});

test('compile uses explicit local fixture bindings rather than source-qualified evidence identities', async () => {
  const fixture = await copiedWorkspace();
  const outDir = join(fixture.root, 'dist', 'contextual-kanji');
  try {
    const result = runTool('compile.ts', fixture.root, outDir);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const relations = JSON.parse(await readFile(join(outDir, 'hot-relations.json'), 'utf8')) as Array<{ lexicalBindingIds?: string[] }>;
    const ids = relations.flatMap((relation) => relation.lexicalBindingIds ?? []);
    assert.ok(ids.length > 0);
    for (const id of ids) {
      assert.match(id, /^fixture-local-/);
      assert.doesNotMatch(id, /kkh-kanji-jisyo|kanjipedia|kotobank/);
    }
  } finally {
    await fixture.cleanup();
  }
});

test('production check succeeds for two deterministic clean builds and golden output', () => {
  const result = runTool('check.ts', repoRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
