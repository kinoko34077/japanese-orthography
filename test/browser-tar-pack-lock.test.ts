import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { openFixedTarPack } = require('../runtime/browser-tar-pack-lock.js');
const original = JSON.parse(await readFile(
  new URL('../data/browser-pack-v3/manifest.json', import.meta.url), 'utf8'
));

test('#349 P10b3b 独立受入Pack digestの不一致は一切section取得せず拒否', async () => {
  let fetched = 0;
  await assert.rejects(openFixedTarPack(
    {...original, packDigest:'0'.repeat(64)},
    async () => { fetched++; throw new Error('section provider must not run'); }
  ), /independent accepted identity mismatch/);
  assert.equal(fetched, 0);
});

test('#349 P10b3b Program semantic digestの異なるmanifestも事前拒否', async () => {
  let fetched = 0;
  await assert.rejects(openFixedTarPack({
    ...original, ruleRuntime:{...original.ruleRuntime, programDigest:'0'.repeat(64)}
  }, async () => { fetched++; throw new Error('section provider must not run'); }),
  /independent accepted identity mismatch/);
  assert.equal(fetched, 0);
});

test('#349 P10b3b hot必須sectionの欠落や曖昧さは物理取得前に拒否', async () => {
  for (const sections of [
    original.sections.filter((section: {sectionId:string}) => section.sectionId !== 'rule-predicates'),
    [...original.sections, original.sections.find((section: {sectionId:string}) =>
      section.sectionId === 'rule-predicates')]
  ]) {
    let fetched = 0;
    await assert.rejects(openFixedTarPack({...original, sections},
      async () => { fetched++; throw new Error('section provider must not run'); }),
      /missing or ambiguous hot section/);
    assert.equal(fetched, 0);
  }
});
