import type {
  NormalizedOrthographyGraph,
  NormalizedOrthographyRelation
} from './normalized-relation-model.ts';
import { canonicalizeNormalizedGraph } from './normalized-relation-model.ts';

type JsonRecord = Record<string, any>;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function stableIdPart(value: string): string {
  return encodeURIComponent(value);
}

function relationBase(
  id: string,
  channel: 'surface' | 'reading',
  relationKind: 'mapping' | 'candidates',
  from: string,
  to: string[],
  basis: 'source_exact' | 'source_candidates',
  row: JsonRecord
): NormalizedOrthographyRelation {
  const relation: NormalizedOrthographyRelation = {
    id,
    relationKind,
    channel,
    applicationMode: 'exact_lexeme',
    fromForms: [from],
    toForms: canonicalStrings(to),
    basis,
    evidenceRefs: canonicalStrings(row.evidenceRefs ?? [])
  };
  if (row.sourceRefs !== undefined) {
    relation.sourceRefs = canonicalStrings(row.sourceRefs ?? []);
  }
  return relation;
}

function requireNativeArtifact(artifact: JsonRecord): void {
  if (
    artifact?.schemaVersion !== '2' ||
    artifact?.kind !== 'japanese-orthography-historical-native-artifact' ||
    typeof artifact?.lexicalNamespaceId !== 'string' ||
    !Array.isArray(artifact?.sources)
  ) {
    throw new TypeError('Phase 4.7A requires the accepted Phase 4.6D native artifact');
  }
}

export function projectPhase46dNativeArtifact(
  artifact: JsonRecord
): NormalizedOrthographyGraph {
  requireNativeArtifact(artifact);
  const relations: NormalizedOrthographyRelation[] = [];

  for (const row of artifact.identityRelations ?? []) {
    const relation = relationBase(
      `native:lexical:${stableIdPart(row.lexicalIdentity)}`,
      'surface',
      'mapping',
      row.surface,
      [row.historicalSurface],
      'source_exact',
      row
    );
    relation.lexicalIdentity = row.lexicalIdentity;
    if (row.requiredMorphology !== undefined) {
      relation.requiredMorphology = structuredClone(row.requiredMorphology);
    }
    relations.push(relation);
  }

  for (const row of artifact.surfaceRelations ?? []) {
    relations.push(relationBase(
      `native:surface:exact:${stableIdPart(row.surface)}`,
      'surface',
      'mapping',
      row.surface,
      [row.historicalSurface],
      'source_exact',
      row
    ));
  }

  for (const row of artifact.readingRelations ?? []) {
    relations.push(relationBase(
      `native:reading:exact:${stableIdPart(row.surface)}`,
      'reading',
      'mapping',
      row.surface,
      [row.historicalReading],
      'source_exact',
      row
    ));
  }

  for (const row of artifact.ambiguousSurfaceCandidates ?? []) {
    relations.push(relationBase(
      `native:surface:candidates:${stableIdPart(row.surface)}`,
      'surface',
      'candidates',
      row.surface,
      row.alternatives,
      'source_candidates',
      row
    ));
  }

  for (const row of artifact.ambiguousReadingCandidates ?? []) {
    relations.push(relationBase(
      `native:reading:candidates:${stableIdPart(row.surface)}`,
      'reading',
      'candidates',
      row.surface,
      row.alternatives,
      'source_candidates',
      row
    ));
  }

  return canonicalizeNormalizedGraph({
    schemaVersion: '1',
    kind: 'normalized_orthography_graph',
    lexicalNamespaceId: artifact.lexicalNamespaceId,
    sources: structuredClone(artifact.sources),
    relations
  });
}

function exactTarget(relation: NormalizedOrthographyRelation): string {
  if (relation.fromForms.length !== 1 || relation.toForms.length !== 1) {
    throw new TypeError(`Cannot restore non-exact normalized relation: ${relation.id}`);
  }
  return relation.toForms[0]!;
}

function exactSource(relation: NormalizedOrthographyRelation): string {
  if (relation.fromForms.length !== 1) {
    throw new TypeError(`Cannot restore multi-source normalized relation: ${relation.id}`);
  }
  return relation.fromForms[0]!;
}

function refs(relation: NormalizedOrthographyRelation): {
  sourceRefs?: string[];
  evidenceRefs: string[];
} {
  const output: { sourceRefs?: string[]; evidenceRefs: string[] } = {
    evidenceRefs: canonicalStrings(relation.evidenceRefs)
  };
  if (relation.sourceRefs !== undefined) {
    output.sourceRefs = canonicalStrings(relation.sourceRefs);
  }
  return output;
}

export function restorePhase46dNativeRelations(graph: NormalizedOrthographyGraph): {
  identityRelations: JsonRecord[];
  surfaceRelations: JsonRecord[];
  readingRelations: JsonRecord[];
  ambiguousSurfaceCandidates: JsonRecord[];
  ambiguousReadingCandidates: JsonRecord[];
} {
  const identityRelations: JsonRecord[] = [];
  const surfaceRelations: JsonRecord[] = [];
  const readingRelations: JsonRecord[] = [];
  const ambiguousSurfaceCandidates: JsonRecord[] = [];
  const ambiguousReadingCandidates: JsonRecord[] = [];

  for (const relation of canonicalizeNormalizedGraph(graph).relations) {
    const surface = exactSource(relation);

    if (
      relation.channel === 'surface' &&
      relation.relationKind === 'mapping' &&
      relation.lexicalIdentity
    ) {
      const row: JsonRecord = {
        lexicalIdentity: relation.lexicalIdentity,
        surface,
        historicalSurface: exactTarget(relation)
      };
      if (relation.requiredMorphology !== undefined) {
        row.requiredMorphology = structuredClone(relation.requiredMorphology);
      }
      Object.assign(row, refs(relation));
      identityRelations.push(row);
      continue;
    }

    if (relation.channel === 'surface' && relation.relationKind === 'mapping') {
      surfaceRelations.push({
        surface,
        historicalSurface: exactTarget(relation),
        ...refs(relation)
      });
      continue;
    }

    if (relation.channel === 'reading' && relation.relationKind === 'mapping') {
      readingRelations.push({
        surface,
        historicalReading: exactTarget(relation),
        ...refs(relation)
      });
      continue;
    }

    if (relation.channel === 'surface' && relation.relationKind === 'candidates') {
      ambiguousSurfaceCandidates.push({
        surface,
        alternatives: canonicalStrings(relation.toForms),
        ...refs(relation)
      });
      continue;
    }

    if (relation.channel === 'reading' && relation.relationKind === 'candidates') {
      ambiguousReadingCandidates.push({
        surface,
        alternatives: canonicalStrings(relation.toForms),
        ...refs(relation)
      });
      continue;
    }

    throw new TypeError(
      `Relation is outside Phase 4.6D restoration projection: ${relation.id}`
    );
  }

  const byLexical = (a: JsonRecord, b: JsonRecord) =>
    compareText(`${a.lexicalIdentity ?? ''}`, `${b.lexicalIdentity ?? ''}`) ||
    compareText(`${a.surface ?? ''}`, `${b.surface ?? ''}`);
  const bySurface = (a: JsonRecord, b: JsonRecord) =>
    compareText(`${a.surface ?? ''}`, `${b.surface ?? ''}`);

  identityRelations.sort(byLexical);
  surfaceRelations.sort(bySurface);
  readingRelations.sort(bySurface);
  ambiguousSurfaceCandidates.sort(bySurface);
  ambiguousReadingCandidates.sort(bySurface);

  return {
    identityRelations,
    surfaceRelations,
    readingRelations,
    ambiguousSurfaceCandidates,
    ambiguousReadingCandidates
  };
}
