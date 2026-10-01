export const RELATION_KINDS = [
  'mapping',
  'candidates',
  'identity',
  'preserve'
] as const;

export type RelationKind = typeof RELATION_KINDS[number];

export const RELATION_CHANNELS = [
  'surface',
  'reading',
  'character_form'
] as const;

export type RelationChannel = typeof RELATION_CHANNELS[number];

export const APPLICATION_MODES = [
  'exact_lexeme',
  'substring_productive',
  'character_productive',
  'contextual',
  'generated_pattern',
  'preserve_block'
] as const;

export type ApplicationMode = typeof APPLICATION_MODES[number];

export const RESULT_BASES = [
  'source_exact',
  'source_contextual',
  'source_candidates',
  'dictionary_selected',
  'cross_channel_selected',
  'generated_productive_span',
  'generated_character',
  'generated_diachronic',
  'generated_rendering',
  'manual_preference',
  'implicit_identity',
  'attested_identity',
  'preserve_exact',
  'unresolved'
] as const;

export type ResultBasis = typeof RESULT_BASES[number];

export const IDENTITY_SEMANTICS = [
  'implicit',
  'attested',
  'preserve'
] as const;

export type IdentitySemantics = typeof IDENTITY_SEMANTICS[number];

export type RelationCardinality =
  | 'one_to_one'
  | 'one_to_many'
  | 'many_to_one'
  | 'many_to_many';

export interface NormalizedOrthographyRelation {
  id: string;
  relationKind: RelationKind;
  channel: RelationChannel;
  applicationMode: ApplicationMode;
  fromForms: string[];
  toForms: string[];
  basis: ResultBasis;
  sourceRefs?: string[];
  evidenceRefs: string[];
  lexicalIdentity?: string;
  requiredMorphology?: Record<string, string>;
  identitySemantics?: IdentitySemantics;
}

export interface NormalizedOrthographyGraph {
  schemaVersion: '1';
  kind: 'normalized_orthography_graph';
  lexicalNamespaceId: string;
  sources: Record<string, unknown>[];
  relations: NormalizedOrthographyRelation[];
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function cloneCanonical(value: unknown): any {
  if (Array.isArray(value)) {
    return value.map(item => cloneCanonical(item));
  }
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareText)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = cloneCanonical(child);
    }
    return output;
  }
  return value;
}

function requireForms(values: unknown, label: string): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`Normalized relation requires non-empty ${label}`);
  }
  const strings = values.map(value => {
    if (typeof value !== 'string' || value === '') {
      throw new TypeError(`Normalized relation requires non-empty ${label}`);
    }
    return value;
  });
  return canonicalStrings(strings);
}

export function relationCardinality(
  relation: Pick<NormalizedOrthographyRelation, 'fromForms' | 'toForms'>
): RelationCardinality {
  const fromForms = requireForms(relation.fromForms, 'fromForms');
  const toForms = requireForms(relation.toForms, 'toForms');
  if (fromForms.length === 1 && toForms.length === 1) return 'one_to_one';
  if (fromForms.length === 1) return 'one_to_many';
  if (toForms.length === 1) return 'many_to_one';
  return 'many_to_many';
}

export function canonicalizeNormalizedRelation(
  relation: NormalizedOrthographyRelation
): NormalizedOrthographyRelation {
  const normalized: NormalizedOrthographyRelation = {
    id: relation.id,
    relationKind: relation.relationKind,
    channel: relation.channel,
    applicationMode: relation.applicationMode,
    fromForms: requireForms(relation.fromForms, 'fromForms'),
    toForms: requireForms(relation.toForms, 'toForms'),
    basis: relation.basis,
    evidenceRefs: canonicalStrings(relation.evidenceRefs ?? [])
  };
  if (relation.sourceRefs !== undefined) {
    normalized.sourceRefs = canonicalStrings(relation.sourceRefs);
  }
  if (relation.lexicalIdentity !== undefined) {
    normalized.lexicalIdentity = relation.lexicalIdentity;
  }
  if (relation.requiredMorphology !== undefined) {
    normalized.requiredMorphology = cloneCanonical(relation.requiredMorphology);
  }
  if (relation.identitySemantics !== undefined) {
    normalized.identitySemantics = relation.identitySemantics;
  }
  return normalized;
}

export function canonicalizeNormalizedGraph(
  graph: NormalizedOrthographyGraph
): NormalizedOrthographyGraph {
  return {
    schemaVersion: '1',
    kind: 'normalized_orthography_graph',
    lexicalNamespaceId: graph.lexicalNamespaceId,
    sources: graph.sources
      .map(source => cloneCanonical(source))
      .sort((a, b) => compareText(
        `${a.sourceId ?? JSON.stringify(a)}`,
        `${b.sourceId ?? JSON.stringify(b)}`
      )),
    relations: graph.relations
      .map(canonicalizeNormalizedRelation)
      .sort((a, b) => compareText(a.id, b.id))
  };
}

export function canonicalStringifyNormalizedGraph(
  graph: NormalizedOrthographyGraph
): string {
  return JSON.stringify(canonicalizeNormalizedGraph(graph));
}
