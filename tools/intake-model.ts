export type Responsibility =
  | 'character_form'
  | 'lexical_historical_kanji'
  | 'merged_character'
  | 'historical_kana_native'
  | 'historical_kana_sino'
  | 'kinotch_semantic'
  | 'kinotch_style'
  | 'preserve_unresolved';

export type Disposition =
  | 'admitted'
  | 'candidate_ambiguous'
  | 'excluded_unresolved';

export type SourceRecordKind =
  | 'mapping'
  | 'alternative'
  | 'disabled'
  | 'identity'
  | 'explanatory';

export type CoverageRole =
  | 'coverage-contract'
  | 'supplemental'
  | 'candidate-only';

export type SourceClass =
  | 'committed-reference'
  | 'external-repository'
  | 'official'
  | 'dictionary'
  | 'research';

export interface SourceSnapshot {
  sourceId: string;
  sourceClass: SourceClass;
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
