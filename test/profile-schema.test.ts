import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileSchemaValidator, validateProfileDocuments } from '../tools/profile-validator.ts';

const manifest = {
  schemaVersion: '1',
  profileId: 'kinotch-fixed',
  authority: 'compatibility_profile',
  sourceSnapshots: [{
    repository: 'kinoko34077/txt-auto-replace',
    commit: 'b1227053c5df94c148ca2027b897a69199801e4e',
    path: 'transforms/40-legacy-kanji.json5',
    blobSha: '57177fb8fba471f9c169283dcbae5830d5bac64f',
    role: 'legacy'
  }],
  packs: [{ id: 'legacy-kanji', file: 'legacy-kanji.json', sourcePack: 'legacy', genericSafety: 'not_implied' }]
};

const pack = {
  schemaVersion: '1',
  profileId: 'kinotch-fixed',
  packId: 'legacy-kanji',
  sourcePack: 'legacy',
  label: '旧字変換',
  kind: 'dictionary-rules',
  phraseRules: [],
  characterMapPriority: 10,
  characterMap: { '弁': '辨' }
};

test('profile schemas accept explicit compatibility authority and rule shapes', () => {
  const validate = createProfileSchemaValidator();
  assert.deepEqual(validate(manifest, 'kinotch-profile-manifest-v1'), []);
  assert.deepEqual(validate(pack, 'kinotch-profile-pack-v1'), []);
});

test('profile pack requires non-empty explicit targets for phrase rules', () => {
  const validate = createProfileSchemaValidator();
  const invalid = { ...pack, phraseRules: [{ match: '興奮', targets: [], priority: 50, candidate: true }] };
  assert.ok(validate(invalid, 'kinotch-profile-pack-v1').some((item) => item.code === 'E_SCHEMA'));
});

test('profile pack rejects unknown source-pack and candidate types', () => {
  const validate = createProfileSchemaValidator();
  const invalid = {
    ...pack,
    sourcePack: 'generic-safe',
    phraseRules: [{ match: '興奮', targets: ['昂奮', '亢奮'], priority: 50, candidate: 'yes' }]
  };
  assert.ok(validate(invalid, 'kinotch-profile-pack-v1').length >= 2);
});

test('semantic profile validation rejects duplicate pack, group and phrase identities', () => {
  const grouped = {
    ...pack,
    packId: 'official-homophone-restoration',
    sourcePack: 'official-homophone',
    phraseRules: undefined,
    characterMapPriority: undefined,
    characterMap: undefined,
    groups: [
      { id: 'kana-こ', label: 'こ行', phraseRules: [{ match: '興奮', targets: ['昂奮'], priority: 50, candidate: true }], characterMapPriority: 10, characterMap: {} },
      { id: 'kana-こ', label: 'こ行 duplicate', phraseRules: [{ match: '興奮', targets: ['亢奮'], priority: 50, candidate: true }], characterMapPriority: 10, characterMap: {} }
    ]
  };
  const diagnostics = validateProfileDocuments(manifest, [grouped, grouped]);
  assert.ok(diagnostics.some((item) => item.code === 'E_PROFILE_DUPLICATE_PACK'));
  assert.ok(diagnostics.some((item) => item.code === 'E_PROFILE_DUPLICATE_GROUP'));
  assert.ok(diagnostics.some((item) => item.code === 'E_PROFILE_DUPLICATE_RULE'));
});
