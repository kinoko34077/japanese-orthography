import type { EntityGraph, Id } from './lexical-entity-graph.ts';
import { createEntityGraphRuntime, makeId } from './lexical-entity-graph.ts';
import type { NormalizedOrthographyRelation, ResultBasis } from './normalized-relation-model.ts';
import type { LexicalSpanGraph } from './lexical-span-analysis.ts';
import type { OccurrenceResolverOptions, OccurrenceResolution } from './occurrence-orthography.ts';
import { resolveOccurrenceOrthography } from './occurrence-orthography.ts';
import { createSinoDagRuntime } from './sino-dag-projection.ts';

export interface HistoricalJoinOptions {
  context?: string | null;
  occurrence?: OccurrenceResolverOptions;
}

export interface HistoricalReadingDecision {
  status: 'resolved' | 'candidates' | 'unresolved';
  modernReading: string;
  historicalReadings: string[];
  selectedHistoricalReading: string | null;
  basis: ResultBasis;
  evidenceRefs: string[];
  selectionContext?: string | null;
}

export interface LexicalHistoricalResolution {
  surface: string;
  modernReading: string;
  lexemeIds: Id<'lexeme'>[];
  surfaceDecision: OccurrenceResolution;
  readingDecision: HistoricalReadingDecision;
}

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function lexemesForFormReading(
  graph: EntityGraph,
  surface: string,
  reading: string
): Id<'lexeme'>[] {
  const runtime = createEntityGraphRuntime(graph);
  const formId = makeId('form', surface);
  const readingId = makeId('reading-path', reading);
  const forms = new Set(runtime.lexemesByForm(formId));
  const readings = new Set(runtime.lexemesByReading(readingId));
  const allowed: Id<'lexeme'>[] = [];
  for (const lexeme of graph.lexemes) {
    if (!forms.has(lexeme.id) || !readings.has(lexeme.id)) continue;
    const restrictions = graph.restrictions.filter((r) => r.lexeme === lexeme.id && r.reading === readingId);
    if (restrictions.length === 0) {
      allowed.push(lexeme.id);
      continue;
    }
    if (restrictions.some((r) => r.forms.includes(formId))) allowed.push(lexeme.id);
  }
  return [...new Set(allowed)].sort(cmp) as Id<'lexeme'>[];
}

export function resolveLexicalHistorical(
  surface: string,
  modernReading: string,
  lexicalGraph: EntityGraph,
  sinoGraph: EntityGraph,
  spanGraph: LexicalSpanGraph,
  relations: NormalizedOrthographyRelation[],
  options: HistoricalJoinOptions = {}
): LexicalHistoricalResolution {
  if (spanGraph.input !== surface.normalize('NFC')) throw new Error('span graph/surface mismatch');
  const lexemeIds = lexemesForFormReading(lexicalGraph, surface, modernReading);
  const surfaceDecision = resolveOccurrenceOrthography(surface, relations, spanGraph, options.occurrence);
  const sino = createSinoDagRuntime(sinoGraph);
  const query = Object.prototype.hasOwnProperty.call(options, 'context')
    ? { context: options.context }
    : {};
  const reconstructed = sino.reconstructWord(surface, modernReading, query);

  let readingDecision: HistoricalReadingDecision;
  if (reconstructed === null) {
    readingDecision = {
      status: 'unresolved',
      modernReading,
      historicalReadings: [],
      selectedHistoricalReading: null,
      basis: 'unresolved',
      evidenceRefs: []
    };
  } else if (reconstructed.status === 'candidates') {
    readingDecision = {
      status: 'candidates',
      modernReading,
      historicalReadings: [...reconstructed.historicalReadings].sort(cmp),
      selectedHistoricalReading: null,
      basis: 'source_candidates',
      evidenceRefs: []
    };
  } else {
    readingDecision = {
      status: 'resolved',
      modernReading,
      historicalReadings: [reconstructed.historicalReading],
      selectedHistoricalReading: reconstructed.historicalReading,
      basis: reconstructed.selectionContext !== undefined ? 'source_contextual' : 'generated_diachronic',
      evidenceRefs: [...new Set(reconstructed.evidenceRefs)].sort(cmp),
      ...(reconstructed.selectionContext !== undefined ? { selectionContext: reconstructed.selectionContext } : {})
    };
  }

  return {
    surface,
    modernReading,
    lexemeIds,
    surfaceDecision,
    readingDecision
  };
}
