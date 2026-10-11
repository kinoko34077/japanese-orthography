import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { deterministicPeerShadowMask, type PeerSpan } from '../tools/occurrence-peer-index-poc.ts';

const require = createRequire(import.meta.url);
const { arbitrate } = require('../runtime/occurrence-arbitration.js');

/** 現行arbitrate()内の全件any比較を保持したテスト用oracle。 */
const currentMask = (live: readonly PeerSpan[]) => live.map(candidate =>
  candidate.candidate === true && live.some(other =>
    other !== candidate && other.candidate !== true
    && other.start === candidate.start && other.end === candidate.end));

test('#347 同一span・異span・candidate-only・同じ値の重複でも現行全件検索と同値', () => {
  const cases: PeerSpan[][] = [
    [{start:0,end:1,candidate:true}],
    [{start:0,end:1,candidate:true},{start:0,end:1,candidate:true}],
    [{start:0,end:1,candidate:true},{start:0,end:1,candidate:false}],
    [{start:0,end:1,candidate:true},{start:0,end:2,candidate:false}],
    [{start:0,end:2,candidate:true},{start:1,end:2,candidate:false}],
    [{start:0,end:2,candidate:true},{start:0,end:2}],
    [{start:2,end:5,candidate:true},{start:2,end:5,candidate:false},{start:2,end:5,candidate:true}],
  ];
  for (const rows of cases) assert.deepEqual(deterministicPeerShadowMask(rows),currentMask(rows));
});

test('#347 幅広い分散span・重複・同一区間境界について決定的oracleと全件一致', () => {
  const rows = Array.from({length:720},(_,i)=>({
    start:i%103, end:i%103+1+(i%5), candidate:i%4===0
  }));
  assert.deepEqual(deterministicPeerShadowMask(rows),currentMask(rows));
  assert.deepEqual(deterministicPeerShadowMask([...rows].reverse()),
    currentMask([...rows].reverse()));
});

test('#347 正常化されない不正区間は拒否し、同じ表示キーへの衝突を起こさない', () => {
  assert.throws(()=>deterministicPeerShadowMask([{start:-1,end:1}]),/invalid span/);
  assert.throws(()=>deterministicPeerShadowMask([{start:2,end:2}]),/invalid span/);
  assert.throws(()=>deterministicPeerShadowMask([{start:Number.NaN,end:2}]),/invalid span/);
  const rows=[{start:1,end:23,candidate:true},{start:12,end:3,candidate:false}];
  assert.throws(()=>deterministicPeerShadowMask(rows),/invalid span/);
});

test('#347 本番arbitrate同一span確定候補とcandidate-only曖昧性の現行契約を固定', () => {
  const c=(key:string,candidate:boolean,output:string)=>({
    key,start:0,end:2,output,candidate,policy:'anywhere'
  });
  const withDeterministic=arbitrate({length:2,lexical:null,candidates:[
    c('alternative',true,'乙'),c('deterministic',false,'甲')
  ]});
  assert.deepEqual(withDeterministic.accepted.map((x:any)=>x.key),['deterministic']);
  assert.ok(withDeterministic.blocked.some((x:any)=>x.candidate.key==='alternative'
    && x.reason==='candidate_alternative'));
  const candidateOnly=arbitrate({length:2,lexical:null,candidates:[
    c('candidate-a',true,'甲'),c('candidate-b',true,'乙')
  ]});
  assert.ok(!candidateOnly.blocked.some((x:any)=>x.reason==='candidate_alternative'));
  assert.equal(candidateOnly.unresolved.length,1);
});


test('#347 production適応閾値を跨ぐ大量分散spanでも同じ出力・blocked理由になる', () => {
  const make=(count:number)=>{
    const candidates=[] as Array<{key:string;start:number;end:number;output:string;candidate:boolean;policy:string}>;
    for(let i=0;i<count;i++){
      const start=i*2;
      candidates.push({key:'det-'+i,start,end:start+1,output:'甲',candidate:false,policy:'anywhere'});
      candidates.push({key:'alt-'+i,start,end:start+1,output:'乙',candidate:true,policy:'anywhere'});
    }
    return candidates;
  };
  for(const count of [40,128,300]) {
    const rows=make(count);
    const out=arbitrate({length:count*2,lexical:null,candidates:rows});
    assert.equal(out.accepted.length,count);
    assert.ok(out.accepted.every((r:any)=>r.key.startsWith('det-')));
    assert.equal(out.blocked.length,count);
    assert.ok(out.blocked.every((r:any)=>r.reason==='candidate_alternative'
      && r.candidate.key.startsWith('alt-')));
    assert.deepEqual(out.unresolved,[]);
    const reversed=arbitrate({length:count*2,lexical:null,candidates:[...rows].reverse()});
    assert.deepEqual(reversed,out);
  }
});

test('#347 同一span候補のみ・異span孤立候補の意味論を閾値以上でも保存',()=>{
  const candidates=Array.from({length:270},(_,i)=>({
    key:'candidate-'+i,start:i*2,end:i*2+1,output:'甲',candidate:true,policy:'anywhere'
  }));
  const result=arbitrate({length:540,lexical:null,candidates});
  assert.equal(result.accepted.length,270);
  assert.deepEqual(result.blocked,[]);
  assert.deepEqual(result.unresolved,[]);
});
