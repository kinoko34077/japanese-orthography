import type { KnowledgeOrigin, OrthographyFact, OrthographyKnowledgeGraph, OrthographyRule } from './orthography-knowledge-model.ts';
import type { ProjectionPolicy } from './orthography-projection.ts';

// ARCH-V2 G (#171): profiles are operational configuration over shared knowledge. They enable or
// disable rules, choose a target period, set gates, and pick among attested forms; they never
// recreate generic facts. Only unattested derivation is `kinotch_derived` (validated by the model).

export interface OrthographyProfilePolicy {
  profileId: string;
  targetPeriod?: string | null;
  enableRules: string[];
  disableRules: string[];
  thresholds: Record<string, string | number | boolean>;
  candidatePolicy: 'preserve_all' | 'precedence' | 'profile_choice';
  allowOrigins: KnowledgeOrigin[];
}

const ORIGIN_DEFAULT: KnowledgeOrigin = 'historically_attested';
const originOf = (item: { origin?: KnowledgeOrigin }) => item.origin ?? ORIGIN_DEFAULT;

/** JMdict form tags a profile must opt into before such forms are offered. */
export const FORM_TAG_GATES: Record<string, string> = { ateji: 'ateji', rK: 'rareKanji', oK: 'outdatedKanji', iK: 'irregularKanji', io: 'irregularOkurigana' };
/** search-only / never-written forms are never offered. */
const NEVER_OFFERED = new Set(['sK']);
const MODERN_USAGE_KEYS = new Set(['modernUsageTier', 'modernFrequency']);

export const KINOTCH_PROFILE_SOURCE = 'profiles/kinotch/token-style-overlay';
// こと -> ヿ remains behaviourally available as a KiNoTch profile rule. Its authority stays the
// accepted profile classification (#166 ledger: profile_policy); reclassification is separate work (#47).
export const KINOTCH_PROFILE_RULES: readonly OrthographyRule[] = [
  {
    id: 'rule:profile:kinotch:koto-ligature', class: 'render', directionality: 'forward_only', lossiness: 'lossless',
    from: ['こと'], to: ['ヿ'], dependencies: [],
    predicate: { channel: 'surface', exactToken: true, defaultEnabled: false },
    origin: 'project_defined',
    sourceRefs: [KINOTCH_PROFILE_SOURCE], evidenceRefs: ['data/profiles/kinotch/token-style-overlay.json#こと']
  }
];

// #196 G / #47: the bounded KiNoTch style slice selected for the Browser profile — the Phase-4.6F
// okurigana-abbreviation family (stage 30), each rule one 4.6F record classified `kinotch_style` and
// `admitted` (test-locked to data/intake/phase46f-kinotch-profile.json). Project style, never generic
// authority: disabled unless a profile enables it. No Stage-60, punctuation or semantic-override
// records are admitted here.
export const KINOTCH_STYLE_SOURCE = 'intake/phase46f-kinotch-profile';
export const KINOTCH_OKURIGANA_STYLE: ReadonlyArray<{ readonly from: string; readonly to: string; readonly record: string }> = [
  { from: '分かる', to: '分る', record: 'phase46f:phase46f-txt-auto-stage30:rules[0]' },
  { from: '悩み', to: '悩', record: 'phase46f:phase46f-txt-auto-stage30:rules[1]' },
  { from: '書き出す', to: '書出す', record: 'phase46f:phase46f-txt-auto-stage30:rules[2]' },
  { from: '当たる', to: '当る', record: 'phase46f:phase46f-txt-auto-stage30:rules[3]' }
];
export const KINOTCH_STYLE_RULES: readonly OrthographyRule[] = KINOTCH_OKURIGANA_STYLE.map(({ from, to, record }) => ({
  id: `rule:profile:kinotch:okurigana:${from}>${to}`, class: 'render', directionality: 'forward_only', lossiness: 'lossless',
  from: [from], to: [to], dependencies: [],
  predicate: { channel: 'surface', exactToken: true, defaultEnabled: false, styleFamily: 'okurigana-abbreviation' },
  origin: 'project_defined',
  sourceRefs: [KINOTCH_STYLE_SOURCE], evidenceRefs: [record]
}));

export function withProfileRules(graph: OrthographyKnowledgeGraph): OrthographyKnowledgeGraph {
  const out = structuredClone(graph);
  if (!out.sources.some((s) => s.sourceId === KINOTCH_PROFILE_SOURCE)) out.sources.push({ sourceId: KINOTCH_PROFILE_SOURCE, path: 'data/profiles/kinotch/token-style-overlay.json', role: 'kinotch-profile' });
  if (!out.sources.some((s) => s.sourceId === KINOTCH_STYLE_SOURCE)) out.sources.push({ sourceId: KINOTCH_STYLE_SOURCE, path: 'data/intake/phase46f-kinotch-profile.json', role: 'phase46-intake' });
  for (const rule of [...KINOTCH_PROFILE_RULES, ...KINOTCH_STYLE_RULES]) if (!out.rules.some((r) => r.id === rule.id)) out.rules.push(structuredClone(rule));
  return out;
}

export const MODERN_PROFILE: OrthographyProfilePolicy = {
  profileId: 'modern', targetPeriod: 'modern', enableRules: [], disableRules: [], thresholds: {},
  candidatePolicy: 'preserve_all', allowOrigins: ['historically_attested']
};
export const HISTORICAL_PROFILE: OrthographyProfilePolicy = {
  profileId: 'historical', targetPeriod: 'historical', enableRules: [], disableRules: [], thresholds: { renderIterationMarks: true },
  candidatePolicy: 'preserve_all', allowOrigins: ['historically_attested']
};
export const KINOTCH_PROFILE: OrthographyProfilePolicy = {
  profileId: 'kinotch-fixed', targetPeriod: 'historical', enableRules: ['rule:profile:kinotch:koto-ligature', ...KINOTCH_STYLE_RULES.map((r) => r.id)], disableRules: [],
  thresholds: { renderIterationMarks: true }, candidatePolicy: 'profile_choice', allowOrigins: ['historically_attested', 'project_defined', 'tar']
};

function validateThresholds(profile: OrthographyProfilePolicy, graph: OrthographyKnowledgeGraph) {
  const known = new Set<string>(Object.values(FORM_TAG_GATES));
  for (const rule of graph.rules) for (const flag of (rule.predicate?.policyFlags as string[] | undefined) ?? []) known.add(flag);
  for (const key of Object.keys(profile.thresholds)) {
    if (MODERN_USAGE_KEYS.has(key)) {
      // conventionality/frequency tiers need a corpus source contract (#163 §10); none is admitted
      if (!graph.sources.some((s) => s.role === 'modern-usage-corpus')) throw new Error(`profile ${profile.profileId}: threshold ${key} requires data but there is no modern-usage source`);
      continue;
    }
    if (!known.has(key)) throw new Error(`profile ${profile.profileId}: unknown threshold ${key}`);
  }
}

export function resolveProjectionPolicy(profile: OrthographyProfilePolicy, graph: OrthographyKnowledgeGraph): ProjectionPolicy {
  const rules = new Map(graph.rules.map((r) => [r.id, r]));
  for (const id of [...profile.enableRules, ...profile.disableRules]) if (!rules.has(id)) throw new Error(`profile ${profile.profileId}: unknown rule ${id}`);
  validateThresholds(profile, graph);
  const allowed = new Set(profile.allowOrigins);
  const enabled = new Set(profile.enableRules);
  for (const id of enabled) if (!allowed.has(originOf(rules.get(id)!))) throw new Error(`profile ${profile.profileId}: rule ${id} has origin ${originOf(rules.get(id)!)} outside allowOrigins`);
  const disabled = new Set(profile.disableRules);
  for (const rule of graph.rules) {
    if (!allowed.has(originOf(rule))) disabled.add(rule.id);
    if (rule.predicate?.defaultEnabled === false && !enabled.has(rule.id)) disabled.add(rule.id);
  }
  return {
    period: profile.targetPeriod ?? null,
    disabledRuleIds: [...disabled].sort(),
    thresholds: { ...profile.thresholds },
    candidatePolicy: profile.candidatePolicy
  };
}

/** Attested written forms of a lexeme the profile admits (selection, not re-creation). */
export function selectForms(lexicalRef: string, graph: OrthographyKnowledgeGraph, profile: OrthographyProfilePolicy): OrthographyFact[] {
  const allowed = new Set(profile.allowOrigins);
  return graph.facts
    .filter((f) => f.kind === 'literal_form' && f.lexicalRefs.includes(lexicalRef) && allowed.has(originOf(f)))
    .filter((f) => (f.tags ?? []).every((tag) => !NEVER_OFFERED.has(tag) && (!(tag in FORM_TAG_GATES) || profile.thresholds[FORM_TAG_GATES[tag]!] === true)))
    .sort((a, b) => (a.surface! < b.surface! ? -1 : a.surface! > b.surface! ? 1 : 0));
}
