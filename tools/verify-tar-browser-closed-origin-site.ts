/** #349 P10b3c2：非公開ビルドPack＋独立SHA pin済原典を同一実VMに結合する正経路。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import type { BrowserPackManifestV1 } from './browser-pack-model.ts';

const root=fileURLToPath(new URL('..',import.meta.url));
const dir=resolve(root,'dist-site/browser-pack');
const manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8')) as BrowserPackManifestV1;
const indexBytes=await readFile(resolve(dir,'tar-origin-index.json'));
const original=JSON.parse(indexBytes.toString('utf8')) as {
  rows:Array<{input:string;programId:number;branchOrdinal:number;editableEntryKeys:string[]}>
};
const {openFixedTarOriginClosure}=createRequire(import.meta.url)('../runtime/browser-tar-origin-closure.js');
let sectionLoads=0;
const sectionProvider=async(section:{path:string})=>{
  sectionLoads++;
  return readFile(resolve(dir,section.path));
};
const auditor=await openFixedTarOriginClosure(manifest,sectionProvider,indexBytes);
assert.equal(auditor.auditedBranches,123);
assert.equal(auditor.editableOriginCount,126);
assert.equal(auditor.runtimeOriginAuthenticated,false);
const observed=new Set<string>();
let matches=0;
let unsupported=0;
const inputs=[...new Set(original.rows.map(row=>row.input))];
for(const input of inputs){
  const results=auditor.inspect(input,'kinotch-fixed',{
    stages:['profile'], directions:['to-modern'], channels:['surface']
  }) as Array<{status:string;programId?:number;branchOrdinal?:number;editableEntryKeys?:readonly string[]}>;
  for(const result of results){
    if(result.status!=='matched'){unsupported++;continue;}
    assert.ok(result.editableEntryKeys?.length,'原典可編集keyを保持');
    observed.add(result.programId+':'+result.branchOrdinal);
    matches++;
  }
}
assert.equal(inputs.length,63);
assert.equal(observed.size,123,'実Pack・原典独立SHA・実VM元candidateで123枝実照合');
assert.equal(matches,123);
let attemptedBad=0;
const corrupted=Buffer.from(indexBytes);
corrupted[10]=(corrupted[10] ?? 0)^1;
await assert.rejects(openFixedTarOriginClosure(manifest,async()=>{
  attemptedBad++;
  throw new Error('index must be rejected before Pack sections');
},corrupted),/independent index digest mismatch/);
assert.equal(attemptedBad,0);
const badManifest={...manifest,packDigest:'0'.repeat(64)};
await assert.rejects(openFixedTarOriginClosure(badManifest,async()=>{
  attemptedBad++;
  throw new Error('bad Pack manifest rejected before sections');
},indexBytes),/independent accepted identity mismatch/);
assert.equal(attemptedBad,0);
console.log(JSON.stringify({
  kind:'fixed-tar-browser-closed-origin-generated-pack-positive-e2e',
  sha256:'500fa882847aa1ac8e8f1cbb1f619527f28e1608819e1105adb5233a3c5d102e',
  scannedInputs:inputs.length,observedDistinctBranches:observed.size,
  matchedCandidates:matches,unsupportedCandidates:unsupported,
  sectionLoads,indexTamperRejected:true,foreignPackRejected:true,
  runtimeOriginAuthenticated:auditor.runtimeOriginAuthenticated,
  publishedSiteBytesVerified:false,publicWorkerMaskEnabled:false
}));
