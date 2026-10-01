import type { Id, EntityGraph } from './lexical-entity-graph.ts';
import { createEntityGraphRuntime, makeId } from './lexical-entity-graph.ts';
import type { LexicalArtifact } from './lexical-compiler.ts';

export interface SpanMorphology {
  partOfSpeech: string[];
  conjugationType: string | null;
  conjugationForm: string | null;
}

export interface LexicalSpanCandidate {
  lexicalIdentity: string;
  lemma: string;
  reading: string | null;
  lexicalReading: string;
  modernReadings: string[];
  morphology: SpanMorphology;
  entityLexemes: Id<'lexeme'>[];
}

export interface LexicalSpan {
  id: string;
  start: number;
  end: number;
  text: string;
  kind: 'lexical' | 'unknown';
  candidates: LexicalSpanCandidate[];
  componentPaths: string[][];
}

export interface LexicalSpanPath {
  spanIds: string[];
  unknownCount: number;
  lexicalChars: number;
}

export interface LexicalSpanGraph {
  schemaVersion: '1';
  kind: 'japanese-orthography-lexical-span-graph';
  input: string;
  spans: LexicalSpan[];
  paths: LexicalSpanPath[];
}

export interface SpanGraphOptions {
  maxSurfaceLength?: number;
  maxPaths?: number;
  maxComponentPaths?: number;
}

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function decodeCandidate(
  artifact: LexicalArtifact,
  candidateIndex: number,
  entityGraph: EntityGraph,
  surface: string
): LexicalSpanCandidate {
  const record = artifact.candidates[candidateIndex];
  if (!record) throw new Error(`candidate index ${candidateIndex} out of range`);
  const lemma = artifact.lemmas[record.lemmaIndex];
  const morphology = artifact.morphologies[record.morphologyId];
  if (!lemma || !morphology) throw new Error(`candidate ${candidateIndex} has dangling references`);
  const modernReadings = [...record.modernReadings].sort(cmp);
  const reading = modernReadings.length === 1
    ? modernReadings[0]!
    : modernReadings.includes(lemma.lexicalReading)
      ? lemma.lexicalReading
      : null;
  const runtime = createEntityGraphRuntime(entityGraph);
  let entityLexemes = runtime.lexemesByForm(makeId('form', surface)) as Id<'lexeme'>[];
  if (reading !== null) {
    const byReading = new Set(runtime.lexemesByReading(makeId('reading-path', reading)));
    const restricted = entityLexemes.filter((id) => byReading.has(id));
    if (restricted.length > 0) entityLexemes = restricted;
  }
  return {
    lexicalIdentity: lemma.lexicalIdentity,
    lemma: lemma.lemma,
    reading,
    lexicalReading: lemma.lexicalReading,
    modernReadings,
    morphology: {
      partOfSpeech: [...morphology.pos],
      conjugationType: morphology.cType === '*' ? null : morphology.cType,
      conjugationForm: morphology.cForm === '*' ? null : morphology.cForm
    },
    entityLexemes: [...new Set(entityLexemes)].sort(cmp) as Id<'lexeme'>[]
  };
}

function surfaceCandidates(artifact: LexicalArtifact): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const entry of artifact.surfaceIndex) {
    const indexes: number[] = [];
    for (let i = 0; i < entry.candidateCount; i += 1) indexes.push(entry.candidateOffset + i);
    out.set(entry.surface, indexes);
  }
  return out;
}

function enumeratePaths(
  spans: LexicalSpan[],
  length: number,
  maxPaths: number,
  within?: { start: number; end: number; exclude?: string; lexicalOnly?: boolean }
): LexicalSpanPath[] {
  const start = within?.start ?? 0;
  const end = within?.end ?? length;
  const byStart = new Map<number, LexicalSpan[]>();
  for (const span of spans) {
    if (span.id === within?.exclude || span.start < start || span.end > end) continue;
    if (within?.lexicalOnly && span.kind !== 'lexical') continue;
    const list = byStart.get(span.start) ?? [];
    list.push(span);
    byStart.set(span.start, list);
  }
  for (const list of byStart.values()) {
    list.sort((a, b) =>
      Number(a.kind === 'unknown') - Number(b.kind === 'unknown') ||
      (b.end - b.start) - (a.end - a.start) ||
      cmp(a.id, b.id)
    );
  }

  const paths: LexicalSpanPath[] = [];
  const walk = (offset: number, ids: string[], unknownCount: number, lexicalChars: number) => {
    if (paths.length >= maxPaths) return;
    if (offset === end) {
      paths.push({ spanIds: [...ids], unknownCount, lexicalChars });
      return;
    }
    for (const span of byStart.get(offset) ?? []) {
      if (span.end <= offset) continue;
      walk(
        span.end,
        [...ids, span.id],
        unknownCount + Number(span.kind === 'unknown'),
        lexicalChars + (span.kind === 'lexical' ? span.end - span.start : 0)
      );
      if (paths.length >= maxPaths) return;
    }
  };
  walk(start, [], 0, 0);
  return paths.sort((a, b) =>
    a.unknownCount - b.unknownCount ||
    b.lexicalChars - a.lexicalChars ||
    a.spanIds.length - b.spanIds.length ||
    cmp(a.spanIds.join('|'), b.spanIds.join('|'))
  );
}

export function buildLexicalSpanGraph(
  input: string,
  lexicalArtifact: LexicalArtifact,
  entityGraph: EntityGraph,
  options: SpanGraphOptions = {}
): LexicalSpanGraph {
  const chars = Array.from(input.normalize('NFC'));
  const maxSurfaceLength = Math.max(1, options.maxSurfaceLength ?? 16);
  const maxPaths = Math.max(1, options.maxPaths ?? 64);
  const maxComponentPaths = Math.max(1, options.maxComponentPaths ?? 16);
  const index = surfaceCandidates(lexicalArtifact);
  const entityRuntime = createEntityGraphRuntime(entityGraph);
  const spans: LexicalSpan[] = [];

  const decode = (candidateIndex: number, surface: string): LexicalSpanCandidate => {
    const record = lexicalArtifact.candidates[candidateIndex];
    if (!record) throw new Error(`candidate index ${candidateIndex} out of range`);
    const lemma = lexicalArtifact.lemmas[record.lemmaIndex];
    const morphology = lexicalArtifact.morphologies[record.morphologyId];
    if (!lemma || !morphology) throw new Error(`candidate ${candidateIndex} has dangling references`);
    const modernReadings = [...record.modernReadings].sort(cmp);
    const reading = modernReadings.length === 1
      ? modernReadings[0]!
      : modernReadings.includes(lemma.lexicalReading) ? lemma.lexicalReading : null;
    let entityLexemes = entityRuntime.lexemesByForm(makeId('form', surface)) as Id<'lexeme'>[];
    if (reading !== null) {
      const byReading = new Set(entityRuntime.lexemesByReading(makeId('reading-path', reading)));
      const restricted = entityLexemes.filter((id) => byReading.has(id));
      if (restricted.length > 0) entityLexemes = restricted;
    }
    return {
      lexicalIdentity: lemma.lexicalIdentity,
      lemma: lemma.lemma,
      reading,
      lexicalReading: lemma.lexicalReading,
      modernReadings,
      morphology: {
        partOfSpeech: [...morphology.pos],
        conjugationType: morphology.cType === '*' ? null : morphology.cType,
        conjugationForm: morphology.cForm === '*' ? null : morphology.cForm
      },
      entityLexemes: [...new Set(entityLexemes)].sort(cmp) as Id<'lexeme'>[]
    };
  };

  for (let start = 0; start < chars.length; start += 1) {
    for (let end = start + 1; end <= Math.min(chars.length, start + maxSurfaceLength); end += 1) {
      const text = chars.slice(start, end).join('');
      const candidateIndexes = index.get(text);
      if (!candidateIndexes?.length) continue;
      const candidates = candidateIndexes.map((candidateIndex) => decode(candidateIndex, text))
        .sort((a, b) => cmp(a.lexicalIdentity, b.lexicalIdentity));
      spans.push({
        id: `span:${start}:${end}:lexical`,
        start, end, text, kind: 'lexical', candidates, componentPaths: []
      });
    }
    spans.push({
      id: `span:${start}:${start + 1}:unknown`,
      start, end: start + 1, text: chars[start]!, kind: 'unknown', candidates: [], componentPaths: []
    });
  }

  spans.sort((a, b) => a.start - b.start || b.end - a.end || cmp(a.id, b.id));
  for (const span of spans) {
    if (span.kind !== 'lexical' || span.end - span.start < 2) continue;
    const components = enumeratePaths(
      spans,
      chars.length,
      maxComponentPaths,
      { start: span.start, end: span.end, exclude: span.id, lexicalOnly: true }
    ).filter((path) => path.spanIds.length > 1);
    span.componentPaths = components.map((path) => path.spanIds);
  }

  return {
    schemaVersion: '1',
    kind: 'japanese-orthography-lexical-span-graph',
    input: chars.join(''),
    spans,
    paths: enumeratePaths(spans, chars.length, maxPaths)
  };
}

export function primarySpanPath(graph: LexicalSpanGraph): LexicalSpanPath | null {
  return graph.paths[0] ?? null;
}

export function spansForPath(graph: LexicalSpanGraph, path: LexicalSpanPath): LexicalSpan[] {
  const byId = new Map(graph.spans.map((span) => [span.id, span]));
  return path.spanIds.map((id) => {
    const span = byId.get(id);
    if (!span) throw new Error(`unknown span ${id}`);
    return span;
  });
}
