import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { compileLexicalSourceSlice, type UniDicSourceSlice } from '../tools/lexical-compiler.ts';

const sourcePath = resolve('data/lexical/sources/unidic-cwj-202512-first-slice.json');

function compile(outPath: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'tools/compile-lexical.ts', sourcePath, outPath], {
    cwd: resolve('.'), encoding: 'utf8'
  });
}

async function sourceSlice(): Promise<UniDicSourceSlice> {
  return JSON.parse(await readFile(sourcePath, 'utf8')) as UniDicSourceSlice;
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
    assert.equal(artifact.lexicalNamespaceId, '6aba6e8a20610ece73a028ed4dd9e64aefaaff3eec3f9a8bb56fd33c3bdfb144');

    const surface = new Map<string, any>(artifact.surfaceIndex.map((entry: any) => [entry.surface, entry]));
    const school = surface.get('学校');
    const today = surface.get('今日');
    assert.equal(school?.candidateCount, 1);
    assert.equal(today?.candidateCount, 2);
    assert.equal(surface.get('味わおう')?.candidateCount, 1);

    const schoolCandidate = artifact.candidates[school.candidateOffset];
    assert.equal(artifact.lemmas[schoolCandidate.lemmaIndex].sourceLemmaId, 8098);
    assert.equal(artifact.lemmas[schoolCandidate.lemmaIndex].lexicalOrigin, 'sino');
    const todaySourceLemmaIds = artifact.candidates
      .slice(today.candidateOffset, today.candidateOffset + today.candidateCount)
      .map((candidate: any) => artifact.lemmas[candidate.lemmaIndex].sourceLemmaId);
    assert.deepEqual(todaySourceLemmaIds, [9128, 13244]);
    assert.ok(artifact.sections.every((section: any) => /^[0-9a-f]{64}$/.test(section.sha256)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lexical source slice rejects malformed records before normalization', async () => {
  const base = await sourceSlice();

  const emptySurface = structuredClone(base);
  emptySurface.records[0]!.surface = '';
  assert.throws(() => compileLexicalSourceSlice(emptySurface), /surface/i);

  const malformedPos = structuredClone(base);
  malformedPos.records[0]!.pos = ['名詞', '普通名詞', '一般'] as any;
  assert.throws(() => compileLexicalSourceSlice(malformedPos), /pos/i);

  const invalidLemmaId = structuredClone(base);
  invalidLemmaId.records[0]!.sourceLemmaId = -1;
  assert.throws(() => compileLexicalSourceSlice(invalidLemmaId), /sourceLemmaId/i);
});
