import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTarProfileHome, validateTarProfileHome, assertTarProfileHomeMatches
} from '../tools/tar-profile-home.ts';

test('TAR専用profileホームは全4036件を欠落・重複なく参照し、DISABLED28件を非活性で保存する', async () => {
  const generated = await buildTarProfileHome(process.cwd());
  const { index, manifest } = generated;
  assert.equal(index.entries.length, 4008);
  assert.equal(new Set(index.entries.map((entry) => entry.sourceCaseId)).size, 4008);
  assert.equal(index.disabledSourceCaseIds.length, 28);
  assert.equal(new Set(index.disabledSourceCaseIds).size, 28);
  assert.ok(index.entries.every((entry) => !index.disabledSourceCaseIds.includes(entry.sourceCaseId)));
  assert.equal(manifest.source.flatRecords, 3438);
  assert.equal(manifest.source.structuredRuleObjects, 2279);
  assert.equal(manifest.profileId, 'kinotch-fixed');
  assert.equal(manifest.authority, 'compatibility_profile');
  assert.equal(manifest.policy.genericRuleAdmission, false);
  assert.equal(manifest.policy.disabledRulesActivated, false);
  assert.equal(manifest.policy.ruleBodiesDuplicated, false);
  assert.deepEqual(manifest.canonicalCorpora.map((item) => item.cases), [3166, 670, 165, 7]);
  assert.deepEqual(await validateTarProfileHome(process.cwd()), { indexed: 4008, disabled: 28 });
});

test('索引の欠落・再対応・disabled状態改変を確実に検出する', async () => {
  const expected = await buildTarProfileHome(process.cwd());
  const missing = structuredClone(expected);
  missing.index.entries.pop();
  assert.throws(() => assertTarProfileHomeMatches(expected, missing), /source-case-index.json drift/);
  const changedTarget = structuredClone(expected);
  changedTarget.index.entries[0]!.recordId = 'tampered-id';
  assert.throws(() => assertTarProfileHomeMatches(expected, changedTarget), /source-case-index.json drift/);
  const activated = structuredClone(expected);
  activated.index.disabledSourceCaseIds.pop();
  assert.throws(() => assertTarProfileHomeMatches(expected, activated), /source-case-index.json drift/);
  const changedAuthority = structuredClone(expected);
  changedAuthority.manifest.policy.genericRuleAdmission = true;
  assert.throws(() => assertTarProfileHomeMatches(expected, changedAuthority), /manifest.json drift/);
});
