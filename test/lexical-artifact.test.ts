import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const sourcePath = resolve('data/lexical/sources/unidic-cwj-202512-first-slice.json');

function compile(outPath: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'tools/compile-lexical.ts', sourcePath, outPath], {
    cwd: resolve('.'), encoding: 'utf8'
  });
}

test('real UniDic source slice compiles to one deterministic lexical artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jorth-lexical-'));
  try {
    const first = join(root, 'a.json');
    const second = join(root, 'b.json');
    for (const outPath of [first, second]) {
      const result = compile(outPath);
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const [a, b] = await Promise.all([readFile(first, 'utf8'), readFile(second, 'utf8')]);
    assert.equal(a, b);
    const artifact = JSON.parse(a);
    assert.equal(artifact.schemaVersion, '1');
    assert.equal(artifact.source.dictionary, 'UniDic-CWJ');
    assert.equal(artifact.source.version, '2025.12');
    assert.equal(artifact.source.lexCsvSha256, 'bd00a695ba897a3250965257341e1929ae062dfa2e63b223a05bcc02f22e74a2');
    assert.match(artifact.lexicalNamespaceId, /^[0-9a-f]{64}$/);
    const surface = new Map<string, any>(artifact.surfaceIndex.map((entry: any) => [entry.surface, entry]));
    assert.equal(surface.get('学校')?.candidateCount, 1);
    assert.equal(surface.get('今日')?.candidateCount, 2);
    assert.equal(surface.get('味わおう')?.candidateCount, 1);
    assert.ok(artifact.sections.every((section: any) => /^[0-9a-f]{64}$/.test(section.sha256)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
