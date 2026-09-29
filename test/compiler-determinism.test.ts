import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeCanonicalSourceDigest,
  normalizeCanonicalKnowledge,
  stableSerialize
} from '../tools/normalize.ts';
import { compileWorkspace, type CompilationBindings } from '../tools/compiler.ts';
import { writeArtifactAtomically } from '../tools/artifact-writer.ts';
import type { CanonicalWorkspace, CompiledArtifact, Located } from '../tools/model.ts';

function located<T>(value: T, file = 'canonical.json'): Located<T> {
  return { value, location: { file, pointer: '/' } };
}

const bindings: CompilationBindings = {
  lexicalNamespaceId: 'pmin-current',
  lexicalBindings: new Map()
};
function compilerWorkspace(): CanonicalWorkspace {
  return {
    sources: [located({ id: 'official', kind: 'primary_official', title: 'source', locator: 'table' })],
    evidence: [located({
      id: 'ev-main', sourceRef: 'official', locator: 'row', sourceClass: 'official',
      claim: { type: 'mapping', direction: 'historical_to_modern', rawFrom: '熔接', rawTo: '溶接' }
    })],
    lexicalEvidence: [], lexicalConstraintSets: [],
    restorationUnits: [located({ id: 'unit-main', family: 'homophone', modernKey: '溶接' })],
    positiveRelations: [located({
      id: 'rel-main', unitId: 'unit-main', kind: 'contextual_kanji', direction: 'modern_to_historical',
      channel: 'surface', match: '溶接', target: '熔接', evidenceRefs: ['ev-main'], admission: 'admitted'
    })],
    safetyConstraints: [located({
      id: 'safe-tai', kind: 'contextual_kanji', channel: 'surface', match: '台密',
      effect: 'block_fallback', evidenceRefs: ['ev-main'],
      blocks: [{ packId: 'safe-kanji', relationId: 'char-tai' }], admission: 'admitted'
    })],
    reviewHints: [located({
      id: 'review-ben', kind: 'contextual_kanji', channel: 'surface', match: '弁護',
      proposedTarget: '辯護', evidenceRefs: ['ev-main'], reason: 'oracle_only'
    })],
    packMetadata: [located({ packId: 'contextual-kanji', requiresLexicalNamespaceId: 'pmin-current' })]
  };
}
test('deterministic compiler ignores non-semantic ordering and source locations', () => {
  const first = compilerWorkspace();
  const reordered = structuredClone(first);
  reordered.sources.reverse();
  reordered.evidence.reverse();
  reordered.positiveRelations.reverse();
  for (const collection of [reordered.sources, reordered.evidence, reordered.positiveRelations]) {
    for (const record of collection) record.location.file = 'C:/different-machine/temp/source.json';
  }

  const firstArtifact = compileWorkspace(first, bindings);
  const secondArtifact = compileWorkspace(first, bindings);
  const reorderedArtifact = compileWorkspace(reordered, bindings);
  assert.deepEqual(firstArtifact, secondArtifact);
  assert.deepEqual(firstArtifact, reorderedArtifact);
  assert.equal(computeCanonicalSourceDigest(first), computeCanonicalSourceDigest(reordered));
  assert.equal(stableSerialize({ b: 1, a: [2, 1] }), stableSerialize({ a: [1, 2], b: 1 }));
});

test('semantic admission change changes digest and artifact generation', () => {
  const first = compilerWorkspace();
  const changed = structuredClone(first);
  changed.positiveRelations[0]!.value.target = '鎔接';
  assert.notEqual(computeCanonicalSourceDigest(first), computeCanonicalSourceDigest(changed));
  const firstManifest = JSON.parse(compileWorkspace(first, bindings)['manifest.json']);
  const changedManifest = JSON.parse(compileWorkspace(changed, bindings)['manifest.json']);
  assert.notEqual(firstManifest.artifactGeneration, changedManifest.artifactGeneration);
});
test('compiled sections separate hot authority from review and audit traceability', () => {
  const artifact = compileWorkspace(compilerWorkspace(), bindings);
  const hotRelations = artifact['hot-relations.json'];
  const hotSafety = artifact['hot-safety.json'];
  const coldReview = artifact['cold-review.json'];
  const auditMap = artifact['audit-map.json'];

  assert.equal(hotRelations.includes('evidenceRefs'), false);
  assert.equal(hotRelations.includes('review-ben'), false);
  assert.equal(hotSafety.includes('evidenceRefs'), false);
  assert.ok(hotSafety.includes('before_fallback'));
  assert.ok(coldReview.includes('review-ben'));
  assert.ok(coldReview.includes('evidenceRefs'));
  assert.ok(auditMap.includes('ev-main'));
  assert.ok(auditMap.includes('official'));
});

test('external fixture bytes and local paths do not enter canonical semantic identity', () => {
  const workspace = compilerWorkspace();
  const before = computeCanonicalSourceDigest(workspace);
  const externalFixtureBytes = Buffer.from('SAFE_FIXTURE_SECRET_A');
  externalFixtureBytes.fill(0x42);
  workspace.sources[0]!.location.file = 'D:/other/machine/source.json';
  const after = computeCanonicalSourceDigest(workspace);
  assert.equal(before, after);
  const artifactText = Object.values(compileWorkspace(workspace, bindings)).join('\n');
  assert.equal(artifactText.includes('other/machine'), false);
  assert.equal(artifactText.includes('SAFE_FIXTURE_SECRET'), false);
});
test('atomic writer preserves previous output when staging fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orthography-artifact-'));
  const outDir = join(root, 'dist', 'contextual-kanji');
  try {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'manifest.json'), 'previous-generation\n', 'utf8');
    const broken = { ...compileWorkspace(compilerWorkspace(), bindings) } as Record<string, unknown>;
    broken['hot-relations.json'] = undefined;
    await assert.rejects(writeArtifactAtomically(broken as CompiledArtifact, outDir));
    assert.equal(await readFile(join(outDir, 'manifest.json'), 'utf8'), 'previous-generation\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('atomic writer materializes exactly the five first-slice files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orthography-artifact-ok-'));
  const outDir = join(root, 'contextual-kanji');
  try {
    const artifact = compileWorkspace(compilerWorkspace(), bindings);
    await writeArtifactAtomically(artifact, outDir);
    for (const name of ['manifest.json', 'hot-relations.json', 'hot-safety.json', 'cold-review.json', 'audit-map.json']) {
      assert.equal(await readFile(join(outDir, name), 'utf8'), artifact[name as keyof CompiledArtifact]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
