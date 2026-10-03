import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { evidenceAggregateDigest } from '../tools/evidence-map.ts';

const require = createRequire(import.meta.url);
const { evidenceFor } = require('../runtime/browser-diagnostic-contract.js');

const programIds = Array.from({ length: 12 }, (_, i) => i);
const pack = {
  hasEvidence: true,
  async loadEvidence() {
    return { canonicalId: 'rule:test', programs: programIds, sourceRecords: [], dispositions: [], sourceSnapshots: [], periodRefs: [] };
  },
  async loadProgramEvidence(id: number) {
    return { programId: id };
  }
};

test('R5 #249 diagnostic evidence preserves the complete Program id list and exposes paging', async () => {
  const page = await evidenceFor(pack, 'rule:test');
  assert.deepEqual(page.programIds, programIds);
  assert.equal(page.programCount, 12);
  assert.equal(page.programOffset, 0);
  assert.equal(page.programPageSize, 8);
  assert.equal(page.programs.length, 8);
  assert.equal(page.programsTruncated, true);
});

test('R5 #249 diagnostic evidence can fetch a later Program page without duplication', async () => {
  const page = await evidenceFor(pack, 'rule:test', { programOffset: 8, programPageSize: 8 });
  assert.equal(page.programOffset, 8);
  assert.deepEqual(page.programs.map((p: { programId: number }) => p.programId), [8, 9, 10, 11]);
  assert.equal(page.programsTruncated, false);
});

test('R5 #248 evidence identity is independent of evidence shard enumeration order', () => {
  const entries = [
    { canonicalId: 'b', kind: 'rule' as const, sourceRecords: ['src:b'], dispositions: ['accepted'], sourceSnapshots: ['src:b'], periodRefs: [], programs: [1] },
    { canonicalId: 'a', kind: 'fact' as const, sourceRecords: ['src:a'], dispositions: ['accepted'], sourceSnapshots: ['src:a'], periodRefs: [], programs: [0] }
  ];
  const programs = [
    { ruleId: 'rule:0', evidenceType: 'literal', stage: 'semantic', kind: 'exact', canonicalIds: ['a'] },
    { ruleId: 'rule:1', evidenceType: 'literal', stage: 'semantic', kind: 'exact', canonicalIds: ['b'] }
  ];
  assert.equal(evidenceAggregateDigest(entries, programs), evidenceAggregateDigest([...entries].reverse(), programs));
});
