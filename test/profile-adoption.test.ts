import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { loadKinotchProfile } from '../tools/profile-loader.ts';
import type { KinotchProfilePack, ProfilePhraseRule } from '../tools/profile-model.ts';

const root = process.cwd();
const fixtureDir = join(root, 'test', 'fixtures', 'pinned', 'txt-auto-replace');

async function readJson5Fixture(name: string): Promise<any> {
  const text = await readFile(join(fixtureDir, name), 'utf8');
  return vm.runInNewContext(`(${text})`, Object.create(null), { timeout: 1000 });
}

function normalizeRules(input: Record<string, [string, number, boolean]> = {}): ProfilePhraseRule[] {
  return Object.entries(input).map(([match, [replacement, priority, candidate]]) => ({
    match,
    targets: replacement.split(','),
    priority,
    candidate
  }));
}

function normalizeSource(source: any, sourcePack: KinotchProfilePack['sourcePack']): Omit<KinotchProfilePack, 'schemaVersion' | 'profileId'> {
  if (source.groups) {
    return {
      packId: source.id,
      sourcePack,
      label: source.label,
      kind: source.kind,
      groups: source.groups.map((group: any) => ({
        id: group.id,
        label: group.label,
        phraseRules: normalizeRules(group.phrase_rules),
        characterMapPriority: group.character_map_priority,
        characterMap: group.character_map
      }))
    };
  }
  return {
    packId: source.id,
    sourcePack,
    label: source.label,
    kind: source.kind,
    phraseRules: Array.isArray(source.phrase_rules) ? [] : normalizeRules(source.phrase_rules),
    characterMapPriority: source.character_map_priority,
    characterMap: source.character_map
  };
}

function canonicalBehavior(pack: KinotchProfilePack): Omit<KinotchProfilePack, 'schemaVersion' | 'profileId'> {
  const { schemaVersion: _schemaVersion, profileId: _profileId, ...behavior } = pack;
  return behavior;
}

test('canonical KiNoTch profile exactly adopts pinned 40/50/55 rule behavior', async () => {
  const profile = await loadKinotchProfile(root);
  const cases = [
    ['40-legacy-kanji.json5', 'legacy-kanji', 'legacy'],
    ['50-official-homophone-restoration.json5', 'official-homophone-restoration', 'official-homophone'],
    ['55-homophone-kanji.json5', 'homophone-kanji', 'project-homophone']
  ] as const;

  for (const [fixture, packId, sourcePack] of cases) {
    const source = await readJson5Fixture(fixture);
    const canonical = profile.packs.find((pack) => pack.packId === packId);
    assert.ok(canonical, `missing canonical pack ${packId}`);
    assert.deepEqual(canonicalBehavior(canonical), normalizeSource(source, sourcePack));
  }
});

test('canonical profile retains accepted multi-target rules without collapse', async () => {
  const profile = await loadKinotchProfile(root);
  const official = profile.packs.find((pack) => pack.packId === 'official-homophone-restoration');
  const project = profile.packs.find((pack) => pack.packId === 'homophone-kanji');
  assert.ok(official?.groups && project?.groups);
  const officialRules = official.groups.flatMap((group) => group.phraseRules);
  const projectRules = project.groups.flatMap((group) => group.phraseRules);
  assert.deepEqual(officialRules.find((rule) => rule.match === '興奮')?.targets, ['昂奮', '亢奮']);
  assert.deepEqual(projectRules.find((rule) => rule.match === 'ドイツ')?.targets, ['独逸', '独乙']);
});

test('manifest pins exact source repository commit and blob identities', async () => {
  const profile = await loadKinotchProfile(root);
  assert.equal(profile.manifest.authority, 'compatibility_profile');
  assert.deepEqual(
    profile.manifest.sourceSnapshots.map((source) => [source.path, source.blobSha]),
    [
      ['transforms/40-legacy-kanji.json5', '57177fb8fba471f9c169283dcbae5830d5bac64f'],
      ['transforms/50-official-homophone-restoration.json5', 'c3e35dd4431deeb13b94a7f3d5e43f978ed73ef3'],
      ['transforms/55-homophone-kanji.json5', '3d4ff5f2c1bdf8dd1cea4832d0a6d08592a218fd']
    ]
  );
  assert.ok(profile.manifest.sourceSnapshots.every((source) => source.commit === 'b1227053c5df94c148ca2027b897a69199801e4e'));
});
