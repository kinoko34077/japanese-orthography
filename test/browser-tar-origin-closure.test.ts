import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {openFixedTarOriginClosure} = require('../runtime/browser-tar-origin-closure.js');
const manifest = JSON.parse(await readFile(
  new URL('../data/browser-pack-v3/manifest.json', import.meta.url),'utf8'));

test('#349 P10b3c2 配信インデックスの値だけではなく独立SHA256を照合', async () => {
  let attempted = 0;
  const provider = async () => { attempted++; throw new Error('unexpected section fetch'); };
  await assert.rejects(
    openFixedTarOriginClosure(manifest, provider, {sha256:'500fa882847aa1ac8e8f1cbb1f619527f28e1608819e1105adb5233a3c5d102e'}),
    /raw JSON bytes/
  );
  const forged = new Uint8Array(31798);
  await assert.rejects(openFixedTarOriginClosure(manifest,provider,forged),
    /independent index digest mismatch/);
  assert.equal(attempted,0,'固定原典認証前に任意sectionProviderを実行しない');
});

test('#349 P10b3c2 不完全bytesはWebCrypto/Pack読込前にfail closed', async () => {
  let attempted = 0;
  await assert.rejects(openFixedTarOriginClosure(manifest,
    async () => { attempted++; throw new Error('unexpected section fetch'); },
    new TextEncoder().encode('{}')), /pinned source size/);
  assert.equal(attempted,0);
});

test('#349 P10b3c2 APIは外部pack/VM/candidateを受け取らずread-only', () => {
  assert.equal(typeof openFixedTarOriginClosure,'function');
  assert.equal(openFixedTarOriginClosure.length,3,'manifest/sectionProvider/raw bytesだけを取る');
});
