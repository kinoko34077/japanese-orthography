import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileKinotchProfile } from '../tools/profile-compiler.ts';
import { loadKinotchProfile } from '../tools/profile-loader.ts';
import type { LoadedKinotchProfile } from '../tools/profile-model.ts';

const root = process.cwd();

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('profile compiler is byte deterministic and insensitive to object member insertion order', async () => {
  const profile = await loadKinotchProfile(root);
  const first = compileKinotchProfile(profile);
  const second = compileKinotchProfile(profile);
  assert.deepEqual(first, second);

  const reordered = deepClone(profile);
  const legacy = reordered.packs.find((pack) => pack.packId === 'legacy-kanji');
  assert.ok(legacy?.characterMap);
  legacy.characterMap = Object.fromEntries(Object.entries(legacy.characterMap).reverse());
  assert.deepEqual(compileKinotchProfile(reordered), first);
});

test('bridge artifacts reproduce current txt-auto-replace rule contract', async () => {
  const profile = await loadKinotchProfile(root);
  const artifact = compileKinotchProfile(profile);
  const legacy = JSON.parse(artifact['40-legacy-kanji.json5']);
  const official = JSON.parse(artifact['50-official-homophone-restoration.json5']);
  const project = JSON.parse(artifact['55-homophone-kanji.json5']);
  assert.equal(legacy.character_map['弁'], '辨');
  const officialRules = Object.assign({}, ...official.groups.map((group: any) => group.phrase_rules));
  const projectRules = Object.assign({}, ...project.groups.map((group: any) => group.phrase_rules));
  assert.deepEqual(officialRules['興奮'], ['昂奮,亢奮', 50, true]);
  assert.deepEqual(projectRules['ドイツ'], ['独逸,独乙', 90, true]);
});

test('manifest binds canonical identity and exact generated payload bytes', async () => {
  const profile = await loadKinotchProfile(root);
  const artifact = compileKinotchProfile(profile);
  const manifest = JSON.parse(artifact['manifest.json']);
  assert.equal(manifest.artifactSchemaVersion, '1');
  assert.equal(manifest.profileId, 'kinotch-fixed');
  assert.equal(manifest.buildSourceIdentity, 'canonical-content-addressed');
  assert.equal(manifest.adoptedSourceSet.length, 3);
  for (const file of manifest.files) {
    const payload = artifact[file.path as keyof typeof artifact];
    assert.equal(file.payloadDigest, sha256(payload));
    assert.equal(file.byteLength, Buffer.byteLength(payload, 'utf8'));
  }
});

test('behavioral mutation changes canonical and artifact identity', async () => {
  const profile = await loadKinotchProfile(root);
  const baseline = compileKinotchProfile(profile);
  const mutated: LoadedKinotchProfile = deepClone(profile);
  const official = mutated.packs.find((pack) => pack.packId === 'official-homophone-restoration');
  const rule = official?.groups?.flatMap((group) => group.phraseRules).find((entry) => entry.match === '興奮');
  assert.ok(rule);
  rule.targets = ['昂奮'];
  const changed = compileKinotchProfile(mutated);
  assert.notEqual(changed['manifest.json'], baseline['manifest.json']);
  assert.notEqual(changed['50-official-homophone-restoration.json5'], baseline['50-official-homophone-restoration.json5']);
});
