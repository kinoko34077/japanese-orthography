import { buildEntityGraph, type EntityGraph, type RawEntityGraph } from './lexical-entity-graph.ts';
import { deriveSinoVariants } from './sino-rule-normalization.ts';

// Phase 4.8C: project the accepted Phase-4.6E 字音 component authority into the shared
// ReadingAtom / ReadingPath / ReadingConvergencePattern DAG and reproduce the accepted
// direct-component and word-reconstruction behaviour from that projection alone.
//
// - Each distinct table pair (historical -> modern) is ONE shared primary pattern.
// - In-word surface variants that 4.6E derives mechanically (coda gemination, ふ-final
//   gemination, rendaku voicing, semi-voicing) are shared patterns too. A primary pattern lists
//   its variants in `derivations`; a variant that is not itself a table pair records `base` and
//   `mechanism` (e.g. `ぱふ>ぽう` = semi-voicing of `はふ>ほう`: the `ぶんはふ -> ぶんぽう` class).
// - Bindings carry table authority only: (character, table modern reading, context) -> primary
//   patterns + evidence. Variants are reached through `derivations`, never bound directly, so a
//   variant can never masquerade as a direct table reading.

const SINO_SYLLABLE = /^[ぁ-ゔ](?:[ゃゅょゎ])?(?:[いうくきちつんっ])?$/u;
const HAN = /^\p{Script=Han}$/u;
const MAX_RESULTS = 64;

// In-word variants are derived from the first-class v2 mechanism rules (#168).
export function sinoVariants(modern: string, historical: string) {
  return deriveSinoVariants(modern, historical);
}

export interface SinoComponentRelation { character: string; modernReading: string; context: string | null; historicalReadings: string[]; evidenceRefs: string[] }

const patternKey = (historical: string, modern: string) => `${historical}>${modern}`;
const contextKey = (context: string) => `usage:${context}`;

export function projectSinoDag(relations: readonly SinoComponentRelation[], sourceId: string): EntityGraph {
  const patterns = new Map<string, RawEntityGraph['patterns'][number]>();
  for (const r of relations) for (const h of r.historicalReadings) {
    const key = patternKey(h, r.modernReading);
    patterns.set(key, { key, from: [h], to: [r.modernReading] });
  }
  const derivations = new Map<string, Set<string>>();
  for (const r of relations) for (const h of r.historicalReadings) {
    const baseKey = patternKey(h, r.modernReading);
    for (const v of sinoVariants(r.modernReading, h)) {
      if (!v.mechanism) continue;
      const key = patternKey(v.historical, v.modern);
      if (key === baseKey) continue;
      if (!patterns.has(key)) patterns.set(key, { key, from: [v.historical], to: [v.modern], base: baseKey, mechanism: v.mechanism });
      const set = derivations.get(baseKey) ?? new Set<string>();
      set.add(key);
      derivations.set(baseKey, set);
    }
  }
  for (const [baseKey, set] of derivations) patterns.get(baseKey)!.derivations = [...set];

  const bindings = new Map<string, RawEntityGraph['bindings'][number]>();
  const evidence = new Set<string>();
  const contexts = new Set<string>();
  for (const r of relations) {
    const context = r.context ? contextKey(r.context) : null;
    if (context) contexts.add(context);
    const key = JSON.stringify([r.character, r.modernReading, context]);
    const binding = bindings.get(key) ?? { symbol: r.character, modern: [r.modernReading], context, patterns: [], evidence: [] };
    for (const h of r.historicalReadings) if (!binding.patterns.includes(patternKey(h, r.modernReading))) binding.patterns.push(patternKey(h, r.modernReading));
    for (const ref of r.evidenceRefs) { evidence.add(ref); if (!binding.evidence.includes(ref)) binding.evidence.push(ref); }
    bindings.set(key, binding);
  }
  return buildEntityGraph({
    sources: [{ key: sourceId, sourceClass: 'committed-reference' }],
    evidence: [...evidence].map((key) => ({ key, source: sourceId })),
    contexts: [...contexts],
    patterns: [...patterns.values()],
    bindings: [...bindings.values()],
    lexemes: [], morphemes: [], relations: []
  });
}

export interface SinoQuery { context?: string | null }
type DirectResult = { status: 'resolved'; historicalReading: string; evidenceRefs: string[] } | { status: 'candidates'; historicalReadings: string[] } | null;
interface Component { surface: string; modernReading: string; historicalReading: string; context: string | null; evidenceRefs: string[] }
type WordResult = { status: 'resolved'; historicalReading: string; components: Component[]; evidenceRefs: string[]; selectionContext?: string | null } | { status: 'candidates'; historicalReadings: string[] } | null;

interface Match { modern: string; historical: string; context: string | null; evidence: string[] }

export function createSinoDagRuntime(graph: EntityGraph) {
  const strip = (id: string) => id.slice(id.indexOf(':') + 1);
  const patterns = new Map(graph.convergencePatterns.map((p) => [p.id, p]));
  const atom = (pathId: string) => strip(pathId);
  // reverse index: character -> every (modern surface form -> historical) reachable from its bindings
  const matchesByCharacter = new Map<string, Match[]>();
  const tableForms = new Set<string>();
  for (const b of graph.bindings) {
    const list = matchesByCharacter.get(strip(b.symbol)) ?? [];
    const context = b.context === null ? null : strip(strip(b.context));
    const evidence = b.evidence.map(strip);
    for (const id of b.patterns) {
      const base = patterns.get(id)!;
      for (const p of [base, ...(base.derivations ?? []).map((d) => patterns.get(d)!)]) {
        list.push({ modern: atom(p.to), historical: atom(p.from), context, evidence });
        tableForms.add(atom(p.to));
      }
    }
    matchesByCharacter.set(strip(b.symbol), list);
  }
  const uniqueSorted = (values: string[]) => [...new Set(values)].sort();

  const resolveDirect = (character: string, modernReading: string, query: SinoQuery = {}): DirectResult => {
    const hasContext = query.context !== undefined;
    const chosen = graph.bindings.filter((b) => strip(b.symbol) === character && atom(b.modern) === modernReading
      && (!hasContext || (b.context === null ? null : strip(strip(b.context))) === query.context));
    const readings = uniqueSorted(chosen.flatMap((b) => b.patterns.map((id) => atom(patterns.get(id)!.from))));
    if (readings.length === 0) return null;
    if (readings.length > 1) return { status: 'candidates', historicalReadings: readings };
    return { status: 'resolved', historicalReading: readings[0]!, evidenceRefs: uniqueSorted(chosen.flatMap((b) => b.evidence.map(strip))) };
  };

  const segmentOptions = (character: string, segment: string, query: SinoQuery): { historical: string; context: string | null; evidence: string[] }[] => {
    if (!SINO_SYLLABLE.test(segment)) return [];
    const all = (matchesByCharacter.get(character) ?? []).filter((m) => m.modern === segment);
    let matches = all;
    if (query.context !== undefined && all.length > 0) {
      const exact = all.filter((m) => m.context === query.context);
      if (exact.length > 0) matches = exact;
      else if (all.some((m) => m.context !== null)) return [];
      else matches = all.filter((m) => m.context === null);
    }
    if (matches.length > 0) return matches;
    if (tableForms.has(segment) || segment.endsWith('っ')) return [];
    return [{ historical: segment, context: null, evidence: [] }];
  };

  const reconstructWord = (surface: string, modernReading: string, query: SinoQuery = {}): WordResult => {
    const characters = Array.from(surface.normalize('NFC'));
    if (characters.length === 0 || modernReading === '' || !characters.every((c) => HAN.test(c))) return null;
    const results = new Map<string, Component[]>();
    let overflow = false;
    const walk = (i: number, offset: number, parts: string, components: Component[]) => {
      if (overflow) return;
      if (i === characters.length) {
        if (offset !== modernReading.length) return;
        if (!results.has(parts)) results.set(parts, components);
        if (results.size > MAX_RESULTS) overflow = true;
        return;
      }
      for (let end = offset + 1; end <= Math.min(modernReading.length, offset + 4); end += 1) {
        const segment = modernReading.slice(offset, end);
        for (const option of segmentOptions(characters[i]!, segment, query)) {
          walk(i + 1, end, parts + option.historical, [...components, {
            surface: characters[i]!, modernReading: segment, historicalReading: option.historical, context: option.context, evidenceRefs: option.evidence
          }]);
        }
      }
    };
    walk(0, 0, '', []);
    if (overflow || results.size === 0) return null;
    // Keep the derived DAG aligned with the accepted runtime: consecutive reading material
    // without table evidence is one opaque block, not per-character ownership (#234).
    const coalesceOpaque = (components: Component[]) => {
      const merged: Component[] = [];
      for (const component of components) {
        const opaque = component.evidenceRefs.length === 0;
        const previous = merged[merged.length - 1];
        if (opaque && previous && previous.evidenceRefs.length === 0) {
          previous.surface += component.surface;
          previous.modernReading += component.modernReading;
          previous.historicalReading += component.historicalReading;
        } else {
          merged.push({ ...component, evidenceRefs: [...component.evidenceRefs] });
        }
      }
      return merged;
    };
    const evidencedResults = [...results.entries()].map(([historical, components]) => [historical, coalesceOpaque(components)] as const);
    const readings = evidencedResults.map(([historical]) => historical).sort();
    if (readings.length > 1) return { status: 'candidates', historicalReadings: readings };
    const components = evidencedResults.find(([historical]) => historical === readings[0])![1];
    return {
      status: 'resolved', historicalReading: readings[0]!, components,
      evidenceRefs: uniqueSorted(components.flatMap((c) => c.evidenceRefs)),
      ...(query.context !== undefined ? { selectionContext: query.context } : {})
    };
  };

  return { resolveDirect, reconstructWord };
}
