export const RESPONSIBILITIES = [
  'character_form',
  'lexical_historical_kanji',
  'merged_character',
  'historical_kana_native',
  'historical_kana_sino',
  'kinotch_semantic',
  'kinotch_style',
  'preserve_unresolved'
] as const;

export type Responsibility = typeof RESPONSIBILITIES[number];

export const DISPOSITIONS = [
  'admitted',
  'candidate_ambiguous',
  'excluded_unresolved'
] as const;

export type Disposition = typeof DISPOSITIONS[number];

export const SOURCE_RECORD_KINDS = [
  'mapping',
  'alternative',
  'disabled',
  'identity',
  'explanatory'
] as const;

export type SourceRecordKind = typeof SOURCE_RECORD_KINDS[number];

export const SOURCE_CLASSES = [
  'committed-reference',
  'external-repository',
  'official',
  'dictionary',
  'research'
] as const;

export type IntakeSourceClass = typeof SOURCE_CLASSES[number];

export const COVERAGE_ROLES = [
  'coverage-contract',
  'supplemental',
  'candidate-only'
] as const;

export type CoverageRole = typeof COVERAGE_ROLES[number];

export interface SourceSnapshot {
  sourceId: string;
  sourceClass: IntakeSourceClass;
  repository?: string;
  commit?: string;
  path: string;
  blobSha?: string;
  license?: string;
  coverageRole: CoverageRole;
}

export interface IntakeRecord {
  id: string;
  sourceRef: string;
  sourceLocator: string;
  sourceRecordKind: SourceRecordKind;
  responsibility: Responsibility;
  disposition: Disposition;
  modernSurface?: string;
  historicalSurface?: string;
  modernReading?: string;
  historicalReading?: string;
  lexicalIdentity?: string;
  morphology?: Record<string, string>;
  alternatives?: string[];
  exclusionReason?: string;
  evidenceRefs: string[];
}

export interface IntakeBundleDocument {
  schemaVersion: '1';
  kind: 'orthography_intake_bundle';
  snapshots: SourceSnapshot[];
  records: IntakeRecord[];
}
