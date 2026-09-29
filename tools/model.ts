export type DiagnosticSeverity = 'ERROR' | 'REVIEW';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  path?: string;
  message: string;
}

export interface SourceLocation {
  file: string;
  pointer: string;
}

export interface Located<T> {
  value: T;
  location: SourceLocation;
}

export interface SourceDescriptor {
  id: string;
  kind: 'primary_official' | 'dictionary' | 'usage_corpus' | 'specialized_reference' | 'project_override' | 'secondary_transcription' | 'candidate_oracle';
  title: string;
  versionRef?: string;
  locator: string;
  licenseNote?: string;
  pinnedRefOrDigest?: string;
}

export type EvidenceClaim =
  | { type: 'mapping'; direction: 'historical_to_modern' | 'modern_to_historical'; rawFrom: string; rawTo: string; projectedFrom?: string; projectedTo?: string; projectionNotes?: string[] }
  | { type: 'attestation'; form: string; reading?: string; lexicalIdentity?: string; senseNote?: string }
  | { type: 'exclusion'; form: string; senseNote: string };

export interface EvidenceRecord {
  id: string;
  sourceRef: string;
  locator: string;
  sourceClass: 'official' | 'lexical' | 'usage' | 'specialized' | 'override';
  sourceBehavior?: { state: 'default' | 'variant' | 'active' | 'disabled'; note?: string };
  claim: EvidenceClaim;
}

export interface SourceLexicalEvidence {
  id: string;
  sourceRef: string;
  sourceIdentity: string;
  lForm?: string;
  lexicalOrigin?: string;
  evidenceRefs: string[];
}

export interface LexicalConstraintSet {
  id: string;
  lexicalEvidenceRefs: string[];
}

export interface RestorationUnit {
  id: string;
  family: string;
  modernKey: string;
  notes?: string;
}

export interface ExternalRelationRef {
  packId: string;
  relationId: string;
}

export interface PositiveRelation {
  id: string;
  unitId: string;
  kind: 'contextual_kanji';
  direction: 'modern_to_historical';
  channel: 'surface';
  match: string;
  lexicalConstraintSetId?: string;
  target: string;
  evidenceRefs: string[];
  admission: 'admitted' | 'disabled';
}

export interface SafetyConstraint {
  id: string;
  unitId?: string;
  kind: 'contextual_kanji';
  channel: 'surface';
  match: string;
  lexicalConstraintSetId?: string;
  effect: 'preserve_exact' | 'block_fallback';
  evidenceRefs: string[];
  blocks?: ExternalRelationRef[];
  admission: 'admitted' | 'disabled';
}

export interface ReviewHint {
  id: string;
  kind: 'contextual_kanji';
  channel: 'surface';
  match: string;
  lexicalConstraintSetId?: string;
  proposedTarget?: string;
  evidenceRefs: string[];
  reason: 'oracle_only' | 'unresolved_evidence' | 'ambiguous_binding' | 'normalization_review';
}

export interface EvidenceBundleDocument {
  schemaVersion: '1';
  source: SourceDescriptor;
  evidence: EvidenceRecord[];
}

export interface LexicalConstraintsDocument {
  schemaVersion: '1';
  lexicalEvidence: SourceLexicalEvidence[];
  constraintSets: LexicalConstraintSet[];
}

export interface ContextualKanjiPackDocument {
  schemaVersion: '1';
  packId: string;
  restorationUnits: RestorationUnit[];
  positiveRelations: PositiveRelation[];
  safetyConstraints: SafetyConstraint[];
  reviewHints: ReviewHint[];
}

export interface PackMetadata {
  packId: string;
  requiresLexicalNamespaceId?: string;
}

export interface CanonicalWorkspace {
  sources: Located<SourceDescriptor>[];
  evidence: Located<EvidenceRecord>[];
  lexicalEvidence: Located<SourceLexicalEvidence>[];
  lexicalConstraintSets: Located<LexicalConstraintSet>[];
  restorationUnits: Located<RestorationUnit>[];
  positiveRelations: Located<PositiveRelation>[];
  safetyConstraints: Located<SafetyConstraint>[];
  reviewHints: Located<ReviewHint>[];
  packMetadata: Located<PackMetadata>[];
}
