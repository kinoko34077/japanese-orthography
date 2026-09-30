import test from 'node:test';
import assert from 'node:assert/strict';
import { loadIntakeWorkspace } from '../tools/load-intake.ts';

async function loadFoundation() {
  return loadIntakeWorkspace(process.cwd());
}

test('Phase 4.6 legacy safety intake keeps 弁 out of admitted character-form authority', async () => {
  const workspace = await loadFoundation();
  const benRecords = workspace.records.map((entry) => entry.value).filter((record) => record.modernSurface === '弁');

  assert.ok(benRecords.length > 0);
  assert.ok(!benRecords.some((record) => record.responsibility === 'character_form' && record.disposition === 'admitted'));
  assert.ok(benRecords.some((record) =>
    record.responsibility === 'merged_character'
    && record.disposition === 'candidate_ambiguous'
    && ['辨', '瓣', '辯', '辦'].every((target) => record.alternatives?.includes(target))
  ));
});

test('Phase 4.6 legacy safety intake keeps 台 contextual rather than generic deterministic', async () => {
  const workspace = await loadFoundation();
  const taiRecords = workspace.records.map((entry) => entry.value).filter((record) => record.modernSurface === '台');

  assert.ok(taiRecords.length > 0);
  assert.ok(!taiRecords.some((record) => record.responsibility === 'character_form' && record.disposition === 'admitted'));
  assert.ok(taiRecords.some((record) => record.disposition !== 'admitted'));
});

test('known Stage-40 corruption candidates are explicitly excluded from same-character authority', async () => {
  const workspace = await loadFoundation();
  const records = workspace.records.map((entry) => entry.value);

  for (const [modernSurface, historicalSurface] of [['穗', '瓣'], ['舖', '辯']] as const) {
    const record = records.find((candidate) =>
      candidate.modernSurface === modernSurface && candidate.historicalSurface === historicalSurface
    );
    assert.ok(record, `${modernSurface} -> ${historicalSurface} must be accounted for`);
    assert.equal(record.responsibility, 'preserve_unresolved');
    assert.equal(record.disposition, 'excluded_unresolved');
    assert.ok(record.exclusionReason);
  }
});

test('legacy safety records resolve only to declared pinned committed snapshots', async () => {
  const workspace = await loadFoundation();
  const snapshots = new Map(workspace.snapshots.map((entry) => [entry.value.sourceId, entry.value]));

  assert.ok(workspace.records.length >= 4);
  for (const record of workspace.records.map((entry) => entry.value)) {
    const snapshot = snapshots.get(record.sourceRef);
    assert.ok(snapshot, `missing snapshot for ${record.id}`);
    assert.equal(snapshot.repository, 'kinoko34077/japanese-orthography');
    assert.equal(snapshot.commit, '44417ecfa6628e4ccc9fd9fe2b3502bcc05bae09');
    assert.match(snapshot.blobSha ?? '', /^[0-9a-f]{40}$/);
    assert.equal(snapshot.coverageRole, 'candidate-only');
  }
});
