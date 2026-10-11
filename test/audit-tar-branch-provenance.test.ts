import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  resolveCandidateGroupOrigins, enabledCandidateBranches, sourceEntryKey, auditTarBranchProvenance
} from '../tools/audit-tar-branch-provenance.ts';

const refs = [
  {kind:'flat',path:'tongwentang_pref6_current_json/20.json',locator:'groups[0].entries[0]',sourceId:'unstable-ref'},
  {kind:'structured',path:'transform-settings (8).json',locator:'roots[0].entries[2]',sourceId:'entry-test-2'}
];
const group={
  id:'tar:candidate-group:test',input:'いずれ',outputs:['孰','何'],
  sourceCaseIds:['case-a','case-b'],memberRecordIds:['record-a','record-b'],priorities:[0,90]
};
const cases=[
  {id:'record-a',sourceCaseId:'case-a',candidateKind:'same-input-conflict',
    candidateGroupId:group.id,from:'いずれ',expectedOutputs:['孰'],sourceRefs:[refs[0]!],priority:0},
  {id:'record-b',sourceCaseId:'case-b',candidateKind:'same-input-conflict',
    candidateGroupId:group.id,from:'いずれ',expectedOutputs:['何'],sourceRefs:[refs[1]!],priority:90}
];
const ir=[{ruleId:'rule:tar:candidate-group:test',input:'いずれ',
  branches:[{output:'孰',canonicalId:'rule:tar:candidate-group:test'},
    {output:'何',canonicalId:'rule:tar:candidate-group:test'}]}];

test('#327 source entry id is explicitly snapshot-scoped, flat locator does not claim long-term stability',()=>{
  const a=sourceEntryKey(refs[0]!);
  const b=sourceEntryKey(refs[1]!);
  assert.notEqual(a,b);
  assert.ok(a.includes('locator'));
  assert.ok(b.includes('entry-test-2'));
  assert.throws(()=>sourceEntryKey({kind:'structured',path:'x'}),/sourceId missing/);
});

test('#327 one candidate Program can disable each output branch independently without disabling the Program',()=>{
  const provenance=resolveCandidateGroupOrigins([group],cases,ir);
  assert.equal(provenance.length,2);
  assert.equal(provenance[0]?.programId,0);
  const a=provenance.find(r=>r.sourceCaseId==='case-a')!;
  const b=provenance.find(r=>r.sourceCaseId==='case-b')!;
  const available=enabledCandidateBranches(provenance,{});
  assert.deepEqual(available.map(x=>x.output),['何','孰']);
  assert.deepEqual(enabledCandidateBranches(provenance,{[b.entryKey]:false}).map(x=>x.output),['孰']);
  assert.deepEqual(enabledCandidateBranches(provenance,{[a.entryKey]:false}).map(x=>x.output),['何']);
  assert.deepEqual(enabledCandidateBranches(provenance,{[a.entryKey]:false,[b.entryKey]:false}),[]);
  assert.throws(()=>enabledCandidateBranches(provenance,{'unknown':false}),/unknown source entry/);
});

test('#327 rejects mismatched provenance, output ambiguity and alternate Group/IR drift',()=>{
  assert.throws(()=>resolveCandidateGroupOrigins([group],[cases[0]!],ir),/member drift/);
  assert.throws(()=>resolveCandidateGroupOrigins([group],
    [{...cases[0]!,expectedOutputs:['何']},cases[1]!],ir),/branch shared/);
  assert.throws(()=>resolveCandidateGroupOrigins([{...group,outputs:['何','何']}],cases,ir),/ambiguous/);
  assert.throws(()=>resolveCandidateGroupOrigins([group],cases,
    [{...ir[0]!,branches:[{output:'何',canonicalId:'r'},{output:'無',canonicalId:'r'}]}]),/branch outputs changed/);
  assert.throws(()=>resolveCandidateGroupOrigins([group],
    [{...cases[0]!,sourceRefs:[...cases[0]!.sourceRefs,...cases[0]!.sourceRefs]},cases[1]!],ir),
    /multiple editable origins/);
});

test('#327 real accepted TAR candidate groups and shared simple-exact are joinable to fixed canonical IR',async()=>{
  const report=await auditTarBranchProvenance(fileURLToPath(new URL('..',import.meta.url)));
  assert.equal(report.candidateGroups,60);
  assert.equal(report.candidateBranchOrigins,120);
  assert.equal(report.uniqueCandidateEntryKeys,120);
  assert.equal(report.candidateProgramCount,60);
  assert.equal(report.simpleSharedRelations,3);
  assert.equal(report.excludedCandidateCases,1);
  assert.match(report.status,/OR-pending/);
});
