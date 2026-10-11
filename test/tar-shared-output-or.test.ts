import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { auditTarBranchProvenance } from '../tools/audit-tar-branch-provenance.ts';
import {
  enabledSharedOutputBranches, type SharedOutputOrigin
} from '../tools/tar-shared-output-or.ts';

const rows: SharedOutputOrigin[] = [{
  programId: 15, canonicalRuleId: 'rule:fixed', input: '漢字', output: '異體',
  sourceCaseIds: ['case:one','case:two'], sourceKeys: ['entry:one','entry:two']
}];
const permit = { 'entry:one': true, 'entry:two': true };

test('#344 two independent origins retain one shared output via OR and both disabled suppress it', () => {
  const all = enabledSharedOutputBranches(rows, permit);
  assert.deepEqual(all.map(x => x.output), ['異體']);
  assert.deepEqual(all[0]!.activeSourceKeys, ['entry:one','entry:two']);
  assert.deepEqual(enabledSharedOutputBranches(rows, permit, { 'entry:one': false })[0]!.activeSourceKeys, ['entry:two']);
  assert.deepEqual(enabledSharedOutputBranches(rows, permit, { 'entry:two': false })[0]!.activeSourceKeys, ['entry:one']);
  assert.deepEqual(enabledSharedOutputBranches(rows, permit,
    { 'entry:one': false, 'entry:two': false }), []);
  assert.deepEqual(enabledSharedOutputBranches(rows, permit,
    { 'entry:one': null, 'entry:two': null }), all);
});

test('#344 profile deny/source lock is intersected, never overridden by user toggle', () => {
  assert.deepEqual(enabledSharedOutputBranches(rows,
    { 'entry:one': false, 'entry:two': true },
    { 'entry:one': true })[0]!.activeSourceKeys, ['entry:two']);
  assert.deepEqual(enabledSharedOutputBranches(rows,
    { 'entry:one': false, 'entry:two': false },
    { 'entry:one': true, 'entry:two': true }), []);
  assert.throws(() => enabledSharedOutputBranches(rows, { 'entry:one': true }), /missing eligibility/);
});

test('#344 ambiguous, unknown, or shared branch duplicate identities reject without taking whole Program offline', () => {
  assert.throws(() => enabledSharedOutputBranches(rows, permit, { 'unknown': false }), /unknown editable entry/);
  assert.throws(() => enabledSharedOutputBranches(rows, { ...permit, unknown: true }), /unknown entry eligibility/);
  assert.throws(() => enabledSharedOutputBranches([{ ...rows[0]!, sourceKeys: ['entry:one','entry:one'] }],
    permit), /cardinality unproven/);
  assert.throws(() => enabledSharedOutputBranches([{ ...rows[0]!, sourceCaseIds: ['a','a'] }],
    permit), /cardinality unproven/);
  assert.throws(() => enabledSharedOutputBranches([rows[0]!,{ ...rows[0]!, canonicalRuleId: 'different' }],
    permit), /mapped twice/);
});

test('#344 accepted fixed TAR simple-exact shared-output census admits OR only for proven two-origin rows', async () => {
  const report = await auditTarBranchProvenance(fileURLToPath(new URL('..', import.meta.url)));
  assert.equal(report.simpleSharedRelations, 3);
  const shared = report.simpleShared;
  for (const item of shared) {
    assert.equal(item.sourceCaseIds.length, 2);
    assert.equal(item.sourceKeys.length, 2,
      'the fixed snapshot must provide two separately editable source keys');
  }
  const eligible = Object.fromEntries(shared.flatMap(x => x.sourceKeys.map(key => [key,true])));
  const selected = enabledSharedOutputBranches(shared, eligible);
  assert.equal(selected.length, 3);
  const first = shared[0]!;
  const disabledOne = enabledSharedOutputBranches(shared, eligible, { [first.sourceKeys[0]!]: false });
  assert.equal(disabledOne.length, 3);
  const disabledBoth = enabledSharedOutputBranches(shared, eligible, {
    [first.sourceKeys[0]!]: false, [first.sourceKeys[1]!]: false
  });
  assert.equal(disabledBoth.length, 2);
});
