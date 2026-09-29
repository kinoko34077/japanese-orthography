import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('lexical runtime benchmark emits reproducible acceptance-slice baseline', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'tools/bench-lexical-runtime.ts', '--json'],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as Record<string, any>;

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scope, 'real-lexical-evidence-acceptance-slice');
  assert.equal(report.productionThreshold, null);
  assert.match(report.caveat, /baseline/i);
  assert.equal(report.lexicalNamespaceId, '6aba6e8a20610ece73a028ed4dd9e64aefaaff3eec3f9a8bb56fd33c3bdfb144');
  assert.equal(report.environment.node, process.version);
  assert.equal(report.environment.platform, process.platform);
  assert.equal(report.environment.arch, process.arch);

  for (const key of ['sourceSliceBytes', 'normalizedProjectionBytes', 'runtimeArtifactBytes', 'surfaceIndexBytes', 'runtimeModuleBytes']) {
    assert.ok(Number.isInteger(report[key]) && report[key] > 0, key);
  }
  assert.equal(report.coldInitializationIncludesArtifactParse, true);
  assert.ok(Number.isFinite(report.coldInitializationMs) && report.coldInitializationMs >= 0);
  assert.ok(Number.isFinite(report.retainedHeapDeltaBytes));
  assert.ok(Number.isFinite(report.firstLookupMs) && report.firstLookupMs >= 0);

  assert.ok(Number.isInteger(report.repeatedLookup.operations) && report.repeatedLookup.operations > 0);
  assert.ok(Number.isFinite(report.repeatedLookup.totalMs) && report.repeatedLookup.totalMs >= 0);
  assert.ok(Number.isFinite(report.repeatedLookup.meanMicros) && report.repeatedLookup.meanMicros >= 0);
  assert.ok(Number.isFinite(report.repeatedLookup.opsPerSecond) && report.repeatedLookup.opsPerSecond > 0);

  assert.equal(report.candidateDecode.includesSurfaceIndexSearch, true);
  assert.ok(Number.isInteger(report.candidateDecode.operations) && report.candidateDecode.operations > 0);
  assert.ok(Number.isFinite(report.candidateDecode.meanMicros) && report.candidateDecode.meanMicros >= 0);

  assert.ok(Number.isInteger(report.observableLoadCopies.count) && report.observableLoadCopies.count > 0);
  assert.ok(Number.isInteger(report.observableLoadCopies.bytes) && report.observableLoadCopies.bytes > 0);
  assert.equal(report.observableLoadCopies.internalRuntimeCopiesObserved, false);
});
