import {
  APPLICABILITY_POLICIES,
  APPLICATION_MODES,
  IDENTITY_SEMANTICS,
  RELATION_CHANNELS,
  RELATION_KINDS,
  RESULT_BASES,
  canonicalizeNormalizedGraph,
  type NormalizedOrthographyGraph,
  type NormalizedOrthographyRelation,
  type RelationChannel
} from './normalized-relation-model.ts';

type CompactRelationRow = [
  number,
  number,
  number,
  number,
  number,
  number[],
  number[],
  number[] | null,
  number[],
  number | null,
  Array<[number, number]> | null,
  number | null,
  number | null // applicability (Phase 4.8E); schemaVersion 2
];

type CompactIndexRow = [number, number[]];

export interface CompactOrthographyArtifact {
  // '2' added the applicability column; '1' artifacts are rejected rather than defaulted.
  schemaVersion: '2';
  kind: 'compact_orthography_runtime';
  lexicalNamespaceId: string;
  sources: Record<string, unknown>[];
  strings: string[];
  relations: CompactRelationRow[];
  indexes: {
    surface: CompactIndexRow[];
    reading: CompactIndexRow[];
    character_form: CompactIndexRow[];
  };
}

export interface CompactArtifactMeasurement {
  canonicalBytes: number;
  compactBytes: number;
  savedBytes: number;
  ratio: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function enumIndex(values: readonly string[], value: string, label: string): number {
  const index = values.indexOf(value);
  if (index < 0) throw new TypeError('Unknown ' + label + ': ' + value);
  return index;
}

function collectStrings(graph: NormalizedOrthographyGraph): string[] {
  const values: string[] = [];
  for (const relation of graph.relations) {
    values.push(
      relation.id,
      ...relation.fromForms,
      ...relation.toForms,
      ...relation.evidenceRefs
    );
    if (relation.sourceRefs) values.push(...relation.sourceRefs);
    if (relation.lexicalIdentity) values.push(relation.lexicalIdentity);
    if (relation.requiredMorphology) {
      for (const [key, value] of Object.entries(relation.requiredMorphology)) {
        values.push(key, value);
      }
    }
  }
  return canonicalStrings(values);
}

function createStringIndex(strings: string[]): Map<string, number> {
  return new Map(strings.map((value, index) => [value, index]));
}

function stringId(index: Map<string, number>, value: string): number {
  const id = index.get(value);
  if (id === undefined) throw new Error('Missing compact string id');
  return id;
}

function encodeRelation(
  relation: NormalizedOrthographyRelation,
  strings: Map<string, number>
): CompactRelationRow {
  const morphology = relation.requiredMorphology
    ? Object.entries(relation.requiredMorphology)
        .sort(([a], [b]) => compareText(a, b))
        .map(([key, value]) => [
          stringId(strings, key),
          stringId(strings, value)
        ] as [number, number])
    : null;

  return [
    stringId(strings, relation.id),
    enumIndex(RELATION_KINDS, relation.relationKind, 'relation kind'),
    enumIndex(RELATION_CHANNELS, relation.channel, 'relation channel'),
    enumIndex(APPLICATION_MODES, relation.applicationMode, 'application mode'),
    enumIndex(RESULT_BASES, relation.basis, 'result basis'),
    relation.fromForms.map(value => stringId(strings, value)),
    relation.toForms.map(value => stringId(strings, value)),
    relation.sourceRefs === undefined
      ? null
      : relation.sourceRefs.map(value => stringId(strings, value)),
    relation.evidenceRefs.map(value => stringId(strings, value)),
    relation.lexicalIdentity === undefined
      ? null
      : stringId(strings, relation.lexicalIdentity),
    morphology,
    relation.identitySemantics === undefined
      ? null
      : enumIndex(IDENTITY_SEMANTICS, relation.identitySemantics, 'identity semantics'),
    relation.applicability === undefined
      ? null
      : enumIndex(APPLICABILITY_POLICIES, relation.applicability, 'applicability')
  ];
}

function buildIndexes(
  relations: CompactRelationRow[]
): CompactOrthographyArtifact['indexes'] {
  const maps = {
    surface: new Map<number, number[]>(),
    reading: new Map<number, number[]>(),
    character_form: new Map<number, number[]>()
  };

  for (let relationIndex = 0; relationIndex < relations.length; relationIndex += 1) {
    const row = relations[relationIndex]!;
    const channel = RELATION_CHANNELS[row[2]]!;
    const map = maps[channel];
    for (const fromId of row[5]) {
      const list = map.get(fromId) ?? [];
      list.push(relationIndex);
      map.set(fromId, list);
    }
  }

  const encode = (map: Map<number, number[]>): CompactIndexRow[] =>
    [...map.entries()]
      .sort(([a], [b]) => a - b)
      .map(([key, relationIndexes]) => [
        key,
        [...relationIndexes].sort((a, b) => a - b)
      ]);

  return {
    surface: encode(maps.surface),
    reading: encode(maps.reading),
    character_form: encode(maps.character_form)
  };
}

export function compileCompactOrthographyArtifact(
  input: NormalizedOrthographyGraph
): CompactOrthographyArtifact {
  const graph = canonicalizeNormalizedGraph(input);
  const strings = collectStrings(graph);
  const stringIndex = createStringIndex(strings);
  const relations = graph.relations.map(relation => encodeRelation(relation, stringIndex));

  return {
    schemaVersion: '2',
    kind: 'compact_orthography_runtime',
    lexicalNamespaceId: graph.lexicalNamespaceId,
    sources: structuredClone(graph.sources),
    strings,
    relations,
    indexes: buildIndexes(relations)
  };
}

function decodeString(strings: string[], id: number): string {
  const value = strings[id];
  if (value === undefined) throw new Error('Compact artifact string id out of bounds');
  return value;
}

function decodeRelation(
  artifact: CompactOrthographyArtifact,
  row: CompactRelationRow
): NormalizedOrthographyRelation {
  const relation: NormalizedOrthographyRelation = {
    id: decodeString(artifact.strings, row[0]),
    relationKind: RELATION_KINDS[row[1]]!,
    channel: RELATION_CHANNELS[row[2]]!,
    applicationMode: APPLICATION_MODES[row[3]]!,
    basis: RESULT_BASES[row[4]]!,
    fromForms: row[5].map(id => decodeString(artifact.strings, id)),
    toForms: row[6].map(id => decodeString(artifact.strings, id)),
    evidenceRefs: row[8].map(id => decodeString(artifact.strings, id))
  };

  if (row[7] !== null) {
    relation.sourceRefs = row[7].map(id => decodeString(artifact.strings, id));
  }
  if (row[9] !== null) {
    relation.lexicalIdentity = decodeString(artifact.strings, row[9]);
  }
  if (row[10] !== null) {
    relation.requiredMorphology = Object.fromEntries(
      row[10].map(([keyId, valueId]) => [
        decodeString(artifact.strings, keyId),
        decodeString(artifact.strings, valueId)
      ])
    );
  }
  if (row[11] !== null) {
    relation.identitySemantics = IDENTITY_SEMANTICS[row[11]]!;
  }
  if (row.length !== 13) throw new TypeError('Compact relation row must have 13 columns (schemaVersion 2)');
  if (row[12] !== null) {
    const applicability = APPLICABILITY_POLICIES[row[12]];
    if (applicability === undefined) throw new TypeError(`Compact relation applicability index out of range: ${row[12]}`);
    relation.applicability = applicability;
  }
  return relation;
}

export function inflateCompactOrthographyArtifact(
  artifact: CompactOrthographyArtifact
): NormalizedOrthographyGraph {
  if (
    artifact?.schemaVersion !== '2' ||
    artifact?.kind !== 'compact_orthography_runtime'
  ) {
    throw new TypeError('Unsupported compact orthography artifact');
  }
  return canonicalizeNormalizedGraph({
    schemaVersion: '1',
    kind: 'normalized_orthography_graph',
    lexicalNamespaceId: artifact.lexicalNamespaceId,
    sources: structuredClone(artifact.sources),
    relations: artifact.relations.map(row => decodeRelation(artifact, row))
  });
}

export function canonicalStringifyCompactArtifact(
  artifact: CompactOrthographyArtifact
): string {
  return JSON.stringify(artifact);
}

function findStringId(strings: string[], value: string): number | null {
  let low = 0;
  let high = strings.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const current = strings[middle]!;
    const compared = compareText(current, value);
    if (compared === 0) return middle;
    if (compared < 0) low = middle + 1;
    else high = middle - 1;
  }
  return null;
}

function findIndexRow(rows: CompactIndexRow[], key: number): CompactIndexRow | null {
  let low = 0;
  let high = rows.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const current = rows[middle]!;
    if (current[0] === key) return current;
    if (current[0] < key) low = middle + 1;
    else high = middle - 1;
  }
  return null;
}

export function createCompactOrthographyRuntime(
  artifact: CompactOrthographyArtifact
): {
  lookup(channel: RelationChannel, from: string): NormalizedOrthographyRelation[];
} {
  if (
    artifact?.schemaVersion !== '2' ||
    artifact?.kind !== 'compact_orthography_runtime'
  ) {
    throw new TypeError('Unsupported compact orthography artifact');
  }

  return {
    lookup(channel: RelationChannel, from: string): NormalizedOrthographyRelation[] {
      const id = findStringId(artifact.strings, from);
      if (id === null) return [];
      const indexRow = findIndexRow(artifact.indexes[channel], id);
      if (!indexRow) return [];
      return indexRow[1].map(relationIndex => {
        const row = artifact.relations[relationIndex];
        if (!row) throw new Error('Compact relation index out of bounds');
        return decodeRelation(artifact, row);
      });
    }
  };
}

export function measureCompactOrthographyArtifact(
  graph: NormalizedOrthographyGraph,
  artifact: CompactOrthographyArtifact
): CompactArtifactMeasurement {
  const canonicalBytes = Buffer.byteLength(
    JSON.stringify(canonicalizeNormalizedGraph(graph)),
    'utf8'
  );
  const compactBytes = Buffer.byteLength(
    canonicalStringifyCompactArtifact(artifact),
    'utf8'
  );
  return {
    canonicalBytes,
    compactBytes,
    savedBytes: canonicalBytes - compactBytes,
    ratio: compactBytes / canonicalBytes
  };
}
