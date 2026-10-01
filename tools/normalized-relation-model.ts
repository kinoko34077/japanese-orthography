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

function sameCanonicalStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function assertNormalizedRelationSemantics(
  relation: NormalizedOrthographyRelation
): void {
  const { relationKind, applicationMode, fromForms, toForms, basis, identitySemantics } = relation;

  if (applicationMode === 'preserve_block' && relationKind !== 'preserve') {
    throw new TypeError(
      `Normalized relation ${relation.id}: preserve_block requires preserve relation kind`
    );
  }

  if (relationKind === 'identity') {
    if (identitySemantics === undefined) {
      throw new TypeError(
        `Normalized relation ${relation.id}: identity relation requires identity semantics`
      );
    }
    if (!sameCanonicalStrings(fromForms, toForms)) {
      throw new TypeError(
        `Normalized relation ${relation.id}: identity relation must preserve the same form set`
      );
    }
    if (identitySemantics === 'implicit' && basis !== 'implicit_identity') {
      throw new TypeError(
        `Normalized relation ${relation.id}: implicit identity requires implicit_identity basis`
      );
    }
    if (identitySemantics === 'attested' && basis !== 'attested_identity') {
      throw new TypeError(
        `Normalized relation ${relation.id}: attested identity requires attested_identity basis`
      );
    }
    if (identitySemantics === 'preserve') {
      throw new TypeError(
        `Normalized relation ${relation.id}: preserve identity must use preserve relation kind`
      );
    }
  }

  if (relationKind === 'preserve') {
    if (!sameCanonicalStrings(fromForms, toForms)) {
      throw new TypeError(
        `Normalized relation ${relation.id}: preserve relation must preserve the same form set`
      );
    }
    if (applicationMode !== 'preserve_block') {
      throw new TypeError(
        `Normalized relation ${relation.id}: preserve relation requires preserve_block application mode`
      );
    }
    if (identitySemantics !== 'preserve') {
      throw new TypeError(
        `Normalized relation ${relation.id}: preserve relation requires preserve identity semantics`
      );
    }
    if (basis !== 'preserve_exact') {
      throw new TypeError(
        `Normalized relation ${relation.id}: preserve relation requires preserve_exact basis`
      );
    }
  }

  if (
    (applicationMode === 'substring_productive' ||
      applicationMode === 'character_productive') &&
    (relationKind !== 'mapping' || toForms.length !== 1)
  ) {
    throw new TypeError(
      `Normalized relation ${relation.id}: productive relation must be deterministic mapping`
    );
  }

  if (
    applicationMode === 'character_productive' &&
    (
      fromForms.some(form => codePointLength(form) !== 1) ||
      codePointLength(toForms[0] ?? '') !== 1
    )
  ) {
    throw new TypeError(
      `Normalized relation ${relation.id}: character_productive relation must map single code points`
    );
  }

  if (relationKind === 'mapping' && toForms.length !== 1) {
    throw new TypeError(
      `Normalized relation ${relation.id}: mapping relation requires exactly one target form`
    );
  }

  if (
    identitySemantics !== undefined &&
    relationKind !== 'identity' &&
    relationKind !== 'preserve'
  ) {
    throw new TypeError(
      `Normalized relation ${relation.id}: identitySemantics requires identity or preserve relation kind`
    );
  }
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
  assertNormalizedRelationSemantics(normalized);
  return normalized;
}

export function canonicalizeNormalizedGraph(
  graph: NormalizedOrthographyGraph
): NormalizedOrthographyGraph {
  const relations = graph.relations
    .map(canonicalizeNormalizedRelation)
    .sort((a, b) => compareText(a.id, b.id));

  for (let index = 1; index < relations.length; index += 1) {
    if (relations[index - 1]!.id === relations[index]!.id) {
      throw new TypeError(`Duplicate normalized relation id: ${relations[index]!.id}`);
    }
  }

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
    relations
  };
}

export function canonicalStringifyNormalizedGraph(
  graph: NormalizedOrthographyGraph
): string {
  return JSON.stringify(canonicalizeNormalizedGraph(graph));
}
