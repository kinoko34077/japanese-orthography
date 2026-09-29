import assert from 'node:assert/strict';
import test from 'node:test';
import { compileKinotchProfile } from '../tools/profile-compiler.ts';
import { loadKinotchProfile } from '../tools/profile-loader.ts';

const root = process.cwd();

test('legacy profile retains 弁 -> 辨 without creating generic safety output', async () => {
  const profile = await loadKinotchProfile(root);
  const legacy = profile.packs.find((pack) => pack.packId === 'legacy-kanji');
  assert.equal(legacy?.characterMap?.['弁'], '辨');
  const artifact = compileKinotchProfile(profile);
  const bridge = JSON.parse(artifact['40-legacy-kanji.json5']);
  assert.equal(bridge.character_map['弁'], '辨');
  assert.deepEqual(Object.keys(artifact).sort(), [
    '40-legacy-kanji.json5',
    '50-official-homophone-restoration.json5',
    '55-homophone-kanji.json5',
    'manifest.json'
  ]);
  assert.ok(!Object.keys(artifact).some((name) => name.includes('safe') || name.includes('relation')));
});

test('profile manifest explicitly says compatibility authority does not imply generic safety', async () => {
  const profile = await loadKinotchProfile(root);
  assert.equal(profile.manifest.authority, 'compatibility_profile');
  assert.ok(profile.manifest.packs.every((pack) => pack.genericSafety === 'not_implied'));
});
