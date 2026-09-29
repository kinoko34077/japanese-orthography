import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("resolver benchmark emits measurable first-slice baseline", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "tools/bench-orthography-resolution.ts", "--json"],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as Record<string, any>;

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scope, "orthography-resolution-first-slice");
  assert.equal(report.productionThreshold, null);
  assert.equal(report.cache, null);
  assert.match(report.caveat, /baseline/i);

  assert.ok(Number.isFinite(report.runtimeModuleBytes) && report.runtimeModuleBytes > 0);
  assert.ok(Number.isFinite(report.fixtureBytes) && report.fixtureBytes > 0);
  assert.ok(Number.isFinite(report.coldInitializationMs) && report.coldInitializationMs >= 0);
  assert.ok(Number.isFinite(report.retainedHeapDeltaBytes));

  assert.ok(Number.isInteger(report.explicitLoadCopies.count) && report.explicitLoadCopies.count > 0);
  assert.ok(Number.isFinite(report.explicitLoadCopies.bytes) && report.explicitLoadCopies.bytes > 0);
  assert.equal(report.explicitLoadCopies.internalRuntimeCopiesObserved, false);

  assert.ok(Number.isInteger(report.resolve.operations) && report.resolve.operations > 0);
  assert.ok(Number.isFinite(report.resolve.totalMs) && report.resolve.totalMs >= 0);
  assert.ok(Number.isFinite(report.resolve.meanMicros) && report.resolve.meanMicros >= 0);
  assert.ok(Number.isFinite(report.resolve.opsPerSecond) && report.resolve.opsPerSecond > 0);

  assert.ok(Number.isInteger(report.transform.inputCharacters) && report.transform.inputCharacters > 0);
  assert.ok(Number.isFinite(report.transform.totalMs) && report.transform.totalMs >= 0);
  assert.ok(Number.isFinite(report.transform.charactersPerSecond) && report.transform.charactersPerSecond > 0);
});
