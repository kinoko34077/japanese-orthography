// Orthography Architecture v2 — canonical knowledge model and migration accounting (#165, spec #163).
//
// The canonical graph holds literal source facts, first-class rules, rule bindings and the
// migration ledger. Literal facts never need a rule; rules never stand in for unjustified
// generalisation. Every admitted item carries provenance, and every migrated source record has
// exactly one explicit disposition, so nothing can silently disappear during migration.

export type OrthographyFactKind =
  | 'literal_form'
  | 'literal_reading'
  | 'form_relation'
  | 'reading_relation'
  | 'render_equivalence';

export type RuleClass = 'diachronic' | 'phonological' | 'orthographic' | 'render';
export type RuleDirectionality = 'forward_only' | 'reverse_traversable' | 'forward_infer_reverse';
export type RuleLossiness = 'lossless' | 'many_to_one' | 'one_to_many' | 'contextual';
export type MigrationDisposition =
  | 'literal_fact'
  | 'rule_definition'
  | 'rule_binding'
  | 'profile_policy'
  | 'derived_only'
  | 'excluded_with_reason';

export const FACT_KINDS: readonly OrthographyFactKind[] = ['literal_form', 'literal_reading', 'form_relation', 'reading_relation', 'render_equivalence'];
export const RULE_CLASSES: readonly RuleClass[] = ['diachronic', 'phonological', 'orthographic', 'render'];
export const RULE_DIRECTIONALITIES: readonly RuleDirectionality[] = ['forward_only', 'reverse_traversable', 'forward_infer_reverse'];
export const RULE_LOSSINESS: readonly RuleLossiness[] = ['lossless', 'many_to_one', 'one_to_many', 'contextual'];
export const MIGRATION_DISPOSITIONS: readonly MigrationDisposition[] = ['literal_fact', 'rule_definition', 'rule_binding', 'profile_policy', 'derived_only', 'excluded_with_reason'];

export interface OrthographyFact {
  id: string;
  kind: OrthographyFactKind;
  lexicalRefs: string[];
  surface?: string;
  reading?: string;
  /** relation target for form_relation / reading_relation / render_equivalence */
  target?: string;
  sourceRefs: string[];
  evidenceRefs: string[];
  periodRefs?: string[];
  tags?: string[];
}

export interface OrthographyRule {
  id: string;
  class: RuleClass;
  directionality: RuleDirectionality;
  lossiness: RuleLossiness;
  from: string[];
  to: string[];
  dependencies: string[];
  predicate?: Record<string, unknown>;
  sourceRefs: string[];
  evidenceRefs: string[];
}

export interface OrthographyRuleBinding {
  id: string;
  ruleId: string;
  lexicalRefs: string[];
  contextRefs?: string[];
  sourceRefs: string[];
  evidenceRefs: string[];
}

export interface SourceDisposition {
  sourceRecordId: string;
  disposition: MigrationDisposition;
  targetIds: string[];
  reason?: string;
}

export interface OrthographyKnowledgeGraph {
  schemaVersion: '2';
  kind: 'japanese-orthography-knowledge-graph';
  lexicalNamespaceId: string;
  sources: Record<string, unknown>[];
  facts: OrthographyFact[];
  rules: OrthographyRule[];
  bindings: OrthographyRuleBinding[];
  dispositions: SourceDisposition[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const uniqSorted = (values: readonly string[] | undefined) => [...new Set(values ?? [])].sort(cmp);
const sourceIdOf = (source: Record<string, unknown>) => (typeof source.sourceId === 'string' ? source.sourceId : '');

function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeys) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(cmp)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) out[key] = sortKeys(child);
    }
    return out as T;
  }
  return value;
}

// Set-like reference lists are sorted/deduplicated; rule from/to keep their declared order
// (a rule's input/output tuple is ordered data, not a set).
export function canonicalizeOrthographyKnowledge(graph: OrthographyKnowledgeGraph): OrthographyKnowledgeGraph {
  const refs = <T extends Record<string, unknown>>(item: T, keys: string[]): T => {
    const out: Record<string, unknown> = { ...item };
    for (const key of keys) if (Array.isArray(out[key])) out[key] = uniqSorted(out[key] as string[]);
    return sortKeys(out) as T;
  };
  const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => cmp(a.id, b.id));
  return {
    schemaVersion: graph.schemaVersion,
    kind: graph.kind,
    lexicalNamespaceId: graph.lexicalNamespaceId,
    sources: [...graph.sources].map(sortKeys).sort((a, b) => cmp(sourceIdOf(a), sourceIdOf(b))),
    facts: byId(graph.facts.map((f) => refs(f as unknown as Record<string, unknown>, ['lexicalRefs', 'sourceRefs', 'evidenceRefs', 'periodRefs', 'tags']) as unknown as OrthographyFact)),
    rules: byId(graph.rules.map((r) => refs(r as unknown as Record<string, unknown>, ['dependencies', 'sourceRefs', 'evidenceRefs']) as unknown as OrthographyRule)),
    bindings: byId(graph.bindings.map((b) => refs(b as unknown as Record<string, unknown>, ['lexicalRefs', 'contextRefs', 'sourceRefs', 'evidenceRefs']) as unknown as OrthographyRuleBinding)),
    dispositions: [...graph.dispositions]
      .map((d) => refs(d as unknown as Record<string, unknown>, ['targetIds']) as unknown as SourceDisposition)
      .sort((a, b) => cmp(a.sourceRecordId, b.sourceRecordId) || cmp(a.disposition, b.disposition))
  };
}

export function validateOrthographyKnowledge(graph: OrthographyKnowledgeGraph): string[] {
  const diagnostics: string[] = [];
  if (graph.schemaVersion !== '2') diagnostics.push(`unsupported schemaVersion ${String(graph.schemaVersion)}`);
  if (graph.kind !== 'japanese-orthography-knowledge-graph') diagnostics.push(`unsupported kind ${String(graph.kind)}`);
  if (!graph.lexicalNamespaceId) diagnostics.push('lexicalNamespaceId is required');

  const sourceIds = new Set<string>();
  for (const source of graph.sources) {
    const id = sourceIdOf(source);
    if (!id) diagnostics.push('source without sourceId');
    else if (sourceIds.has(id)) diagnostics.push(`duplicate source ${id}`);
    sourceIds.add(id);
  }

  const kindOf = new Map<string, 'fact' | 'rule' | 'binding'>();
  for (const [kind, items] of [['fact', graph.facts], ['rule', graph.rules], ['binding', graph.bindings]] as const) {
    for (const item of items) {
      if (!item.id) diagnostics.push(`${kind} without id`);
      else if (kindOf.has(item.id)) diagnostics.push(`duplicate id ${item.id}`);
      else kindOf.set(item.id, kind);
    }
  }

  const provenance = (id: string, item: { sourceRefs: string[]; evidenceRefs: string[] }) => {
    if (!Array.isArray(item.sourceRefs) || item.sourceRefs.length === 0) diagnostics.push(`${id} lacks provenance: no sourceRefs`);
    if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length === 0) diagnostics.push(`${id} lacks provenance: no evidenceRefs`);
    for (const ref of item.sourceRefs ?? []) if (!sourceIds.has(ref)) diagnostics.push(`${id} cites unknown source ${ref}`);
  };

  for (const fact of graph.facts) {
    provenance(fact.id, fact);
    if (!FACT_KINDS.includes(fact.kind)) diagnostics.push(`${fact.id} has unknown kind ${fact.kind}`);
    if (fact.kind === 'literal_form' && !fact.surface) diagnostics.push(`${fact.id} literal_form requires surface`);
    if (fact.kind === 'literal_reading' && !fact.reading) diagnostics.push(`${fact.id} literal_reading requires reading`);
    if ((fact.kind === 'form_relation' || fact.kind === 'reading_relation' || fact.kind === 'render_equivalence') && (!fact.surface && !fact.reading || !fact.target)) {
      diagnostics.push(`${fact.id} ${fact.kind} requires a source value and target`);
    }
  }

  const rules = new Map(graph.rules.map((r) => [r.id, r]));
  for (const rule of graph.rules) {
    provenance(rule.id, rule);
    if (!RULE_CLASSES.includes(rule.class)) diagnostics.push(`${rule.id} has unknown class ${rule.class}`);
    if (!RULE_DIRECTIONALITIES.includes(rule.directionality)) diagnostics.push(`${rule.id} has unknown directionality ${rule.directionality}`);
    if (!RULE_LOSSINESS.includes(rule.lossiness)) diagnostics.push(`${rule.id} has unknown lossiness ${rule.lossiness}`);
    if (!rule.from?.length || !rule.to?.length) diagnostics.push(`${rule.id} requires non-empty from/to`);
    if (rule.lossiness === 'many_to_one') {
      if (rule.from.length < 2 || rule.to.length !== 1) diagnostics.push(`${rule.id} many_to_one requires several inputs and one output`);
      if (rule.directionality === 'reverse_traversable') diagnostics.push(`${rule.id} is many_to_one and cannot be reverse_traversable`);
    }
    if (rule.lossiness === 'one_to_many' && (rule.from.length !== 1 || rule.to.length < 2)) diagnostics.push(`${rule.id} one_to_many requires one input and several outputs`);
    for (const dep of rule.dependencies ?? []) if (!rules.has(dep)) diagnostics.push(`${rule.id} depends on missing rule ${dep}`);
  }
  // dependency graph must be acyclic so a topological execution order exists
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') { diagnostics.push(`dependency cycle ${[...trail, id].join(' -> ')}`); return; }
    state.set(id, 'visiting');
    for (const dep of rules.get(id)?.dependencies ?? []) if (rules.has(dep)) visit(dep, [...trail, id]);
    state.set(id, 'done');
  };
  for (const id of [...rules.keys()].sort(cmp)) visit(id, []);

  for (const binding of graph.bindings) {
    provenance(binding.id, binding);
    if (!rules.has(binding.ruleId)) diagnostics.push(`${binding.id} references missing rule ${binding.ruleId}`);
  }

  const seenRecords = new Set<string>();
  const expectedKind: Partial<Record<MigrationDisposition, 'fact' | 'rule' | 'binding'>> = { literal_fact: 'fact', rule_definition: 'rule', rule_binding: 'binding' };
  for (const d of graph.dispositions) {
    const label = `${d.sourceRecordId} ${d.disposition}`;
    if (!d.sourceRecordId) diagnostics.push('disposition without sourceRecordId');
    if (seenRecords.has(d.sourceRecordId)) diagnostics.push(`${d.sourceRecordId} has more than one disposition`);
    seenRecords.add(d.sourceRecordId);
    if (!MIGRATION_DISPOSITIONS.includes(d.disposition)) { diagnostics.push(`${label} is not a known disposition`); continue; }
    const kind = expectedKind[d.disposition];
    if (kind) {
      if (!d.targetIds?.length) diagnostics.push(`${label} requires targets`);
      for (const target of d.targetIds ?? []) if (kindOf.get(target) !== kind) diagnostics.push(`${label} target ${target} is not a ${kind}`);
    }
    if (d.disposition === 'derived_only') {
      if (!d.reason) diagnostics.push(`${label} requires a reason`);
      for (const target of d.targetIds ?? []) if (!kindOf.has(target)) diagnostics.push(`${label} target ${target} does not exist`);
    }
    if (d.disposition === 'profile_policy' && !d.reason) diagnostics.push(`${label} requires a reason`);
    if (d.disposition === 'excluded_with_reason') {
      if (!d.reason) diagnostics.push(`${label} requires a reason`);
      if (d.targetIds?.length) diagnostics.push(`${label} must not have targets`);
    }
  }
  return diagnostics;
}

/** Compare the ledger with the record ids a source adapter enumerated. */
export function accountSourceRecords(graph: OrthographyKnowledgeGraph, expectedRecordIds: Iterable<string>): { missing: string[]; unexpected: string[] } {
  const ledger = new Set(graph.dispositions.map((d) => d.sourceRecordId));
  const expected = new Set(expectedRecordIds);
  return {
    missing: [...expected].filter((id) => !ledger.has(id)).sort(cmp),
    unexpected: [...ledger].filter((id) => !expected.has(id)).sort(cmp)
  };
}

export function summarizeSourceDispositions(graph: OrthographyKnowledgeGraph): Record<MigrationDisposition, number> {
  const summary = Object.fromEntries(MIGRATION_DISPOSITIONS.map((d) => [d, 0])) as Record<MigrationDisposition, number>;
  for (const d of graph.dispositions) if (d.disposition in summary) summary[d.disposition] += 1;
  return summary;
}
