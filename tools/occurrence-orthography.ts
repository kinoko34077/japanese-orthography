import type { NormalizedOrthographyRelation } from './normalized-relation-model.ts';
import type { LexicalSpan, LexicalSpanGraph, SpanMorphology } from './lexical-span-analysis.ts';
import { primarySpanPath, spansForPath } from './lexical-span-analysis.ts';

export const OCCURRENCE_POLICIES = [
  'anywhere',
  'whole_lexeme',
  'whole_morpheme',
  'compound_component',
  'lexical_or_component',
  'left_boundary',
  'right_boundary',
  'both_boundaries'
] as const;
export type OccurrencePolicy = typeof OCCURRENCE_POLICIES[number];

export interface OccurrenceResolverOptions {
  policies?: Record<string, OccurrencePolicy>;
}

export interface OccurrenceApplied {
  relationId: string;
  start: number;
  end: number;
  input: string;
  output: string;
  policy: OccurrencePolicy;
  evidence: 'lexeme' | 'component' | 'boundary' | 'anywhere';
}

export interface OccurrenceBlocked {
  relationId: string;
  start: number;
  end: number;
  input: string;
  reason:
    | 'policy_mismatch'
    | 'lexical_constraint_mismatch'
    | 'morphology_constraint_mismatch'
    | 'overlaps_preserve'
    | 'conflicting_outputs'
    | 'overlap_lost_arbitration';
}

export interface OccurrenceResolution {
  input: string;
  output: string;
  applied: OccurrenceApplied[];
  blocked: OccurrenceBlocked[];
}

interface RawMatch {
  relation: NormalizedOrthographyRelation;
  start: number;
  end: number;
  input: string;
  output: string;
  policy: OccurrencePolicy;
  evidence: OccurrenceApplied['evidence'];
  authority: number;
}

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const chars = (value: string) => Array.from(value);

function starts(input: string[], needle: string[]): number[] {
  const out: number[] = [];
  for (let i = 0; i <= input.length - needle.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) if (input[i + j] !== needle[j]) { ok = false; break; }
    if (ok) out.push(i);
  }
  return out;
}

function candidateSpans(graph: LexicalSpanGraph) {
  const primaryPath = primarySpanPath(graph);
  const primary = primaryPath ? spansForPath(graph, primaryPath).filter((s) => s.kind === 'lexical') : [];
  const byId = new Map(graph.spans.map((s) => [s.id, s]));
  const components: LexicalSpan[] = [];
  for (const parent of primary) {
    for (const path of parent.componentPaths) {
      for (const id of path) {
        const span = byId.get(id);
        if (span?.kind === 'lexical') components.push(span);
      }
    }
  }
  const unique = (values: LexicalSpan[]) => [...new Map(values.map((s) => [s.id, s])).values()];
  return { primary: unique(primary), components: unique(components) };
}

function spansAt(spans: LexicalSpan[], start: number, end: number): LexicalSpan[] {
  return spans.filter((span) => span.start === start && span.end === end);
}

function morphologyMatches(morphology: SpanMorphology, required: Record<string, string>): boolean {
  for (const [key, value] of Object.entries(required)) {
    if (key === 'partOfSpeech') {
      if (!morphology.partOfSpeech.includes(value)) return false;
    } else if (key === 'conjugationType') {
      if (morphology.conjugationType !== value) return false;
    } else if (key === 'conjugationForm') {
      if (morphology.conjugationForm !== value) return false;
    } else {
      return false;
    }
  }
  return true;
}

function relationConstraints(
  relation: NormalizedOrthographyRelation,
  spans: LexicalSpan[]
): 'ok' | 'lexical_constraint_mismatch' | 'morphology_constraint_mismatch' {
  if (relation.lexicalIdentity !== undefined) {
    const lexical = spans.some((span) => span.candidates.some((candidate) =>
      candidate.lexicalIdentity === relation.lexicalIdentity ||
      candidate.entityLexemes.includes(relation.lexicalIdentity as any)
    ));
    if (!lexical) return 'lexical_constraint_mismatch';
  }
  if (relation.requiredMorphology !== undefined) {
    const morphology = spans.some((span) => span.candidates.some((candidate) =>
      morphologyMatches(candidate.morphology, relation.requiredMorphology!)
    ));
    if (!morphology) return 'morphology_constraint_mismatch';
  }
  return 'ok';
}

function policyEvidence(
  policy: OccurrencePolicy,
  start: number,
  end: number,
  primary: LexicalSpan[],
  components: LexicalSpan[]
): { evidence: RawMatch['evidence']; authority: number; spans: LexicalSpan[] } | null {
  const primaryExact = spansAt(primary, start, end);
  const componentExact = spansAt(components, start, end);
  const boundaries = new Set(primary.flatMap((span) => [span.start, span.end]));
  if (policy === 'anywhere') return { evidence: 'anywhere', authority: 10, spans: [...primaryExact, ...componentExact] };
  if (policy === 'whole_lexeme' && primaryExact.length) return { evidence: 'lexeme', authority: 50, spans: primaryExact };
  if (policy === 'compound_component' && componentExact.length) return { evidence: 'component', authority: 45, spans: componentExact };
  if (policy === 'lexical_or_component') {
    if (primaryExact.length) return { evidence: 'lexeme', authority: 50, spans: primaryExact };
    if (componentExact.length) return { evidence: 'component', authority: 45, spans: componentExact };
    return null;
  }
  if (policy === 'whole_morpheme' && componentExact.length) return { evidence: 'component', authority: 45, spans: componentExact };
  if (policy === 'left_boundary' && boundaries.has(start)) return { evidence: 'boundary', authority: 30, spans: [...primaryExact, ...componentExact] };
  if (policy === 'right_boundary' && boundaries.has(end)) return { evidence: 'boundary', authority: 30, spans: [...primaryExact, ...componentExact] };
  if (policy === 'both_boundaries' && boundaries.has(start) && boundaries.has(end)) return { evidence: 'boundary', authority: 35, spans: [...primaryExact, ...componentExact] };
  return null;
}

function defaultPolicy(relation: NormalizedOrthographyRelation): OccurrencePolicy {
  if (relation.applicationMode === 'character_productive') return 'anywhere';
  if (relation.applicationMode === 'substring_productive') return 'lexical_or_component';
  return 'whole_lexeme';
}

function chooseCompatible(matches: RawMatch[]): RawMatch[] {
  const ordered = [...matches].sort((a, b) =>
    a.end - b.end || a.start - b.start || cmp(a.relation.id, b.relation.id)
  );
  type Plan = { matches: RawMatch[]; score: number; covered: number };
  const plans: Plan[] = [];
  const better = (a: Plan, b: Plan): Plan => {
    if (a.score !== b.score) return a.score > b.score ? a : b;
    if (a.covered !== b.covered) return a.covered > b.covered ? a : b;
    if (a.matches.length !== b.matches.length) return a.matches.length < b.matches.length ? a : b;
    const ak = a.matches.map((m) => `${m.start}:${m.end}:${m.relation.id}`).join('|');
    const bk = b.matches.map((m) => `${m.start}:${m.end}:${m.relation.id}`).join('|');
    return cmp(ak, bk) <= 0 ? a : b;
  };
  for (let i = 0; i < ordered.length; i += 1) {
    let prev = i - 1;
    while (prev >= 0 && ordered[prev]!.end > ordered[i]!.start) prev -= 1;
    const base = prev >= 0 ? plans[prev]! : { matches: [], score: 0, covered: 0 };
    const take: Plan = {
      matches: [...base.matches, ordered[i]!],
      score: base.score + ordered[i]!.authority,
      covered: base.covered + ordered[i]!.end - ordered[i]!.start
    };
    const skip = i > 0 ? plans[i - 1]! : { matches: [], score: 0, covered: 0 };
    plans.push(better(take, skip));
  }
  return (plans.at(-1)?.matches ?? []).sort((a, b) => a.start - b.start || a.end - b.end || cmp(a.relation.id, b.relation.id));
}

export function resolveOccurrenceOrthography(
  input: string,
  relations: NormalizedOrthographyRelation[],
  spanGraph: LexicalSpanGraph,
  options: OccurrenceResolverOptions = {}
): OccurrenceResolution {
  const inputChars = chars(input);
  if (spanGraph.input !== inputChars.join('')) throw new Error('span graph/input mismatch');
  const { primary, components } = candidateSpans(spanGraph);
  const blocked: OccurrenceBlocked[] = [];
  const candidates: RawMatch[] = [];
  const preserve: Array<{ start: number; end: number }> = [];

  for (const relation of [...relations].sort((a, b) => cmp(a.id, b.id))) {
    for (const from of relation.fromForms) {
      const needle = chars(from);
      for (const start of starts(inputChars, needle)) {
        const end = start + needle.length;
        if (relation.applicationMode === 'preserve_block') {
          preserve.push({ start, end });
          continue;
        }
        if (relation.applicationMode !== 'substring_productive' && relation.applicationMode !== 'character_productive') continue;
        const output = relation.toForms[0];
        if (output === undefined) continue;
        const policy = options.policies?.[relation.id] ?? defaultPolicy(relation);
        const evidence = policyEvidence(policy, start, end, primary, components);
        if (!evidence) {
          blocked.push({ relationId: relation.id, start, end, input: from, reason: 'policy_mismatch' });
          continue;
        }
        const constraints = relationConstraints(relation, evidence.spans);
        if (constraints !== 'ok') {
          blocked.push({ relationId: relation.id, start, end, input: from, reason: constraints });
          continue;
        }
        candidates.push({ relation, start, end, input: from, output, policy, evidence: evidence.evidence, authority: evidence.authority });
      }
    }
  }

  const available: RawMatch[] = [];
  for (const match of candidates) {
    if (preserve.some((p) => match.start < p.end && p.start < match.end)) {
      blocked.push({ relationId: match.relation.id, start: match.start, end: match.end, input: match.input, reason: 'overlaps_preserve' });
    } else available.push(match);
  }

  const conflicts = new Set<string>();
  const byInterval = new Map<string, Set<string>>();
  for (const match of available) {
    const key = `${match.start}:${match.end}`;
    const outputs = byInterval.get(key) ?? new Set<string>();
    outputs.add(match.output);
    byInterval.set(key, outputs);
  }
  for (const [key, outputs] of byInterval) if (outputs.size > 1) conflicts.add(key);
  const nonConflicting = available.filter((match) => {
    const key = `${match.start}:${match.end}`;
    if (!conflicts.has(key)) return true;
    blocked.push({ relationId: match.relation.id, start: match.start, end: match.end, input: match.input, reason: 'conflicting_outputs' });
    return false;
  });

  const bestByStart = new Map<number, { authority: number; length: number }>();
  for (const match of nonConflicting) {
    const prior = bestByStart.get(match.start);
    const length = match.end - match.start;
    if (
      prior === undefined ||
      match.authority > prior.authority ||
      (match.authority === prior.authority && length > prior.length)
    ) {
      bestByStart.set(match.start, { authority: match.authority, length });
    }
  }
  const sameStartFiltered = nonConflicting.filter((match) => {
    const best = bestByStart.get(match.start)!;
    const keep = match.authority === best.authority && match.end - match.start === best.length;
    if (!keep) blocked.push({
      relationId: match.relation.id,
      start: match.start,
      end: match.end,
      input: match.input,
      reason: 'overlap_lost_arbitration'
    });
    return keep;
  });

  const selected = chooseCompatible(sameStartFiltered);
  const selectedKeys = new Set(selected.map((m) => `${m.start}:${m.end}:${m.relation.id}`));
  for (const match of sameStartFiltered) {
    const key = `${match.start}:${match.end}:${match.relation.id}`;
    if (!selectedKeys.has(key)) blocked.push({
      relationId: match.relation.id, start: match.start, end: match.end,
      input: match.input, reason: 'overlap_lost_arbitration'
    });
  }

  let output = '';
  let offset = 0;
  for (const match of selected) {
    output += inputChars.slice(offset, match.start).join('') + match.output;
    offset = match.end;
  }
  output += inputChars.slice(offset).join('');

  const applied: OccurrenceApplied[] = selected.map((match) => ({
    relationId: match.relation.id, start: match.start, end: match.end,
    input: match.input, output: match.output, policy: match.policy, evidence: match.evidence
  }));
  blocked.sort((a, b) => a.start - b.start || a.end - b.end || cmp(a.relationId, b.relationId) || cmp(a.reason, b.reason));
  return { input, output, applied, blocked };
}
