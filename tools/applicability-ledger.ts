import type { CandidateSelectionResult } from './candidate-preference.ts';
import type { ProductiveResolution } from './productive-orthography.ts';
import type { ResultBasis } from './normalized-relation-model.ts';

export interface ApplicabilityBlockedRule {
  ruleRef: string;
  reason: string;
}

export interface ApplicabilityLedgerEntry {
  input: string;
  lexicalIdentity?: string;
  context?: Record<string, string>;
  sourceCandidates: string[];
  generatedCandidates: string[];
  selectedResult: string | null;
  basis: ResultBasis;
  ruleRefs: string[];
  sourceRefs: string[];
  evidenceRefs: string[];
  generationApplied: boolean;
  preferenceApplied: boolean;
  blockedRules: ApplicabilityBlockedRule[];
}

export interface ApplicabilityLedger {
  schemaVersion: '1';
  kind: 'orthography_applicability_ledger';
  entries: ApplicabilityLedgerEntry[];
}

export interface CandidateLedgerMetadata {
  input: string;
  lexicalIdentity?: string;
  context?: Record<string, string>;
  generatedCandidates?: string[];
}

export interface ProductiveLedgerMetadata {
  lexicalIdentity?: string;
  context?: Record<string, string>;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function canonicalContext(
  context: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (context === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(context).sort(([a], [b]) => compareText(a, b))
  );
}

function canonicalBlockedRules(
  rules: Iterable<ApplicabilityBlockedRule>
): ApplicabilityBlockedRule[] {
  const seen = new Set<string>();
  const output: ApplicabilityBlockedRule[] = [];
  for (const rule of rules) {
    const key = rule.ruleRef + '\u0000' + rule.reason;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ ruleRef: rule.ruleRef, reason: rule.reason });
  }
  return output.sort((a, b) =>
    compareText(a.ruleRef, b.ruleRef) ||
    compareText(a.reason, b.reason)
  );
}

function candidateGenerationApplied(basis: ResultBasis): boolean {
  return basis === 'generated_productive_span' ||
    basis === 'generated_character' ||
    basis === 'generated_diachronic' ||
    basis === 'generated_rendering';
}

function candidatePreferenceApplied(basis: ResultBasis): boolean {
  return basis === 'generated_diachronic' ||
    basis === 'generated_rendering' ||
    basis === 'manual_preference';
}

export function ledgerEntryFromCandidateSelection(
  metadata: CandidateLedgerMetadata,
  result: CandidateSelectionResult
): ApplicabilityLedgerEntry {
  const generatedCandidates = metadata.generatedCandidates ??
    (
      result.selectedResult !== null && candidateGenerationApplied(result.basis)
        ? [result.selectedResult]
        : []
    );

  const entry: ApplicabilityLedgerEntry = {
    input: metadata.input,
    sourceCandidates: canonicalStrings(result.sourceCandidates),
    generatedCandidates: canonicalStrings(generatedCandidates),
    selectedResult: result.selectedResult,
    basis: result.basis,
    ruleRefs: canonicalStrings([
      ...result.appliedRuleRefs,
      ...result.blockedRuleRefs
    ]),
    sourceRefs: canonicalStrings(result.sourceRefs),
    evidenceRefs: canonicalStrings(result.evidenceRefs),
    generationApplied: candidateGenerationApplied(result.basis),
    preferenceApplied: candidatePreferenceApplied(result.basis),
    blockedRules: canonicalBlockedRules(
      result.blockedRuleRefs.map(ruleRef => ({
        ruleRef,
        reason: result.status === 'selected'
          ? 'not_selected_by_precedence'
          : 'not_selected_or_inapplicable'
      }))
    )
  };
  if (metadata.lexicalIdentity !== undefined) {
    entry.lexicalIdentity = metadata.lexicalIdentity;
  }
  const context = canonicalContext(metadata.context);
  if (context !== undefined) entry.context = context;
  return entry;
}

function productiveBasis(resolution: ProductiveResolution): ResultBasis {
  if (resolution.appliedRules.some(rule => rule.basis === 'generated_productive_span')) {
    return 'generated_productive_span';
  }
  if (resolution.appliedRules.some(rule => rule.basis === 'generated_character')) {
    return 'generated_character';
  }
  if (resolution.appliedRules.some(rule => rule.basis === 'preserve_exact')) {
    return 'preserve_exact';
  }
  return 'unresolved';
}

export function ledgerEntryFromProductiveResolution(
  resolution: ProductiveResolution,
  metadata: ProductiveLedgerMetadata = {}
): ApplicabilityLedgerEntry {
  const basis = productiveBasis(resolution);
  const generatedRules = resolution.appliedRules.filter(rule =>
    rule.basis === 'generated_productive_span' ||
    rule.basis === 'generated_character'
  );
  const sourceRefs = canonicalStrings(
    resolution.appliedRules.flatMap(rule => rule.sourceRefs)
  );
  const evidenceRefs = canonicalStrings(
    resolution.appliedRules.flatMap(rule => rule.evidenceRefs)
  );

  const entry: ApplicabilityLedgerEntry = {
    input: resolution.input,
    sourceCandidates: [],
    generatedCandidates: canonicalStrings(generatedRules.map(rule => rule.output)),
    selectedResult: resolution.appliedRules.length > 0 ? resolution.output : null,
    basis,
    ruleRefs: canonicalStrings([
      ...resolution.appliedRules.map(rule => rule.relationId),
      ...resolution.blockedRules.map(rule => rule.relationId)
    ]),
    sourceRefs,
    evidenceRefs,
    generationApplied: generatedRules.length > 0,
    preferenceApplied: false,
    blockedRules: canonicalBlockedRules(
      resolution.blockedRules.map(rule => ({
        ruleRef: rule.relationId,
        reason: rule.reason
      }))
    )
  };
  if (metadata.lexicalIdentity !== undefined) {
    entry.lexicalIdentity = metadata.lexicalIdentity;
  }
  const context = canonicalContext(metadata.context);
  if (context !== undefined) entry.context = context;
  return entry;
}

function canonicalEntry(entry: ApplicabilityLedgerEntry): ApplicabilityLedgerEntry {
  const output: ApplicabilityLedgerEntry = {
    input: entry.input,
    sourceCandidates: canonicalStrings(entry.sourceCandidates),
    generatedCandidates: canonicalStrings(entry.generatedCandidates),
    selectedResult: entry.selectedResult,
    basis: entry.basis,
    ruleRefs: canonicalStrings(entry.ruleRefs),
    sourceRefs: canonicalStrings(entry.sourceRefs),
    evidenceRefs: canonicalStrings(entry.evidenceRefs),
    generationApplied: entry.generationApplied,
    preferenceApplied: entry.preferenceApplied,
    blockedRules: canonicalBlockedRules(entry.blockedRules)
  };
  if (entry.lexicalIdentity !== undefined) output.lexicalIdentity = entry.lexicalIdentity;
  const context = canonicalContext(entry.context);
  if (context !== undefined) output.context = context;
  return output;
}

export function createApplicabilityLedger(
  entries: ApplicabilityLedgerEntry[]
): ApplicabilityLedger {
  const canonicalEntries = entries
    .map(canonicalEntry)
    .sort((a, b) =>
      compareText(a.input, b.input) ||
      compareText(a.lexicalIdentity ?? '', b.lexicalIdentity ?? '') ||
      compareText(JSON.stringify(a.context ?? {}), JSON.stringify(b.context ?? {})) ||
      compareText(a.selectedResult ?? '', b.selectedResult ?? '') ||
      compareText(a.basis, b.basis)
    );

  return {
    schemaVersion: '1',
    kind: 'orthography_applicability_ledger',
    entries: canonicalEntries
  };
}

export function queryApplicabilityLedgerByRule(
  ledger: ApplicabilityLedger,
  ruleRef: string
): ApplicabilityLedgerEntry[] {
  return ledger.entries
    .filter(entry =>
      entry.ruleRefs.includes(ruleRef) ||
      entry.blockedRules.some(rule => rule.ruleRef === ruleRef)
    )
    .map(canonicalEntry);
}
