/**
 * #349 P10b2b-1: Verifyが既に非公開で生成した実BrowserPack v3を使用するpositive E2E。
 * 通常のnpm testでは187MBのPackを再生成しない。build:site直後のUbuntu job限定。
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

let inspected = 0;
let matched = 0;
const samples = [...new Set(sidecar.rows.map(row => row.input))];
for (const sample of samples) {
  inspected += 1;
  const result = auditor.inspect(sample, 'kinotch-fixed', {
    stages: ['profile'], directions: ['to-modern'], channels: ['surface']
  });
  matched += result.filter((row: {status:string}) => row.status === 'matched').length;
  if (matched >= 3) break;
}
assert.ok(matched > 0, '再生成した実Packから固定TAR認証済み枝の生候補が出ること');
console.log(JSON.stringify({
  kind: 'tar-closed-origin-audit-generated-pack-positive-e2e',
  packDigest: auditor.packDigest, irDigest: auditor.irDigest,
  verifiedBranches: auditor.verifiedBranches,
  inspectedInputs: inspected, matchedBranches: matched,
  runtimeOriginAuthenticated: auditor.runtimeOriginAuthenticated,
  publishedSiteBytesVerified: false
}));
