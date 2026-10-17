/** #349 P10b3c4: 非公開build:site上の本物のWorker処理を明示read-only診断で検証。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';

const root=fileURLToPath(new URL('..',import.meta.url));
const out=resolve(root,'dist-site');
const require=createRequire(import.meta.url);
const {attachToWorkerScope}=require('../runtime/browser-transform-worker.js');
const manifestUrl='https://site.invalid/browser-pack/manifest.json';
const tarIndex=await readFile(resolve(out,'browser-pack/tar-origin-index.json'));
for(const name of ['browser-tar-pack-lock.js','browser-tar-origin-closure.js']){
  assert.ok((await readFile(resolve(out,'runtime',name))).byteLength>0,
    'Workerで遅延読込する固定認証moduleは非公開siteに同梱済み');
}
type Reply={type:string;requestId?:string;message?:string;result?:{renderedText:string}};
const toArrayBuffer=(body:Uint8Array):ArrayBuffer=>Uint8Array.from(body).buffer;
const createWorker=({corruptIndex=false}={})=>{
  const replies:Reply[]=[];
  let listener:((event:{data:Record<string,unknown>})=>Promise<void>)|null=null;
  const counts={manifest:0,index:0,section:0,imports:0};
  let installedClosure:unknown=null;
  const fetchImpl=async(uri:string)=>{
    const url=new URL(uri);
    assert.equal(url.origin,'https://site.invalid');
    const rel=url.pathname.replace(/^\//,'');
    assert.ok(rel.startsWith('browser-pack/'));
    if(rel==='browser-pack/manifest.json') counts.manifest++;
    else if(rel==='browser-pack/tar-origin-index.json') counts.index++;
    else counts.section++;
    let bytes=await readFile(resolve(out,rel));
    if(corruptIndex && rel==='browser-pack/tar-origin-index.json'){
      bytes=Buffer.from(bytes);
      bytes[7]=(bytes[7]??0)^1;
    }
    return {ok:true,status:200,
      json:async()=>JSON.parse(bytes.toString('utf8')),
      arrayBuffer:async()=>toArrayBuffer(bytes)};
  };
  const scope={
    crypto:webcrypto,caches:null,
    fetch:fetchImpl,
    get BrowserTarOriginClosure(){return installedClosure;},
    importScripts:(...names:string[])=>{
      assert.deepEqual(names,['browser-tar-pack-lock.js','browser-tar-origin-closure.js']);
      counts.imports++;
      installedClosure=require('../runtime/browser-tar-origin-closure.js');
    },
    addEventListener:(name:string,fn:(event:{data:Record<string,unknown>})=>Promise<void>)=>{
      assert.equal(name,'message');
      assert.equal(listener,null,'二重Worker attach禁止');
      listener=fn;
    },
    postMessage:(reply:Reply)=>{replies.push(reply);}
  };
  attachToWorkerScope(scope);
  const send=async(message:Record<string,unknown>):Promise<Reply>=>{
    assert.ok(listener);
    await listener({data:message});
    return replies.at(-1)!;
  };
  return {send,counts};
};
const worker=createWorker();
assert.deepEqual(await worker.send({type:'configure',requestId:'config',manifestUrl,
  tarOriginDiagnosticReadOnly:true}),{type:'configured',requestId:'config'});
assert.deepEqual(worker.counts,{manifest:0,index:0,section:0,imports:0},
  'configure ACKの前後で非同期ロードを発生させない');
const opened=await worker.send({type:'open',requestId:'open'});
assert.equal(opened.type,'opened',opened.message);
const index=JSON.parse(tarIndex.toString('utf8')) as {rows:Array<{input:string}>};
const input=index.rows[0]!.input;
const results=[];
for(const mode of ['plain','ruby-whole-explicit']){
  const transformed=await worker.send({
    type:'transform',requestId:'transform-'+mode,text:input,
    profileId:'kinotch-fixed',renderMode:mode
  });
  assert.equal(transformed.type,'result',transformed.message);
  assert.equal(typeof transformed.result?.renderedText,'string');
  results.push({mode,text:transformed.result!.renderedText});
}
assert.equal(worker.counts.manifest,1);
assert.equal(worker.counts.index,1);
assert.equal(worker.counts.imports,1);
assert.ok(worker.counts.section>0,'同一Packの実バイトを取得して変換する');
const corrupted=createWorker({corruptIndex:true});
await corrupted.send({type:'configure',requestId:'cfg-bad',manifestUrl,
  tarOriginDiagnosticReadOnly:true});
const error=await corrupted.send({type:'open',requestId:'bad'});
assert.equal(error.type,'error');
assert.match(error.message??'',/independent index digest mismatch/);
assert.equal(corrupted.counts.section,0,'原典ハッシュ不一致ならPack sectionを開封しない');
console.log(JSON.stringify({
  kind:'tar-worker-readonly-optin-generated-pack-e2e',
  modeResults:results,packLoads:worker.counts.manifest,
  indexLoads:worker.counts.index,importCalls:worker.counts.imports,
  corruptionPreventsSectionFetch:true,publicWorkerMaskEnabled:false,
  runtimeOriginAuthenticated:false,publishedSiteBytesVerified:false
}));
