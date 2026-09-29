import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCanonicalWorkspace } from '../tools/load-workspace.ts';
import { validatePackLocal } from '../tools/semantic-validator.ts';
import { validateIntegration } from '../tools/integration-validator.ts';
import { compileWorkspace } from '../tools/compiler.ts';

const safePack = {
  packId: 'safe-kanji',
  exportedRelationIds: new Set(['char-tai-to-dai'])
};

const lexicalNamespace = {
  id: 'pmin-current',
  compatibleSourceNamespaces: new Set(['kkh-kanji-jisyo', 'kanjipedia', 'kotobank'])
};

function targetsFor(workspace: Awaited<ReturnType<typeof loadCanonicalWorkspace>>, match: string): string[] {
  return workspace.positiveRelations
    .filter((record) => record.value.admission === 'admitted' && record.value.match === match)
    .map((record) => record.value.target)
    .sort((a, b) => a.localeCompare(b, 'ja'));
}

test('canonical slice materializes the primary-backed target sets', async () => {
  const workspace = await loadCanonicalWorkspace(process.cwd());
  assert.deepEqual(targetsFor(workspace, '溶接'), ['熔接']);
  assert.deepEqual(targetsFor(workspace, '間欠'), ['間歇']);
  assert.deepEqual(targetsFor(workspace, '賛嘆'), ['讃嘆']);
  assert.deepEqual(targetsFor(workspace, '装丁'), ['装幀', '装釘'].sort((a, b) => a.localeCompare(b, 'ja')));
});
test('canonical slice preserves the source-backed 付す unit and excluded sense', async () => {
  const workspace = await loadCanonicalWorkspace(process.cwd());
  for (const [modern, historical] of [['付さ','附さ'], ['付し','附し'], ['付す','附す'], ['付せ','附せ'], ['付そ','附そ']]) {
    assert.deepEqual(targetsFor(workspace, modern!), [historical]);
  }
  const fuUnits = new Set(
    workspace.positiveRelations
      .filter((record) => record.value.match.startsWith('付'))
      .map((record) => record.value.unitId)
  );
  assert.equal(fuUnits.size, 1);
  assert.ok(workspace.safetyConstraints.some((record) =>
    record.value.match === '付す' && record.value.effect === 'preserve_exact' && record.value.admission === 'admitted'
  ));
});

test('canonical slice admits recoverable 弁/台 boundaries without global character ownership', async () => {
  const workspace = await loadCanonicalWorkspace(process.cwd());
  assert.ok(workspace.safetyConstraints.some((record) => record.value.match === '武弁' && record.value.effect === 'preserve_exact'));
  assert.deepEqual(targetsFor(workspace, '合弁'), ['合瓣', '合辦'].sort((a, b) => a.localeCompare(b, 'ja')));
  assert.deepEqual(targetsFor(workspace, '台風'), ['颱風']);
  assert.deepEqual(targetsFor(workspace, '台頭'), ['擡頭']);
  assert.ok(workspace.safetyConstraints.some((record) => record.value.match === '台密' && record.value.effect === 'block_fallback'));
  assert.equal(workspace.positiveRelations.some((record) => record.value.match === '学'), false);
  assert.equal(workspace.positiveRelations.some((record) => record.value.match === '台' && record.value.target === '臺'), false);
});
test('canonical slice keeps oracle-only 弁護 as cold review evidence', async () => {
  const workspace = await loadCanonicalWorkspace(process.cwd());
  assert.equal(targetsFor(workspace, '弁護').length, 0);
  assert.ok(workspace.reviewHints.some((record) =>
    record.value.match === '弁護' && record.value.proposedTarget === '辯護' && record.value.reason === 'oracle_only'
  ));
});

test('canonical slice is validator-clean and compiles with explicit external/binding inputs', async () => {
  const workspace = await loadCanonicalWorkspace(process.cwd());
  const localDiagnostics = validatePackLocal(workspace);
  assert.deepEqual(localDiagnostics, []);
  const integrationDiagnostics = validateIntegration(workspace, [safePack], lexicalNamespace);
  assert.deepEqual(integrationDiagnostics, []);

  const bindings = new Map<string, readonly string[]>();
  for (const constraint of workspace.lexicalConstraintSets) {
    bindings.set(constraint.value.id, [`bound:${constraint.value.id}`]);
  }
  const artifact = compileWorkspace(workspace, {
    lexicalNamespaceId: 'pmin-current',
    lexicalBindings: bindings
  });
  const hotRelations = JSON.parse(artifact['hot-relations.json']) as Array<{ match: string; target: string }>;
  assert.ok(hotRelations.some((relation) => relation.match === '台風' && relation.target === '颱風'));
  assert.equal(artifact['hot-relations.json'].includes('弁護'), false);
  assert.ok(artifact['cold-review.json'].includes('弁護'));
});

test('canonical slice merges shard metadata into one semantic pack identity', async () => {
  const workspace = await loadCanonicalWorkspace(process.cwd());
  assert.equal(workspace.packMetadata.length, 1);
  assert.equal(workspace.packMetadata[0]!.value.packId, 'contextual-kanji');
  assert.equal(workspace.packMetadata[0]!.value.requiresLexicalNamespaceId, 'pmin-current');
});
