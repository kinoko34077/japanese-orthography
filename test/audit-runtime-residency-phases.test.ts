import assert from 'node:assert/strict';
import test from 'node:test';
import { phaseMemoryDeltas,measureBoundedRuntimeResidency } from '../tools/audit-runtime-residency-phases.ts';

const mem=(n:number)=>({rss:500+n,heapUsed:100+n,heapTotal:200+n,external:80+n,arrayBuffers:20+n});
const sample={
  packDigest:'a'.repeat(64),inputSha256:'b'.repeat(64),
  memoryBefore:mem(0),profileId:'kinotch-fixed',packSource:'published',
  cases:[
    {case:'cold',inputSha256:'b',outputSha256:'c',wallMs:1000,fetchedSections:7,fetchedBytes:5000,memoryAfter:mem(200)},
    {case:'warm-repeat',inputSha256:'b',outputSha256:'c',wallMs:50,fetchedSections:0,fetchedBytes:0,memoryAfter:mem(130)},
    {case:'warm-new-text',inputSha256:'d',outputSha256:'e',wallMs:80,fetchedSections:2,fetchedBytes:500,memoryAfter:mem(160)}
  ]
};
test('#335 computes sequential RSS/JS/ArrayBuffer deltas, preserving negative GC deltas',()=>{
  const x=phaseMemoryDeltas(sample);
  assert.deepEqual(x.phases.map(p=>p.deltaFromPrevious.rss),[200,-70,30]);
  assert.deepEqual(x.phases.map(p=>p.deltaFromProcessBefore.arrayBuffers),[200,130,160]);
  assert.deepEqual(x.phases.map(p=>p.fetchedBytes),[5000,0,500]);
  assert.equal(x.packDigest,sample.packDigest);
});
test('#335 refuses missing phase, non-finite process metrics and malformed source',()=>{
  assert.throws(()=>phaseMemoryDeltas({...sample,cases:sample.cases.slice(0,2)}),/invalid bounded/);
  assert.throws(()=>phaseMemoryDeltas({...sample,memoryBefore:{...mem(0),rss:NaN}}),/invalid memory/);
  assert.throws(()=>phaseMemoryDeltas({...sample,cases:[
    {...sample.cases[0]!,case:'warm-repeat'},...sample.cases.slice(1)]}),/unexpected measurement phase/);
});
test('#335 rejects unbounded inputs before launching subprocesses',()=>{
  assert.throws(()=>measureBoundedRuntimeResidency([0]),/invalid benchmark/);
  assert.throws(()=>measureBoundedRuntimeResidency([100001]),/invalid benchmark/);
  assert.throws(()=>measureBoundedRuntimeResidency([250],'unknown'),/invalid benchmark/);
});
