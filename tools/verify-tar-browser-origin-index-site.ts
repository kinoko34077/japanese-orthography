/** #349 P10b3c1: 非公開site生成物の正規固定TAR index同一性をCIで検証する。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixedTarBrowserOriginIndex } from './build-tar-browser-origin-index-s3e2.ts';
import type { BrowserPackManifestV1 } from './browser-pack-model.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const site=resolve(root,'dist-site/browser-pack');
const manifest=JSON.parse(await readFile(resolve(site,'manifest.json'),'utf8')) as BrowserPackManifestV1;
const actual=await readFile(resolve(site,'tar-origin-index.json'));
const compiled=await buildFixedTarBrowserOriginIndex(root,manifest);
assert.equal(actual.toString('utf8'),compiled.bytes.toString('utf8'),
  '配信用TAR枝対応表は受入済み原典・正規IR/Programから再生成したbytesと一致');
const sha256=createHash('sha256').update(actual).digest('hex');
assert.equal(sha256,compiled.sha256);
const index=JSON.parse(actual.toString('utf8')) as typeof compiled.index;
assert.equal(index.sourceCommit,'198f8560613d23417cb0f87172ae8662e722ca30');
assert.equal(index.packDigest,manifest.packDigest);
assert.equal(index.branchCount,123);
assert.equal(index.editableOriginCount,126);
assert.equal(index.rows.length,123);
assert.equal(index.rows.filter(r=>r.kind==='candidate').length,120);
assert.equal(index.rows.filter(r=>r.kind==='shared-output').length,3);
assert.equal(new Set(index.rows.map(r=>`${r.programId}:${r.branchOrdinal}`)).size,123);
assert.equal(new Set(index.rows.flatMap(r=>r.editableEntryKeys)).size,126);
console.log(JSON.stringify({
  kind:'fixed-tar-browser-origin-index-generated',
  sha256,bytes:actual.byteLength,
  sourceCommit:index.sourceCommit,irDigest:index.irDigest,
  packDigest:index.packDigest,programDigest:index.programDigest,
  rows:index.branchCount,editableOrigins:index.editableOriginCount,
  independentRuntimeHashPinEstablished:false,
  runtimeOriginAuthenticated:false,publishedSiteBytesVerified:false
}));
