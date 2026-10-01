import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { jmdictSourceLocalRef, loadJmdictIntake, type JmdictEntry } from './jmdict-intake.ts';
import { lexemeKeys } from './jmdict-lexical-graph.ts';

// Phase 4.8D lexical/morphological span-analysis bridge (#136).
//
// Input text -> span lattice. Every substring that is a pinned-JMdict surface form becomes a
// lexical span carrying typed lexeme candidates (LexemeId / ReadingPathId / CategoryId with the
// source-local ref as provenance). Overlapping spans are all kept: choosing between them is 4.8E's
// job. Positions no lexical span covers become unknown spans, so unanalysable text never aborts.
// UniDic (accepted first-slice evidence) contributes morphology evidence by surface; its ids are
// recorded only as source refs. Composition is offered only when the whole reading aligns with the
// concatenated component readings (弁護士 べんごし = 弁護 べんご + 士 し).

export interface UnidicRecord { surface: string; pos: string[]; lemma: string; goshu: string; kana: string; sourceLemmaId: number; cType?: string; cForm?: string }
export interface AnalyzerSources { createdDate: string; entries: JmdictEntry[]; unidic: UnidicRecord[]; unidicVersion: string }

export interface ComponentPart { surface: string; reading: string; lexemes: string[] }
export interface LexemeCandidate {
  lexeme: string;
  readings: string[];
  categories: string[];
  sourceRefs: string[];
  compositions: ComponentPart[][];
}
// Field names follow the accepted lexical-runtime morphology vocabulary (partOfSpeech/conjugationType/conjugationForm).
export interface Morphology { sourceRef: string; partOfSpeech: string[]; conjugationType: string | null; conjugationForm: string | null; lemma: string; goshu: string; kana: string }
export interface Span {
  start: number;
  end: number;
  surface: string;
  kind: 'lexical' | 'unknown';
  candidates: LexemeCandidate[];
  morphology: Morphology[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function createLexicalSpanAnalyzer(sources: AnalyzerSources) {
  const keys = lexemeKeys(sources.entries);
  type Raw = { lexeme: string; readings: Set<string>; categories: Set<string>; sourceRefs: Set<string> };
  const index = new Map<string, Map<string, Raw>>();
  let maxLength = 1;
  const add = (surface: string, entry: JmdictEntry, readings: string[]) => {
    if (readings.length === 0) return;
    const lexeme = `lexeme:${keys.get(entry.seq)!}`;
    const bySurface = index.get(surface) ?? new Map<string, Raw>();
    const raw = bySurface.get(lexeme) ?? { lexeme, readings: new Set(), categories: new Set(), sourceRefs: new Set() };
    for (const r of readings) raw.readings.add(r);
    for (const sense of entry.s) for (const kind of ['pos', 'misc', 'field', 'dial'] as const) for (const tag of sense[kind] ?? []) raw.categories.add(`category:jmdict-${kind}:${tag}`);
    raw.sourceRefs.add(jmdictSourceLocalRef(sources.createdDate, entry.seq));
    bySurface.set(lexeme, raw);
    index.set(surface, bySurface);
    // the scan window is derived from the indexed surfaces, so no selected surface can be truncated
    maxLength = Math.max(maxLength, Array.from(surface).length);
  };
  for (const entry of sources.entries) {
    for (const k of entry.k ?? []) add(k.t, entry, entry.r.filter((r) => !r.nokanji && (!r.restr || r.restr.includes(k.t))).map((r) => r.t));
    const kanaSurface = !entry.k?.length || entry.s.some((s) => s.misc?.includes('uk'));
    if (kanaSurface) for (const r of entry.r) add(r.t, entry, [r.t]);
  }
  const morphologyBySurface = new Map<string, Morphology[]>();
  for (const record of sources.unidic) {
    const star = (value: string | undefined) => (value === undefined || value === '*' ? null : value);
    const m: Morphology = {
      sourceRef: `unidic-cwj:${sources.unidicVersion}:lemma:${record.sourceLemmaId}`, partOfSpeech: record.pos,
      conjugationType: star(record.cType), conjugationForm: star(record.cForm), lemma: record.lemma, goshu: record.goshu, kana: record.kana
    };
    const list = morphologyBySurface.get(record.surface) ?? [];
    if (!list.some((x) => JSON.stringify(x) === JSON.stringify(m))) list.push(m);
    morphologyBySurface.set(record.surface, list);
  }
  for (const list of morphologyBySurface.values()) list.sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));

  const readingsOf = (surface: string) => {
    const out = new Map<string, Set<string>>();
    for (const raw of index.get(surface)?.values() ?? []) for (const r of raw.readings) {
      const set = out.get(r) ?? new Set<string>();
      set.add(raw.lexeme);
      out.set(r, set);
    }
    return out;
  };
  const compositions = (surface: string, reading: string): ComponentPart[][] => {
    const chars = Array.from(surface);
    const out: ComponentPart[][] = [];
    for (let k = 1; k < chars.length; k += 1) {
      const left = chars.slice(0, k).join('');
      const right = chars.slice(k).join('');
      if (!index.has(left) || !index.has(right)) continue;
      const rightReadings = readingsOf(right);
      for (const [rl, leftLexemes] of readingsOf(left)) {
        if (!reading.startsWith(rl) || rl === reading) continue;
        const rr = reading.slice(rl.length);
        const rightLexemes = rightReadings.get(rr);
        if (!rightLexemes) continue;
        out.push([
          { surface: left, reading: rl, lexemes: [...leftLexemes].sort(cmp) },
          { surface: right, reading: rr, lexemes: [...rightLexemes].sort(cmp) }
        ]);
      }
    }
    return out.sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
  };
  const candidatesFor = (surface: string): LexemeCandidate[] => [...(index.get(surface)?.values() ?? [])]
    .map((raw) => {
      const readings = [...raw.readings].sort(cmp);
      return {
        lexeme: raw.lexeme,
        readings: readings.map((r) => `reading-path:${r}`),
        categories: [...raw.categories].sort(cmp),
        sourceRefs: [...raw.sourceRefs].sort(cmp),
        compositions: readings.flatMap((r) => compositions(surface, r))
      };
    })
    .sort((a, b) => cmp(a.lexeme, b.lexeme));

  const analyze = (text: string) => {
    const chars = Array.from(text.normalize('NFC'));
    const spans: Span[] = [];
    const covered = new Array<boolean>(chars.length).fill(false);
    const startsAt = new Map<number, Span[]>();
    for (let i = 0; i < chars.length; i += 1) {
      for (let len = 1; len <= maxLength && i + len <= chars.length; len += 1) {
        const surface = chars.slice(i, i + len).join('');
        if (!index.has(surface)) continue;
        const span: Span = { start: i, end: i + len, surface, kind: 'lexical', candidates: candidatesFor(surface), morphology: morphologyBySurface.get(surface) ?? [] };
        spans.push(span);
        for (let j = i; j < i + len; j += 1) covered[j] = true;
        const list = startsAt.get(i) ?? [];
        list.push(span);
        startsAt.set(i, list);
      }
    }
    for (let i = 0; i < chars.length;) {
      if (covered[i]) { i += 1; continue; }
      let j = i;
      while (j < chars.length && !covered[j]) j += 1;
      spans.push({ start: i, end: j, surface: chars.slice(i, j).join(''), kind: 'unknown', candidates: [], morphology: [] });
      i = j;
    }
    spans.sort((a, b) => a.start - b.start || a.end - b.end || cmp(a.kind, b.kind));

    // Complete segmentations through the lattice; any position may be crossed as an unknown
    // character (adjacent unknown characters are merged).
    const paths = (limit: number) => {
      const out: Pick<Span, 'start' | 'end' | 'surface' | 'kind'>[][] = [];
      const walk = (i: number, path: Pick<Span, 'start' | 'end' | 'surface' | 'kind'>[]) => {
        if (out.length >= limit) return;
        if (i === chars.length) { out.push(path); return; }
        const lexical = startsAt.get(i) ?? [];
        for (const span of [...lexical].sort((a, b) => b.end - a.end)) walk(span.end, [...path, { start: span.start, end: span.end, surface: span.surface, kind: 'lexical' }]);
        // an unknown character edge is available at every offset (never suppressed by a lexical start)
        {
          const last = path.at(-1);
          const step = last?.kind === 'unknown'
            ? [...path.slice(0, -1), { ...last, end: i + 1, surface: last.surface + chars[i]! }]
            : [...path, { start: i, end: i + 1, surface: chars[i]!, kind: 'unknown' as const }];
          walk(i + 1, step);
        }
      };
      walk(0, []);
      return out;
    };
    return { text: chars.join(''), spans, paths };
  };

  return { analyze, sources };
}

export async function loadLexicalSpanAnalyzer(rootDir: string) {
  const { extract, accounting } = await loadJmdictIntake(rootDir);
  const unidic = JSON.parse(await readFile(resolve(rootDir, 'data/lexical/sources/unidic-cwj-202512-first-slice.json'), 'utf8'));
  return createLexicalSpanAnalyzer({ createdDate: accounting.createdDate, entries: extract, unidic: unidic.records, unidicVersion: unidic.source.version });
}

// Phase 4.8E (reconciled in #154): lexical occurrence evidence as the DAG of all optimal analyses.
// Edges: every lexical span plus an unknown-character edge at every offset. Cost = (unknown chars,
// segments), minimised globally. Only edges on some optimal complete path are kept, so the DAG's
// paths are exactly the optimal analyses -- no enumeration cap. Each lexical span is expanded into
// its distinct (lexeme candidate, reading, composition) alternatives, so a component boundary that
// only one viable candidate supports is never presented as universal evidence.
export function lexicalOccurrenceContext(analysis: ReturnType<ReturnType<typeof createLexicalSpanAnalyzer>['analyze']>) {
  const length = Array.from(analysis.text).length;
  type Cost = [number, number];
  const add = (a: Cost, b: Cost): Cost => [a[0] + b[0], a[1] + b[1]];
  const cmpCost = (a: Cost, b: Cost) => a[0] - b[0] || a[1] - b[1];
  const raw: { start: number; end: number; cost: Cost; span?: Span }[] = [];
  for (const span of analysis.spans) if (span.kind === 'lexical') raw.push({ start: span.start, end: span.end, cost: [0, 1], span });
  for (let i = 0; i < length; i += 1) raw.push({ start: i, end: i + 1, cost: [1, 1] });
  const forward: (Cost | null)[] = new Array(length + 1).fill(null);
  const backward: (Cost | null)[] = new Array(length + 1).fill(null);
  forward[0] = [0, 0];
  backward[length] = [0, 0];
  const byStart = [...raw].sort((a, b) => a.start - b.start);
  for (const edge of byStart) {
    if (!forward[edge.start]) continue;
    const next = add(forward[edge.start]!, edge.cost);
    if (!forward[edge.end] || cmpCost(next, forward[edge.end]!) < 0) forward[edge.end] = next;
  }
  for (const edge of [...raw].sort((a, b) => b.end - a.end)) {
    if (!backward[edge.end]) continue;
    const next = add(backward[edge.end]!, edge.cost);
    if (!backward[edge.start] || cmpCost(next, backward[edge.start]!) < 0) backward[edge.start] = next;
  }
  const best = forward[length]!;
  const optimal = raw.filter((e) => forward[e.start] && backward[e.end] && cmpCost(add(add(forward[e.start]!, e.cost), backward[e.end]!), best) === 0);

  const edges: { start: number; end: number; internal: number[]; units: { start: number; end: number; lexemes: string[]; morphology: Morphology[] | null }[] }[] = [];
  const seen = new Set<string>();
  const push = (edge: (typeof edges)[number]) => {
    const key = JSON.stringify(edge);
    if (!seen.has(key)) { seen.add(key); edges.push(edge); }
  };
  for (const e of optimal) {
    if (!e.span) { push({ start: e.start, end: e.end, internal: [], units: [] }); continue; }
    const span = e.span;
    const morphology = span.morphology.length ? span.morphology : null;
    for (const candidate of span.candidates) {
      for (const readingId of candidate.readings) {
        const reading = readingId.slice('reading-path:'.length);
        const compositions = candidate.compositions.filter((c) => c.map((p) => p.reading).join('') === reading);
        for (const composition of compositions.length ? compositions : [null]) {
          const units = [{ start: span.start, end: span.end, lexemes: [candidate.lexeme], morphology }];
          const internal: number[] = [];
          if (composition) {
            let at = span.start;
            for (const part of composition) {
              const end = at + Array.from(part.surface).length;
              if (at > span.start) internal.push(at);
              units.push({ start: at, end, lexemes: part.lexemes, morphology: null });
              at = end;
            }
          }
          push({ start: span.start, end: span.end, internal, units });
        }
      }
    }
  }
  edges.sort((a, b) => a.start - b.start || a.end - b.end || (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
  return { dag: { length, edges } };
}
