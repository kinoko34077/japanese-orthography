import { kanaConventionGraph } from './kana-rule-normalization.ts';
import { projectOrthography } from './orthography-projection.ts';

export interface ScriptFoldOptions {
  scriptFoldable: boolean;
}

export type KanaRenderScript = 'hiragana' | 'katakana';

export interface FullSizeSokuonOptions {
  sameHistoricalRepresentation: boolean;
}

export interface IterationBoundaryOptions {
  boundaryOffsets?: number[];
}

export interface PresentationCandidateGroup {
  canonical: string;
  attestations: string[];
}

// ARCH-V2 E (#169): every convention below executes as a first-class v2 rule through the shared
// projection core; these exports remain as compatibility wrappers until the resolver cutover.
const KANA_GRAPH = kanaConventionGraph();

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function runRule(value: string, ruleId: string, thresholds: Record<string, boolean>, params: Record<string, unknown> = {}): string {
  const result = projectOrthography(
    { lexicalIdentity: null, surface: value, reading: null, morphology: null, factIds: [], retainedDistinctions: {} },
    KANA_GRAPH,
    { enabledRuleIds: [ruleId], thresholds, ruleParams: { [ruleId]: params } }
  );
  return result.state.surface;
}

export function foldKanaScript(value: string, options: ScriptFoldOptions): string {
  return runRule(value, 'rule:render:script-fold-hiragana', { scriptFoldable: options.scriptFoldable });
}

export function renderKanaScript(
  value: string,
  target: KanaRenderScript
): string {
  if (target === 'hiragana') return runRule(value, 'rule:render:script-fold-hiragana', { scriptFoldable: true });
  return runRule(value, 'rule:render:script-katakana', { renderKatakana: true });
}

export function expandIterationMarks(
  value: string,
  options: IterationBoundaryOptions = {}
): string {
  return runRule(value, 'rule:render:iteration-expand', { expandIterationMarks: true }, { boundaryOffsets: options.boundaryOffsets ?? [] });
}

export function renderIterationMarks(
  value: string,
  options: IterationBoundaryOptions = {}
): string {
  return runRule(value, 'rule:render:iteration-marks', { renderIterationMarks: true }, { boundaryOffsets: options.boundaryOffsets ?? [] });
}

export function renderSpanIteration(value: string, repeatedSpan: string): string {
  return runRule(value, 'rule:render:span-iteration-marks', { renderSpanIteration: true }, { repeatedSpan });
}

export function expandSpanIteration(value: string, repeatedSpan: string): string {
  return runRule(value, 'rule:render:span-iteration-expand', { expandSpanIteration: true }, { repeatedSpan });
}

function presentationCanonical(
  value: string,
  options: ScriptFoldOptions
): string {
  const folded = foldKanaScript(value, options);
  try {
    return expandIterationMarks(folded);
  } catch (error) {
    if (
      error instanceof RangeError &&
      /Span iteration marks require/.test(error.message)
    ) {
      return folded;
    }
    throw error;
  }
}

export function collapsePresentationCandidates(
  candidates: string[],
  options: ScriptFoldOptions
): PresentationCandidateGroup[] {
  const groups = new Map<string, Set<string>>();

  for (const candidate of candidates) {
    const canonical = presentationCanonical(candidate, options);
    const attestations = groups.get(canonical) ?? new Set<string>();
    attestations.add(candidate);
    groups.set(canonical, attestations);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([canonical, attestations]) => ({
      canonical,
      attestations: [...attestations].sort(compareText)
    }));
}

export function applyFullSizeSokuonPreference(
  value: string,
  options: FullSizeSokuonOptions
): string {
  return runRule(value, 'rule:render:full-size-sokuon', { fullSizeSokuon: true, sameHistoricalRepresentation: options.sameHistoricalRepresentation });
}
