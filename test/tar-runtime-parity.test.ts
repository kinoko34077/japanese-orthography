import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { candidateOutputsOfProgramTrace, TAR_RUNTIME_PARITY_REPORT, TAR_RUNTIME_PARITY_SUMMARY } from '../tools/tar-runtime-parity.ts';

const read = async (path: string) => JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8'));

test('candidate parity observes VM candidate edges rather than compact diagnostic rows', () => {
  const result = {
    programTrace: {
      runs: [
        {
          start: 0, end: 3, stage: 'profile', direction: 'to-modern', channel: 'surface',
          edges: [
            { output: '御覽', candidate: true },
            { output: '御覧', candidate: true },
            { output: '御覧', candidate: false }
          ]
        },
        {
          start: 0, end: 3, stage: 'orthographic', direction: 'to-historical', channel: 'surface',
          edges: [{ output: '別系統', candidate: true }]
        }
      ]
    },
    spans: [{ start: 0, end: 3, candidateCount: 2 }]
  };
  assert.deepEqual(candidateOutputsOfProgramTrace(result, 'ごらん'), ['御覧', '御覽'].sort((a, b) => a.localeCompare(b, 'ja')));
});

test('TAR runtime parity accounts for every fixture case with the two-origin contract', async () => {
  const [report, summary] = await Promise.all([read(TAR_RUNTIME_PARITY_REPORT), read(TAR_RUNTIME_PARITY_SUMMARY)]);
  assert.equal(report.accounting.fixtureRecords, 4036);
  assert.equal(report.accounting.reportRecords, 4036);
  assert.equal(report.accounting.dropped, 0);
  assert.equal(Object.values(report.statuses).reduce((sum: number, value: any) => sum + Number(value), 0), 4036);
  assert.deepEqual(Object.keys(summary.origins).sort(), ['tar']);
  assert.equal(summary.origins.tar, 4036);
  assert.equal(report.baseline.executionMode, 'vm-authoritative');
});

test('condition-sensitive まま / よう cases execute under source-derived token witnesses', async () => {
  const report = await read(TAR_RUNTIME_PARITY_REPORT);
  const find = (input: string, output: string) => report.records.find((record: any) =>
    record.input === input && record.expectedOutputs.includes(output)
  );
  assert.equal(find('まま', '儘')?.status, 'PASS');
  assert.equal(find('まま', '間々')?.status, 'PASS');
  assert.equal(find('よう', '様')?.status, 'PASS');
});

test('source-unreachable and higher-priority-shadowed context rules preserve legacy behavior', async () => {
  const report = await read(TAR_RUNTIME_PARITY_REPORT);
  const find = (input: string, output: string) => report.records.find((record: any) =>
    record.input === input && record.expectedOutputs.includes(output)
  );
  const shi = find('し', '仕');
  assert.equal(shi?.status, 'PASS');
  assert.equal(shi?.actualOutput, 'し');
  assert.match(shi?.reason ?? '', /unreachable/);

  const sugu = find('すぐ', '直ぐ');
  assert.equal(sugu?.status, 'PASS');
  assert.equal(sugu?.actualOutput, '直');
  assert.match(sugu?.reason ?? '', /higher-priority/);

  assert.equal(report.accounting.contextSourceUnreachable, 2);
  assert.equal(report.accounting.contextShadowedByHigherPriority, 1);
});

test('explicit and same-input TAR alternatives execute as candidate sets without a silent winner', async () => {
  const [report, summary] = await Promise.all([read(TAR_RUNTIME_PARITY_REPORT), read(TAR_RUNTIME_PARITY_SUMMARY)]);
  const find = (input: string, output?: string) => report.records.filter((record: any) =>
    record.input === input && (!output || record.expectedOutputs.includes(output))
  );

  const wakaru = find('わかる').find((record: any) =>
    record.expectedOutputs.includes('分る') && record.expectedOutputs.includes('解る')
  );
  assert.ok(wakaru);
  assert.equal(wakaru.status, 'PASS');
  assert.deepEqual(new Set(wakaru.actualCandidates), new Set(['分る', '解る']));

  const gorann = find('ごらん');
  assert.equal(gorann.length, 2);
  assert.ok(gorann.every((record: any) => record.status === 'PASS'));
  assert.ok(gorann.every((record: any) =>
    record.actualCandidates.length === 2
    && record.actualCandidates.includes('御覽')
    && record.actualCandidates.includes('御覧')
  ));

  const deletion = find('おんぷ')[0];
  assert.equal(deletion.status, 'PASS');
  assert.notEqual(deletion.actualOutput, '');
  assert.deepEqual(deletion.actualCandidates, []);
  assert.match(deletion.reason, /fail-closed/);

  assert.equal(report.accounting.candidateCasesExecuted, 165);
  assert.equal(report.accounting.candidateConflictGroupsExecuted, 60);
  assert.equal(report.accounting.candidateReviewRequired, 1);
  assert.equal(report.accounting.conflictingSimpleInputsDeferred, 0);
  assert.equal(report.statuses.CANDIDATE_REQUIRED ?? 0, 0);
  assert.deepEqual(summary.requiredNextGates, ['pattern-parity']);
});

test('only runtime-executed cases carry actual output and candidate observations stay explicit', async () => {
  const report = await read(TAR_RUNTIME_PARITY_REPORT);
  let candidateObserved = 0;
  for (const record of report.records) {
    const executed = record.status === 'PASS' || record.status === 'FAIL';
    assert.equal(record.actualOutput !== null, executed, record.caseId);
    if (record.actualCandidates !== null) candidateObserved += 1;
  }
  assert.equal(candidateObserved, 165);
});
