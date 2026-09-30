import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCanonicalWorkspace } from '../tools/load-workspace.ts';
import { loadIntakeWorkspace } from '../tools/load-intake.ts';
import { validatePhase46AuthorityClosure } from '../tools/phase46-authority-closure.ts';

async function canonicalPair() {
  return Promise.all([
    loadCanonicalWorkspace(process.cwd()),
    loadIntakeWorkspace(process.cwd())
  ]);
}

function firstLinkedRelation(workspace: Awaited<ReturnType<typeof loadCanonicalWorkspace>>) {
  const relation = workspace.positiveRelations.find((record) => record.value.intakeRecordRef);
  assert.ok(relation);
  return relation;
}

test('canonical Phase 4.6 relation/intake links are closure-clean', async () => {
  const [workspace, intake] = await canonicalPair();
  assert.deepEqual(validatePhase46AuthorityClosure(workspace, intake), []);
});

test('authority closure rejects an unknown intake record reference', async () => {
  const [workspace, intake] = await canonicalPair();
  const relation = firstLinkedRelation(workspace);
  relation.value.intakeRecordRef = 'phase46c-missing-record';

  const diagnostics = validatePhase46AuthorityClosure(workspace, intake);
  assert.ok(diagnostics.some((item) => item.code === 'E_PHASE46_UNKNOWN_INTAKE_RECORD'));
});

test('authority closure rejects responsibility drift between relation and intake', async () => {
  const [workspace, intake] = await canonicalPair();
  const relation = firstLinkedRelation(workspace);
  relation.value.responsibility = 'merged_character';

  const diagnostics = validatePhase46AuthorityClosure(workspace, intake);
  assert.ok(diagnostics.some((item) => item.code === 'E_PHASE46_RESPONSIBILITY_MISMATCH'));
});

test('authority closure rejects modern-surface and target drift', async () => {
  const [workspace, intake] = await canonicalPair();
  const relation = firstLinkedRelation(workspace);
  relation.value.match = `${relation.value.match}X`;
  relation.value.target = `${relation.value.target}X`;

  const diagnostics = validatePhase46AuthorityClosure(workspace, intake);
  assert.ok(diagnostics.some((item) => item.code === 'E_PHASE46_MODERN_SURFACE_MISMATCH'));
  assert.ok(diagnostics.some((item) => item.code === 'E_PHASE46_TARGET_MISMATCH'));
});

test('authority closure rejects candidate collapse and excluded hot authority', async () => {
  const [workspace, intake] = await canonicalPair();
  const soteiRelation = workspace.positiveRelations.find((record) => record.value.id === 'rel-sotei-kugi');
  assert.ok(soteiRelation);
  const intakeRecord = intake.records.find((record) => record.value.id === soteiRelation.value.intakeRecordRef);
  assert.ok(intakeRecord);

  intakeRecord.value.alternatives = ['装幀'];
  let diagnostics = validatePhase46AuthorityClosure(workspace, intake);
  assert.ok(diagnostics.some((item) => item.code === 'E_PHASE46_TARGET_NOT_IN_ALTERNATIVES'));

  intakeRecord.value.disposition = 'excluded_unresolved';
  intakeRecord.value.exclusionReason = 'test_exclusion';
  diagnostics = validatePhase46AuthorityClosure(workspace, intake);
  assert.ok(diagnostics.some((item) => item.code === 'E_PHASE46_EXCLUDED_HOT_AUTHORITY'));
});

test('authority closure rejects incomplete Phase 4.6 metadata pairs', async () => {
  const [workspace, intake] = await canonicalPair();
  const relation = firstLinkedRelation(workspace);
  delete relation.value.responsibility;

  const diagnostics = validatePhase46AuthorityClosure(workspace, intake);
  assert.ok(diagnostics.some((item) => item.code === 'E_PHASE46_AUTHORITY_LINK_INCOMPLETE'));
});
