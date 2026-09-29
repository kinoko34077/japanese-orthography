import { createHash } from 'node:crypto';
import type { KinotchProfilePack, LoadedKinotchProfile, ProfilePhraseRule } from './profile-model.ts';
import { computeProfileSourceDigest, sha256Text, stableProfileSerialize } from './profile-normalize.ts';

export type ProfileArtifactFileName =
  | 'manifest.json'
  | '40-legacy-kanji.json5'
  | '50-official-homophone-restoration.json5'
  | '55-homophone-kanji.json5';

export type CompiledProfileArtifact = Record<ProfileArtifactFileName, string>;

const bridgeFiles = [
  ['legacy-kanji', '40-legacy-kanji.json5'],
  ['official-homophone-restoration', '50-official-homophone-restoration.json5'],
  ['homophone-kanji', '55-homophone-kanji.json5']
] as const;

function sortStringMap(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

function phraseRuleObject(rules: ProfilePhraseRule[]): Record<string, [string, number, boolean]> {
  const result: Record<string, [string, number, boolean]> = {};
  for (const rule of rules) result[rule.match] = [rule.targets.join(','), rule.priority, rule.candidate];
  return result;
}

function consumerPack(pack: KinotchProfilePack): unknown {
  if (pack.groups) {
    return {
      id: pack.packId,
      label: pack.label,
      kind: pack.kind,
      groups: pack.groups.map((group) => ({
        id: group.id,
        label: group.label,
        phrase_rules: phraseRuleObject(group.phraseRules),
        character_map_priority: group.characterMapPriority,
        character_map: sortStringMap(group.characterMap)
      }))
    };
  }
  return {
    id: pack.packId,
    label: pack.label,
    kind: pack.kind,
    phrase_rules: pack.phraseRules?.length ? phraseRuleObject(pack.phraseRules) : [],
    character_map_priority: pack.characterMapPriority,
    character_map: sortStringMap(pack.characterMap ?? {})
  };
}

function serializeConsumer(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function onePack(profile: LoadedKinotchProfile, packId: string): KinotchProfilePack {
  const pack = profile.packs.find((candidate) => candidate.packId === packId);
  if (!pack) throw new Error(`Missing profile pack: ${packId}`);
  return pack;
}

export function compileKinotchProfile(profile: LoadedKinotchProfile): CompiledProfileArtifact {
  const payloads = Object.fromEntries(
    bridgeFiles.map(([packId, file]) => [file, serializeConsumer(consumerPack(onePack(profile, packId)))])
  ) as Record<Exclude<ProfileArtifactFileName, 'manifest.json'>, string>;

  const canonicalSourceDigest = computeProfileSourceDigest(profile);
  const sourceSet = [...profile.manifest.sourceSnapshots].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const sourceSetDigest = sha256Text(stableProfileSerialize(sourceSet));
  const artifactGeneration = createHash('sha256')
    .update(`txt-auto-replace-profile-v1:${canonicalSourceDigest}`, 'utf8')
    .digest('hex');
  const files = bridgeFiles.map(([, path]) => ({
    path,
    payloadDigest: sha256Text(payloads[path]),
    byteLength: Buffer.byteLength(payloads[path], 'utf8')
  }));
  const manifest = {
    artifactSchemaVersion: '1',
    profileId: profile.manifest.profileId,
    buildSourceIdentity: 'canonical-content-addressed',
    artifactGeneration,
    canonicalSourceDigest,
    sourceSetDigest,
    adoptedSourceSet: sourceSet,
    files
  };
  return {
    'manifest.json': serializeConsumer(manifest),
    ...payloads
  };
}
