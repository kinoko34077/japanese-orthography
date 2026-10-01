import { gzipSync } from 'node:zlib';
import { sha256 } from './jmdict-intake.ts';
import { compactEntityGraph, type EntityGraph } from './lexical-entity-graph.ts';

export const MEASUREMENTS_PATH = 'data/reports/phase48c-lexical-graph-measurements.json';

const size = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return { bytes: Buffer.byteLength(text), gzipBytes: gzipSync(text, { level: 9 }).length };
};

// Hot lexical lookup projection: surface form / reading string -> dense lexeme indexes.
// Provenance, categories, restrictions and symbol decomposition stay in the cold compact graph.
export function hotLexicalProjection(graph: EntityGraph) {
  const lexemeIndex = new Map(graph.lexemes.map((l, i) => [l.id, i]));
  const index = (pick: (l: EntityGraph['lexemes'][number]) => string[], strip: string) => {
    const map = new Map<string, number[]>();
    for (const l of graph.lexemes) for (const id of pick(l)) {
      const key = id.slice(strip.length);
      const list = map.get(key) ?? [];
      list.push(lexemeIndex.get(l.id)!);
      map.set(key, list);
    }
    const keys = [...map.keys()].sort();
    return { keys, lexemes: keys.map((k) => [...new Set(map.get(k)!)].sort((a, b) => a - b)) };
  };
  return { lexemeCount: graph.lexemes.length, form: index((l) => l.forms, 'form:'), reading: index((l) => l.readings, 'reading-path:') };
}

export function buildLexicalGraphMeasurements(input: {
  jmdict?: { graph: EntityGraph; rawExtractText: string; rawExtractGzipBytes: number };
  sino: EntityGraph;
  sinoSource: unknown[];
}) {
  const out: Record<string, unknown> = {};
  if (input.jmdict) {
    const { graph, rawExtractText, rawExtractGzipBytes } = input.jmdict;
    const canonical = JSON.stringify(graph);
    out.jmdict = { rawExtractBytes: Buffer.byteLength(rawExtractText), rawExtractGzipBytes };
    out.canonicalGraph = { sha256: sha256(canonical), ...size(canonical) };
    out.compactGraph = size(compactEntityGraph(graph));
    out.hotProjection = size(hotLexicalProjection(graph));
    out.counts = Object.fromEntries((['lexemes', 'forms', 'symbols', 'readingAtoms', 'readingPaths', 'categories', 'restrictions'] as const).map((k) => [k, graph[k].length]));
  }
  const sino = input.sino;
  out.sinoDag = {
    sourceRelations: input.sinoSource.length,
    sourceBytes: size(input.sinoSource).bytes,
    primaryPatterns: sino.convergencePatterns.filter((p) => !p.base).length,
    derivedPatterns: sino.convergencePatterns.filter((p) => p.base).length,
    bindings: sino.bindings.length,
    readingAtoms: sino.readingAtoms.length,
    canonicalBytes: size(sino).bytes,
    compactBytes: size(compactEntityGraph(sino)).bytes
  };
  return out;
}
