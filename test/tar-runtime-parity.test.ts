import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TAR_RUNTIME_PARITY_REPORT, TAR_RUNTIME_PARITY_SUMMARY } from '../tools/tar-runtime-parity.ts';

const read = async (path: string) => JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8'));

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

test('candidate shorthand is preserved as candidate semantics', async () => {
  const report = await read(TAR_RUNTIME_PARITY_REPORT);
  const wakaru = report.records.find((record: any) =>
    record.input === 'わかる'
    && record.expectedOutputs.includes('分る')
    && record.expectedOutputs.includes('解る')
  );
  assert.ok(wakaru);
  assert.equal(wakaru.status, 'CANDIDATE_REQUIRED');
});

test('only actually executed simple cases carry actual output', async () => {
  const report = await read(TAR_RUNTIME_PARITY_REPORT);
  for (const record of report.records) {
    const executed = record.status === 'PASS' || record.status === 'FAIL';
    assert.equal(record.actualOutput !== null, executed, record.caseId);
  }
});
