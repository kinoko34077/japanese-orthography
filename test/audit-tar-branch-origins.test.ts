import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { mapCandidateBranchOrigins, visibleGroupOutputs } from '../tools/audit-tar-branch-origins.ts';

const doc=JSON.parse(await readFile(new URL('../data/migrations/tar/198f8560613d23417cb0f87172ae8662e722ca30/candidate-rules.json',import.meta.url),'utf8'));
const groups=mapCandidateBranchOrigins(doc);

test('#323 maps 120 distinct original candidate cases to 60 output-specific branches',()=>{
  assert.equal(groups.length,60);
  assert.equal(new Set(groups.flatMap(g=>g.branches.map(b=>b.sourceCaseId))).size,120);
  for(const group of groups){
    assert.equal(group.branches.length,2);
    assert.equal(new Set(group.branches.map(b=>b.output)).size,2);
    assert.deepEqual(visibleGroupOutputs(group,()=>true),group.branches.map(b=>b.output));
  }
});

test('#323 one member OFF leaves its counterpart alive; both OFF leaves no candidates',()=>{
  const group=groups[0]!;
  const on=group.branches[1]!.sourceCaseId;
  assert.deepEqual(visibleGroupOutputs(group,id=>id===on),[group.branches[1]!.output]);
  assert.deepEqual(visibleGroupOutputs(group,()=>false),[]);
  assert.deepEqual(visibleGroupOutputs(group,()=>true),group.branches.map(b=>b.output));
});

test('#323 refuses missing group identity and ambiguous duplicate output',()=>{
  const wrong=structuredClone(doc);
  wrong.groups[0].outputs=[wrong.groups[0].outputs[0],wrong.groups[0].outputs[0]];
  assert.throws(()=>mapCandidateBranchOrigins(wrong),/outputs not distinct/);
  const broken=structuredClone(doc);
  broken.records.find((r:any)=>r.id===broken.groups[0].memberRecordIds[0]).candidateGroupId='wrong';
  assert.throws(()=>mapCandidateBranchOrigins(broken),/missing\/wrong member/);
});
