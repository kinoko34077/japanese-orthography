import type { Diagnostic } from './model.ts';

export type ProfileSourcePack = 'legacy' | 'official-homophone' | 'project-homophone';
export type ProfileSourceRole = ProfileSourcePack;

export interface ProfileSourceSnapshot {
  repository: string;
  commit: string;
  path: string;
  blobSha: string;
  role: ProfileSourceRole;
}

export interface ProfileManifestPackRef {
  id: string;
  file: string;
  sourcePack: ProfileSourcePack;
  genericSafety: 'not_implied';
}

export interface KinotchProfileManifest {
  schemaVersion: '1';
  profileId: string;
  authority: 'compatibility_profile';
  sourceSnapshots: ProfileSourceSnapshot[];
  packs: ProfileManifestPackRef[];
}

export interface ProfilePhraseRule {
  match: string;
  targets: string[];
  priority: number;
  candidate: boolean;
}

export interface ProfileRuleGroup {
  id: string;
  label: string;
  phraseRules: ProfilePhraseRule[];
  characterMapPriority: number;
  characterMap: Record<string, string>;
}

export interface KinotchProfilePack {
  schemaVersion: '1';
  profileId: string;
  packId: string;
  sourcePack: ProfileSourcePack;
  label: string;
  kind: 'dictionary-rules';
  phraseRules?: ProfilePhraseRule[];
  characterMapPriority?: number;
  characterMap?: Record<string, string>;
  groups?: ProfileRuleGroup[];
}

export interface LoadedKinotchProfile {
  manifest: KinotchProfileManifest;
  packs: KinotchProfilePack[];
}

export type ProfileDiagnostic = Diagnostic;
