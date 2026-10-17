import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {attachToWorkerScope} = require('../runtime/browser-transform-worker.js');

type Reply = {type:string;requestId?:string;message?:string};
const fixtureScope = (fetchFn?: (url:string)=>Promise<unknown>) => {
  const replies:Reply[] = [];
  const callbacks: Array<(event:{data:Record<string,unknown>})=>Promise<void>> = [];
  const imports:string[][] = [];
  let requests = 0;
  const scope = {
    addEventListener: (type:string, callback:(event:{data:Record<string,unknown>})=>Promise<void>) => {
      assert.equal(type,'message');
      callbacks.push(callback);
    },
    postMessage: (reply:Reply) => { replies.push(reply); },
    importScripts: (...names:string[]) => {
      imports.push(names);
      (scope as unknown as {BrowserTarOriginClosure:unknown}).BrowserTarOriginClosure =
        require('../runtime/browser-tar-origin-closure.js');
    },
    fetch: async (url:string) => { requests++;return fetchFn ? fetchFn(url) : Promise.reject(new Error('no network')); },
    crypto: globalThis.crypto,
    caches:null
  };
  attachToWorkerScope(scope);
  assert.equal(callbacks.length,1,'Worker message listenerを二重登録しない');
  const send=async(data:Record<string,unknown>):Promise<Reply>=>{
    await callbacks[0]!({data});
    return replies.at(-1)!;
  };
  return {send,imports,requests:()=>requests,replies};
};

test('#349 P10b3c4 既定configureはACK互換・追加import/fetch無し',async()=>{
  const worker=fixtureScope();
  assert.deepEqual(await worker.send({
    type:'configure',manifestUrl:'https://example.test/browser-pack/manifest.json',
    requestId:'cfg'
  }),{type:'configured',requestId:'cfg'});
  assert.equal(worker.imports.length,0);
  assert.equal(worker.requests(),0);
  // 未指定の診断経路に新しいPack認証を勝手に起動させない。
  const unknown=await worker.send({type:'not-a-request',requestId:'unknown'});
  assert.equal(unknown.type,'error');
  assert.equal(worker.imports.length,0);
  assert.equal(worker.requests(),0);
});

test('#349 P10b3c4 明示opt-inは初回要求でのみ認証し、取得不良をerrorにする',async()=>{
  const worker=fixtureScope(async(url)=>{
    assert.equal(url,'https://example.test/browser-pack/manifest.json');
    return {ok:false,status:404};
  });
  assert.deepEqual(await worker.send({
    type:'configure',manifestUrl:'https://example.test/browser-pack/manifest.json',
    tarOriginDiagnosticReadOnly:true,requestId:'cfg'
  }),{type:'configured',requestId:'cfg'});
  assert.equal(worker.requests(),0);
  const bad=await worker.send({type:'open',requestId:'open'});
  assert.equal(bad.type,'error');
  assert.equal(bad.requestId,'open');
  assert.match(bad.message??'',/TAR origin diagnostic:.*manifest fetch failed/);
  assert.equal(worker.requests(),1);
  assert.deepEqual(worker.imports,[['browser-tar-pack-lock.js','browser-tar-origin-closure.js']]);
});

test('#349 P10b3c4 opt-inの原典JSON不良は正常変換へフォールバックしない',async()=>{
  const worker=fixtureScope(async(url)=>{
    if(url.endsWith('/manifest.json')) return {ok:true,json:async()=>({})};
    if(url.endsWith('/tar-origin-index.json')) return {
      ok:true,arrayBuffer:async()=>new TextEncoder().encode('{}').buffer
    };
    throw new Error('unexpected section fetch');
  });
  await worker.send({type:'configure',manifestUrl:'https://example.test/browser-pack/manifest.json',
    tarOriginDiagnosticReadOnly:true,requestId:'cfg'});
  const bad=await worker.send({type:'open',requestId:'open'});
  assert.equal(bad.type,'error');
  assert.match(bad.message??'',/TAR origin diagnostic/);
});
