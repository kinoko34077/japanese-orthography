import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { auditTarBranchProvenance, sourceEntryKey } from '../tools/audit-tar-branch-provenance.ts';
import {
  enabledSharedOutputBranches, joinSharedOutputEditableOrigins, type SharedOutputOrigin
} from '../tools/tar-shared-output-or.ts';

const sourceKey=(id:string)=>sourceEntryKey({kind:'structured',path:'transform-settings (8).json',sourceId:id});
const a=sourceKey('entry-one'), b=sourceKey('entry-two');
const flat=sourceEntryKey({kind:'flat',path:'supplementary-evidence.json',locator:'groups[0].entries[0]'});
const rows: SharedOutputOrigin[] = [{
  programId:15,canonicalRuleId:'rule:fixed',input:'漢字',output:'異體',
  sourceCaseIds:['tar:structured:entry-one:from[0]','tar:structured:entry-two:from[1]'],
  sourceKeys:[a,flat,b]
}];
const permit={ [a]:true,[b]:true };

test('#344 two editable origins share one output; evidence-only flat source cannot resurrect OFF branches',()=>{
  const join=joinSharedOutputEditableOrigins(rows[0]!);
  assert.equal(join.caseJoins.length,2);
  assert.deepEqual(join.editableKeys,[a,b].sort());
  assert.deepEqual(join.evidenceOnlyKeys,[flat]);
  const all=enabledSharedOutputBranches(rows,permit);
  assert.deepEqual(all.map(x=>x.output),['異體']);
  assert.deepEqual(all[0]!.activeSourceKeys,[a,b].sort());
  assert.deepEqual(all[0]!.evidenceOnlySourceKeys,[flat]);
  assert.deepEqual(enabledSharedOutputBranches(rows,permit,{[a]:false})[0]!.activeSourceKeys,[b]);
  assert.deepEqual(enabledSharedOutputBranches(rows,permit,{[b]:false})[0]!.activeSourceKeys,[a]);
  assert.deepEqual(enabledSharedOutputBranches(rows,permit,{[a]:false,[b]:false}),[]);
  assert.deepEqual(enabledSharedOutputBranches(rows,permit,{[a]:null,[b]:null}),all);
  assert.throws(()=>enabledSharedOutputBranches(rows,permit,{[flat]:true}),/unknown editable entry/);
});

test('#344 profile/sourceLock and parent deny are not overridden by user ON',()=>{
  assert.deepEqual(enabledSharedOutputBranches(rows,{[a]:false,[b]:true},{[a]:true})[0]!.activeSourceKeys,[b]);
  assert.deepEqual(enabledSharedOutputBranches(rows,{[a]:false,[b]:false},{[a]:true,[b]:true}),[]);
  assert.throws(()=>enabledSharedOutputBranches(rows,{[a]:true}),/missing eligibility/);
});

test('#344 malformed case, duplicate or unknown origin fail-closed, rather than mask a whole Program',()=>{
  assert.throws(()=>enabledSharedOutputBranches(rows,permit,{'unknown':false}),/unknown editable entry/);
  assert.throws(()=>enabledSharedOutputBranches(rows,{...permit,unknown:true}),/unknown entry eligibility/);
  assert.throws(()=>joinSharedOutputEditableOrigins({...rows[0]!,sourceKeys:[a,a,b]}),/cardinality unproven/);
  assert.throws(()=>joinSharedOutputEditableOrigins({...rows[0]!,sourceCaseIds:['a','a']}),/cardinality unproven/);
  assert.throws(()=>joinSharedOutputEditableOrigins({...rows[0]!,sourceKeys:[a,b,sourceKey('entry-extra')]}),/unexpected additional structured origin/);
  assert.throws(()=>joinSharedOutputEditableOrigins({...rows[0]!,sourceCaseIds:
    ['tar:structured:entry-one:from[0]','tar:structured:entry-missing:from[0]']}),/join ambiguous\/missing/);
  assert.throws(()=>enabledSharedOutputBranches([rows[0]!,{...rows[0]!,canonicalRuleId:'different'}],permit),/mapped twice/);
});

test('#344 fixed TAR shared-output 3 records have two editable structured cases plus evidence-only flat refs',async()=>{
  const report=await auditTarBranchProvenance(fileURLToPath(new URL('..',import.meta.url)));
  assert.equal(report.simpleSharedRelations,3);
  const shared=report.simpleShared;
  const joins=shared.map(joinSharedOutputEditableOrigins);
  assert.deepEqual(joins.map(x=>x.editableKeys.length),[2,2,2]);
  assert.deepEqual(joins.map(x=>x.evidenceOnlyKeys.length),[1,1,1]);
  const eligible=Object.fromEntries(joins.flatMap(x=>x.editableKeys.map(key=>[key,true])));
  const selected=enabledSharedOutputBranches(shared,eligible);
  assert.equal(selected.length,3);
  const first=joins[0]!.editableKeys;
  assert.equal(enabledSharedOutputBranches(shared,eligible,{[first[0]!]:false}).length,3);
  assert.equal(enabledSharedOutputBranches(shared,eligible,{[first[0]!]:false,[first[1]!]:false}).length,2);
});
