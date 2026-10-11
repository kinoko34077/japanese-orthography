import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareSearchKeys,makeSyntheticSymbols,assertSearchKeys,type SearchKey
} from '../tools/rule-search-index-lab.ts';

const keys:SearchKey[]=[
  {sequenceId:10,symbols:[1],postings:[{stage:0,direction:0,channel:0,programs:[7]}]},
  {sequenceId:11,symbols:[1,2],postings:[{stage:0,direction:0,channel:0,programs:[8,9]},
    {stage:4,direction:1,channel:1,programs:[99]}]},
  {sequenceId:12,symbols:[2],postings:[{stage:4,direction:1,channel:0,programs:[15]}]},
  {sequenceId:13,symbols:[1,2,1],postings:[{stage:4,direction:1,channel:0,programs:[5]}]},
  {sequenceId:14,symbols:[3,1],postings:[{stage:0,direction:0,channel:0,programs:[10]}]}
];
const finder=new Map(keys.map(k=>[k.symbols.join(','),k.sequenceId]));
const make=()=>compareSearchKeys(keys,s=>finder.get(s.join(','))??-1);

test('#321 preserves exact candidate order, offsets, SequenceId and each stage/direction/channel posting',()=>{
  const matcher=make();
  const stream=[3,1,2,1,2,5,1];
  const a=matcher.baseline(stream);
  const b=matcher.trie(stream);
  assert.deepEqual(b,a);
  assert.deepEqual(b.map(x=>[x.start,x.end,x.sequenceId]),[
    [0,2,14],[1,2,10],[1,3,11],[1,4,13],
    [2,3,12],[3,4,10],[3,5,11],[4,5,12],[6,7,10]
  ]);
  assert.deepEqual(b.find(x=>x.sequenceId===11)?.postings[1]?.programs,[99]);
  assert.equal(matcher.parity(stream).candidates,b.length);
});

test('#321 overlapping prefix and identical program outputs do not collapse different source keys',()=>{
  const m=make();
  assert.deepEqual(m.baseline([1,2,1]),m.trie([1,2,1]));
  assert.deepEqual(m.trie([1,2,1]).map(x=>x.sequenceId),[10,11,13,12,10]);
});

test('#321 fully unknown token streams are empty, bounded synthetic tokens are reproducible',()=>{
  const m=make();
  assert.deepEqual(m.trie([999,999,999]),[]);
  assert.equal(m.parity([999,999,999]).candidates,0);
  const a=makeSyntheticSymbols(keys,250);
  const b=makeSyntheticSymbols(keys,250);
  assert.equal(a.length,250);
  assert.deepEqual(a,b);
  assert.deepEqual(m.baseline(a),m.trie(a));
  assert.throws(()=>makeSyntheticSymbols(keys,10001),/invalid/);
});

test('#321 rejects duplicate SequenceId, divergent identical sequence and invalid tokens',()=>{
  assert.throws(()=>assertSearchKeys([...keys,keys[0]!]),/duplicate/);
  assert.throws(()=>compareSearchKeys([...keys,{sequenceId:50,symbols:[1,2],postings:[]}],()=>-1),/duplicate SymbolId sequence/);
  assert.throws(()=>make().parity([NaN]),/invalid/);
  assert.throws(()=>make().parity([-1]),/invalid/);
});
