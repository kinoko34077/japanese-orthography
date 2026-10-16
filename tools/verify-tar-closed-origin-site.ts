/**
 * #349 P10b2b-1: Verifyが既に非公開で生成した実BrowserPack v3を使用するpositive E2E。
 * 通常のnpm testでは187MBのPackを再生成しない。build:site直後のUbuntu job限定。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createClosedTarOriginAudit } from './tar-closed-origin-audit-s3e2.ts';
import { auditTarOriginSidecar } from './tar-origin-sidecar-s3e0.ts';
import { normalizeAcceptedOrthographySources, assertNoSilentSourceDrop } from './orthography-source-normalization.ts';
import { withProfileRules } from './orthography-policy.ts';
import { compileRuleIR } from './rule-ir.ts';
import { compilePrograms } from './rule-program-compiler.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from './symbol-registry.ts';
import type { BrowserPackManifestV1 } from './browser-pack-model.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = resolve(root, 'dist-site/browser-pack');
const manifest = JSON.parse(await readFile(resolve(out, 'manifest.json'), 'utf8')) as BrowserPackManifestV1;
const report = JSON.parse(await readFile(resolve(root, 'data/reports/browser-pack-v3-compiled.json'), 'utf8')) as {packDigest:string};
assert.equal(manifest.packDigest, report.packDigest, '生成物と独立受入済みPack lockを照合');

const {openFixedTarPack} = createRequire(import.meta.url)('../runtime/browser-tar-pack-lock.js');
const fixedBrowser = await openFixedTarPack(manifest,
  async (section:{path:string}) => readFile(resolve(out, section.path)));
assert.equal(fixedBrowser.packDigest, report.packDigest);
assert.equal(fixedBrowser.runtimeOriginAuthenticated, false);
assert.equal(fixedBrowser.verifiedHotSectionIds.length, 7);
assert.equal(fixedBrowser.isSameVerifiedPack(fixedBrowser.pack), true);
assert.equal(fixedBrowser.isSameVerifiedPack({packDigest:report.packDigest}), false,
  '値だけを合わせた偽Packを承認しない');
await assert.rejects(openFixedTarPack(manifest, async (section:{path:string;sectionId:string}) => {
  const bytes=await readFile(resolve(out, section.path));
  if(section.sectionId==='symbol-registry') bytes[0]=(bytes[0] ?? 0)^1;
  return bytes;
}), /digest mismatch/, '実物理hot bytesの改竄は正規ローダーが拒否');
console.log(JSON.stringify({
  kind:'fixed-tar-browser-pack-lock-generated-positive-e2e',
  packDigest:fixedBrowser.packDigest,
  programDigest:fixedBrowser.programDigest,
  verifiedHotSectionCount:fixedBrowser.verifiedHotSectionIds.length,
  sameInstanceOnly:true, tamperedSectionRejected:true,
  runtimeOriginAuthenticated:fixedBrowser.runtimeOriginAuthenticated,
  publishedSiteBytesVerified:false
}));

const sidecar = await auditTarOriginSidecar(root);
const normalized = await normalizeAcceptedOrthographySources(root);
assertNoSilentSourceDrop(normalized);
const full = withProfileRules(normalized.graph);
const ir = compileRuleIR(full);
assert.equal(ir.digest, sidecar.irDigest, '固定TAR sidecarと正規IRの一致');
const registry = JSON.parse(await readFile(resolve(root, SYMBOL_REGISTRY), 'utf8')) as SymbolRegistry;
const refs = [...new Set(full.facts
  .filter(f => f.kind === 'literal_form' || f.kind === 'literal_reading')
  .flatMap(f => f.lexicalRefs))].sort();
const byLexeme = new Map(refs.map((s, i) => [s, i]));
const programs = compilePrograms(ir, registry, ref => byLexeme.get(ref) ?? null);

const auditor = await createClosedTarOriginAudit({
  manifest,
  expectedPackDigest: report.packDigest,
  sectionProvider: async (section) => readFile(resolve(out, section.path)),
  sidecar, ir, programs
});
assert.equal(auditor.verifiedBranches, 123);
assert.equal(auditor.runtimeOriginAuthenticated, false);

// P10b2b-2: 静的123監査枝と「実Packの通常入力経路で実際に観測した枝」を厳密に区別。
const branchKey = (programId: number, output: string) => JSON.stringify([programId, output]);
const auditedKeys = new Set(sidecar.rows.map(row => branchKey(row.programId, row.output)));
assert.equal(auditedKeys.size, auditor.verifiedBranches, '静的監査済み枝の一意性');
const observedKeys = new Set<string>();
let inspected = 0;
let matched = 0;
const samples = [...new Set(sidecar.rows.map(row => row.input))];
for (const sample of samples) {
  inspected += 1;
  const result = auditor.inspect(sample, 'kinotch-fixed', {
    stages: ['profile'], directions: ['to-modern'], channels: ['surface']
  });
  for (const row of result as Array<{
    status: string; entry?: { programId: number; output: string; kind: string }
  }>) {
    if (row.status !== 'matched') continue;
    assert.ok(row.entry, 'matched状態に監査済み枝情報が必要');
    const key = branchKey(row.entry.programId, row.entry.output);
    assert.ok(auditedKeys.has(key), '未監査枝の実行時matchedを禁止');
    observedKeys.add(key);
    matched += 1;
  }
}
assert.ok(matched > 0, '再生成した実Packから固定TAR認証済み枝の生候補が出ること');
assert.ok(observedKeys.size <= auditor.verifiedBranches, '実観測数が固定監査枝数を超えない');
const runtimeUnobservedRows = sidecar.rows.filter(row => !observedKeys.has(
  branchKey(row.programId, row.output)));
const observedCandidateBranches = sidecar.rows.filter(row => row.kind === 'candidate'
  && observedKeys.has(branchKey(row.programId, row.output))).length;
const observedSharedOutputBranches = sidecar.rows.filter(row => row.kind === 'shared-output'
  && observedKeys.has(branchKey(row.programId, row.output))).length;
console.log(JSON.stringify({
  kind: 'tar-closed-origin-audit-generated-pack-positive-e2e',
  packDigest: auditor.packDigest, irDigest: auditor.irDigest,
  verifiedBranches: auditor.verifiedBranches,
  inspectedInputs: inspected, matchedBranches: matched,
  runtimeObservedDistinctBranches: observedKeys.size,
  runtimeUnobservedBranches: runtimeUnobservedRows.length,
  observedCandidateBranches, observedSharedOutputBranches,
  runtimeUnobservedExamples: runtimeUnobservedRows.slice(0, 12).map(row => ({
    programId: row.programId, kind: row.kind, output: row.output
  })),
  // 監査済みの静的123枝と実行時の正規観測数は別：未観測はOFFできる根拠にしない。
  runtimeAllBranchesProven: observedKeys.size === auditor.verifiedBranches,
  runtimeOriginAuthenticated: auditor.runtimeOriginAuthenticated,
  publishedSiteBytesVerified: false
}));
