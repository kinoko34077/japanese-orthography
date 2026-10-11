import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditTarToggleIdentities, runTarToggleIdentityCensus, TAR_PIN } from '../tools/audit-tar-toggle-identities.ts';

test('#319 audits all accepted TAR records without losing 3166→3163 relation aggregation', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const report = await runTarToggleIdentityCensus(root);
  assert.equal(report.sourceCommit, TAR_PIN);
  assert.equal(report.activeSourceCases, 4008);
  assert.equal(report.disabledSourceCases, 28);
  assert.equal(report.canonicalRecordCount, 4005);
  assert.deepEqual(report.corpusCases, {
    'simple-exact': 3166, context: 670, candidate: 165, pattern: 7
  });
  assert.deepEqual(report.corpusRecords, {
    'simple-exact': 3163, context: 670, candidate: 165, pattern: 7
  });
  assert.equal(report.programMapping.status, 'not-established');
  assert.ok(report.sourceIdentityKeys > 0);
  assert.ok(report.aggregateRelationsWithMultipleCases > 0);
  assert.equal(report.aggregateRelationsWithMultipleCases, 3);
});

test('#319 fails closed on wrong corpus cardinality and source snapshot', () => {
  assert.throws(() => auditTarToggleIdentities([], {
    sourceCommit: TAR_PIN, profileId: 'kinotch-fixed', entries: [], disabledSourceCaseIds: []
  }), /requires 4/);
  assert.throws(() => auditTarToggleIdentities([{}, {}, {}, {}] as any, {
    sourceCommit: 'wrong', profileId: 'kinotch-fixed', entries: [], disabledSourceCaseIds: []
  }), /wrong source snapshot/);
});
