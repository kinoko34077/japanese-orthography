import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditAcceptedMemoryEnvelope, auditMemoryEnvelope } from '../tools/audit-runtime-memory-envelope.ts';

test('#328 reconciles all section bytes and hot/eager union against accepted digest',async()=>{
  const report=await auditAcceptedMemoryEnvelope(fileURLToPath(new URL('..',import.meta.url)));
  assert.equal(report.sectionCount,1846);
  assert.equal(report.fullRawBytes,187597926);
  assert.equal(report.fullGzipBytes,73238827);
  assert.equal(report.coreRawBytes,16494276);
  assert.ok(report.corePlusEagerRawBytes>=report.coreRawBytes);
  assert.ok(report.corePlusEagerRawBytes>=report.eagerRawBytes);
  assert.ok(report.lexicalRawBytes>0);
  assert.equal(report.corePlusEagerVsTargetBytes,report.corePlusEagerRawBytes-20000000);
  assert.equal(report.note.includes('NOT decoded JS heap'),true);
});

test('#328 fails closed if accepted report and manifest digest differ',()=>{
  assert.throws(()=>auditMemoryEnvelope({
    packDigest:'a'.repeat(64),
    sections:[]
  },{
    packDigest:'b'.repeat(64),
    sizes:{total:0,totalGzip:0,byKind:{},byLoading:{}}
  }),/incompatible pack digest/);
});
