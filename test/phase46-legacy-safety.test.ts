import assert from 'node:assert/strict';
import test from 'node:test';
import { loadIntakeWorkspace } from '../tools/load-intake.ts';

async function legacySafetyRecords() {
  const workspace = await loadIntakeWorkspace(process.cwd());
  return workspace.records
    .map(entry => entry.value)
    .filter(record => record.id.startsWith('phase46-legacy-'));
}

test('legacy 弁 -> 辨 never becomes admitted generic character_form authority', async () => {
  const records = await legacySafetyRecords();
  const ben = records.find(record => record.id === 'phase46-legacy-stage40-ben');
  assert.ok(ben);
  assert.equal(ben.modernSurface, '弁');
  assert.equal(ben.historicalSurface, '辨');
  assert.notDeepEqual([ben.responsibility, ben.disposition], ['character_form', 'admitted']);
  assert.equal(ben.responsibility, 'merged_character');
  assert.equal(ben.disposition, 'candidate_ambiguous');
});

test('台 is represented as contextual/merged responsibility, never generic deterministic authority', async () => {
  const records = await legacySafetyRecords();
  const tai = records.find(record => record.id === 'phase46-legacy-contextual-tai');
  assert.ok(tai);
  assert.equal(tai.modernSurface, '台');
  assert.equal(tai.responsibility, 'merged_character');
  assert.equal(tai.disposition, 'candidate_ambiguous');
  assert.deepEqual(new Set(tai.alternatives), new Set(['颱', '擡']));
});

test('corrupt Stage-40 cross-character relations are explicit preserve_unresolved exclusions', async () => {
  const records = await legacySafetyRecords();
  const expected = new Map([
    ['phase46-legacy-stage40-u7a57-u74e3', ['穗', '瓣']],
    ['phase46-legacy-stage40-u8216-u8faf', ['舖', '辯']]
  ]);

  for (const [id, [modernSurface, historicalSurface]] of expected) {
    const record = records.find(candidate => candidate.id === id);
    assert.ok(record, id);
    assert.equal(record.modernSurface, modernSurface);
    assert.equal(record.historicalSurface, historicalSurface);
    assert.equal(record.responsibility, 'preserve_unresolved');
    assert.equal(record.disposition, 'excluded_unresolved');
    assert.equal(record.exclusionReason, 'legacy_relation_not_same_character_form');
  }
});

test('every legacy safety record resolves to an explicitly declared pinned snapshot', async () => {
  const workspace = await loadIntakeWorkspace(process.cwd());
  const sourceIds = new Set(workspace.snapshots.map(entry => entry.value.sourceId));
  const records = workspace.records
    .map(entry => entry.value)
    .filter(record => record.id.startsWith('phase46-legacy-'));

  assert.ok(records.length >= 4);
  for (const record of records) assert.ok(sourceIds.has(record.sourceRef), record.id);

  for (const snapshot of workspace.snapshots.map(entry => entry.value)) {
    if (!snapshot.sourceId.startsWith('phase46-')) continue;
    assert.equal(snapshot.repository, 'kinoko34077/japanese-orthography');
    assert.ok(snapshot.commit);
    assert.ok(snapshot.blobSha);
  }
});
