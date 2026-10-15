import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createClosedTarOriginAudit } from '../tools/tar-closed-origin-audit-s3e2.ts';
import type { RuleIR } from '../tools/rule-ir.ts';
import type { BrowserPackManifestV1 } from '../tools/browser-pack-model.ts';

const pin = '198f8560613d23417cb0f87172ae8662e722ca30';
const manifest = JSON.parse(await readFile(
  new URL('../data/browser-pack-v3/manifest.json', import.meta.url), 'utf8'
)) as BrowserPackManifestV1;
// 実配信sectionファイルを追加・捏造せず、真正性の失敗を先に監査する。
const fakeIr = { digest: 'a'.repeat(64), rules: [] } as unknown as RuleIR;
const fakePrograms = { count: 0 } as Parameters<typeof createClosedTarOriginAudit>[0]['programs'];

test('#349 P10b2b1 固定原典の不一致はPack実bytesへ到達する前に拒否', async () => {
  let requests = 0;
  const sectionProvider = async () => {
    requests += 1;
    throw new Error('unverified Pack section must never be requested');
  };
  const args = {
    manifest, expectedPackDigest: manifest.packDigest,
    sectionProvider, ir: fakeIr, programs: fakePrograms
  };
  await assert.rejects(createClosedTarOriginAudit({
    ...args, sidecar: { sourceCommit: 'untrusted', irDigest: fakeIr.digest, rows: [] }
  }), /fixed source or IR identity drift/);
  await assert.rejects(createClosedTarOriginAudit({
    ...args, sidecar: { sourceCommit: pin, irDigest: '0'.repeat(64), rows: [] }
  }), /fixed source or IR identity drift/);
  assert.equal(requests, 0, '原典の一致前に外部providerへデータ取得しない');
});

test('#349 P10b2b1 Pack digestの独立lock不一致は物理section読込前に拒否', async () => {
  let requests = 0;
  await assert.rejects(createClosedTarOriginAudit({
    manifest, expectedPackDigest: '0'.repeat(64), ir: fakeIr, programs: fakePrograms,
    sidecar: { sourceCommit: pin, irDigest: fakeIr.digest, rows: [] },
    sectionProvider: async () => {
      requests += 1;
      throw new Error('unverified section fetch');
    }
  }), /Pack identity not admitted by independent lock/);
  assert.equal(requests, 0);
});
