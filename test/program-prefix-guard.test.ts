import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createIndexPrefixGuard } = require('../runtime/sequence-pool-runtime.js');

const source = new Map<number, number[]>([
  [1, [1]], [2, [1, 2]], [3, [1, 2, 9]], [4, [0, 65536]],
  [5, [1, 0]], [6, [8, 8, 8]], [7, []]
]);
const guard = createIndexPrefixGuard([...source.keys()], (id:number)=>source.get(id)!);

test('#325 does not omit any prefix of indexed raw Program lookup sequence',()=>{
  for(const symbols of source.values()) {
    assert.equal(guard.mayContain(symbols.length,symbols[0],symbols[1]),true);
  }
  assert.equal(guard.singleSymbols,1);
  assert.ok(guard.prefixGroups>=3);
});

test('#325 rejects impossible prefix but keeps other candidate lengths and context path',()=>{
  assert.equal(guard.mayContain(1,2),false);
  assert.equal(guard.mayContain(2,1,9),false);
  assert.equal(guard.mayContain(3,1,2),true); // 短いprefixのみで絞る。実際のsuffixは従来のpool.findが判断。
  assert.equal(guard.mayContain(2,0,65536),true);
  assert.equal(guard.mayContain(2,1,0),true);
  assert.equal(guard.mayContain(2,1,65536),false);
  assert.equal(guard.mayContain(0),true); // 空keyは保守的に旧経路を維持。
  // basic_form/kana同値候補はraw prefix判定の対象外。別のpool.findを実行し続ける。
});

test('#325 works with empty index without inventing candidates',()=>{
  const empty=createIndexPrefixGuard([],()=>{throw Error('should not access');});
  assert.equal(empty.mayContain(1,100),false);
  assert.equal(empty.mayContain(4,100,101),false);
});
