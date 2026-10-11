import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { maskCertifiedCandidatesBeforeArbitration, type CertifiedBranch } from '../tools/tar-origin-candidate-mask-s3e1.ts';

const require = createRequire(import.meta.url);
const planner = require('../runtime/browser-span-planner.js');
const sourceCommit = '198f8560613d23417cb0f87172ae8662e722ca30';
const irDigest = 'a'.repeat(64);
const entryA = JSON.stringify([sourceCommit, 'structured', 'transform-settings (8).json', 'entry-a']);
const entryB = JSON.stringify([sourceCommit, 'structured', 'transform-settings (8).json', 'entry-b']);
const row = {
  programId: 9, canonicalRuleId: 'rule:tar:sample', input: 'あ',
  output: '甲', kind: 'candidate' as const,
  editableEntryKeys: [entryA], evidenceOnlyKeys: [],
  sourceCaseIds: ['case-a'], provenancePriority: 10
};
const shared = {
  ...row, programId: 10, canonicalRuleId: 'rule:tar:shared',
  kind: 'shared-output' as const,
  output: '丙', editableEntryKeys: [entryA,entryB],
  sourceCaseIds: ['case-a','case-b'], provenancePriority:null
};
const makeProof=(r:typeof row|typeof shared):CertifiedBranch=>({
  sourceCommit,irDigest, programId:r.programId,canonicalRuleId:r.canonicalRuleId,
  input:r.input,output:r.output, stage:'profile',direction:'to-modern',
  channel:'surface',editableEntryKeys:[...r.editableEntryKeys]
});
const makeCandidate = (key:string, output:string, precedence:number, programId:number,
  certifiedOrigin?:CertifiedBranch)=>({
  key,output,precedence, start:0,end:1,policy:'anywhere',
  origin:'program',ref:'program:'+programId,programIds:[programId],
  stage:'profile',direction:'to-modern',channel:'surface',certifiedOrigin
});
const render=(candidates:readonly ReturnType<typeof makeCandidate>[]) =>
  planner.assemble('あ','kinotch-fixed',planner.lexicalDag(1,[],[[0,1]]),[...candidates],[],{}).renderedText;

test('#349 S3-E1 有効高優先枝を候補生成後・調停前にOFFすると下位候補が復帰',()=>{
  const high=makeCandidate('high','甲',10,9,makeProof(row));
  const low=makeCandidate('low','乙',1,99);
  assert.equal(render([high,low]),'甲');
  const sidecar={sourceCommit,irDigest,rows:[row]};
  const output=maskCertifiedCandidatesBeforeArbitration('あ',[high,low],sidecar,
    {[entryA]:true},{[entryA]:false});
  assert.deepEqual(output.blockedKeys,['high']);
  assert.deepEqual(output.unsupported,[]);
  assert.deepEqual(output.candidates.map(x=>x.key),['low']);
  assert.equal(render(output.candidates),'乙');
  assert.equal(render(maskCertifiedCandidatesBeforeArbitration('あ',[high,low],sidecar,
    {[entryA]:true}).candidates),'甲');
});

test('#349 S3-E1 同一出力へ複数編集元が合流したORとsourceLockの優先',()=>{
  const high=makeCandidate('shared','丙',10,10,makeProof(shared));
  const low=makeCandidate('low','乙',1,99);
  const sidecar={sourceCommit,irDigest,rows:[shared]};
  const oneOn=maskCertifiedCandidatesBeforeArbitration('あ',[high,low],sidecar,
    {[entryA]:true,[entryB]:true},{[entryA]:false});
  assert.equal(render(oneOn.candidates),'丙');
  const bothOff=maskCertifiedCandidatesBeforeArbitration('あ',[high,low],sidecar,
    {[entryA]:true,[entryB]:true},{[entryA]:false,[entryB]:false});
  assert.equal(render(bothOff.candidates),'乙');
  const parentSourceDenied=maskCertifiedCandidatesBeforeArbitration('あ',[high,low],sidecar,
    {[entryA]:false,[entryB]:false},{[entryA]:true,[entryB]:true});
  assert.equal(render(parentSourceDenied.candidates),'乙');
});

test('#349 S3-E1 provenance未認証・多重Program・変形出力を勝手に削除しない',()=>{
  const sidecar={sourceCommit,irDigest,rows:[row]};
  const verified=makeCandidate('verified','甲',10,9,makeProof(row));
  const unknown=makeCandidate('unknown','甲',10,9);
  const union={...verified,key:'union',programIds:[9,77]};
  const changed={...verified,key:'adapted',output:'甲っ'};
  const wrongProfile={...verified,key:'different-stage',stage:'orthographic'};
  const result=maskCertifiedCandidatesBeforeArbitration('あ',
    [unknown,union,changed,wrongProfile],sidecar,
    {[entryA]:true},{[entryA]:false});
  assert.equal(result.blockedKeys.length,0);
  assert.deepEqual(result.candidates.map(x=>x.key),
    ['unknown','union','adapted','different-stage']);
  assert.deepEqual(result.unsupported.map(x=>x.reason),
    ['uncertified_origin','branch_proof_mismatch','branch_proof_mismatch','branch_proof_mismatch']);
  assert.equal(render([unknown]),'甲');
});

test('#349 S3-E1 不明設定・profile eligibility欠落・枝重複を明示拒否',()=>{
  const high=makeCandidate('high','甲',10,9,makeProof(row));
  const sidecar={sourceCommit,irDigest,rows:[row]};
  assert.throws(()=>maskCertifiedCandidatesBeforeArbitration('あ',[high],
    {...sidecar,sourceCommit:'unknown'}, {[entryA]:true}),/source\/digest invalid/);
  assert.deepEqual(maskCertifiedCandidatesBeforeArbitration('あ',
    [{...high,certifiedOrigin:{...makeProof(row),editableEntryKeys:null} as unknown as CertifiedBranch}],
    sidecar,{[entryA]:true},{[entryA]:false}).unsupported.map(x=>x.reason),
    ['branch_proof_mismatch']);
  assert.throws(()=>maskCertifiedCandidatesBeforeArbitration('あ',[high],sidecar,{}),
    /missing\/unknown immutable eligibility/);
  assert.throws(()=>maskCertifiedCandidatesBeforeArbitration('あ',[high],sidecar,
    {[entryA]:true},{unknown:false}),/unknown\/invalid user override/);
  assert.throws(()=>maskCertifiedCandidatesBeforeArbitration('あ',[high],
    {...sidecar,rows:[row,row]},{[entryA]:true}),/duplicate sidecar branch/);
});
