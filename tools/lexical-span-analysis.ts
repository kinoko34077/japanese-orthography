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

export interface UnidicRecord { surface: string; pos: string[]; lemma: string; goshu: string; kana: string; sourceLemmaId: number }
export interface AnalyzerSources { createdDate: string; entries: JmdictEntry[]; unidic: UnidicRecord[]; unidicVersion: string }

export interface ComponentPart { surface: string; reading: string; lexemes: string[] }
export interface LexemeCandidate {
  lexeme: string;
  readings: string[];
  categories: string[];
  sourceRefs: string[];
  compositions: ComponentPart[][];
}
export interface Morphology { sourceRef: string; pos: string[]; lemma: string; goshu: string; kana: string }
export interface Span {
  start: number;
  end: number;
  surface: string;
  kind: 'lexical' | 'unknown';
  candidates: LexemeCandidate[];
  morphology: Morphology[];
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const MAX_SURFACE = 24;

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
    maxLength = Math.max(maxLength, Math.min(MAX_SURFACE, Array.from(surface).length));
  };
  for (const entry of sources.entries) {
    for (const k of entry.k ?? []) add(k.t, entry, entry.r.filter((r) => !r.nokanji && (!r.restr || r.restr.includes(k.t))).map((r) => r.t));
    const kanaSurface = !entry.k?.length || entry.s.some((s) => s.misc?.includes('uk'));
    if (kanaSurface) for (const r of entry.r) add(r.t, entry, [r.t]);
  }
  const morphologyBySurface = new Map<string, Morphology[]>();
  for (const record of sources.unidic) {
    const m: Morphology = { sourceRef: `unidic-cwj:${sources.unidicVersion}:lemma:${record.sourceLemmaId}`, pos: record.pos, lemma: record.lemma, goshu: record.goshu, kana: record.kana };
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

    // Complete segmentations through the lattice; a position no lexical span starts at may be
    // crossed as an unknown character (adjacent unknown characters are merged).
    const paths = (limit: number) => {
      const out: Pick<Span, 'start' | 'end' | 'surface' | 'kind'>[][] = [];
      const walk = (i: number, path: Pick<Span, 'start' | 'end' | 'surface' | 'kind'>[]) => {
        if (out.length >= limit) return;
        if (i === chars.length) { out.push(path); return; }
        const lexical = startsAt.get(i) ?? [];
        for (const span of [...lexical].sort((a, b) => b.end - a.end)) walk(span.end, [...path, { start: span.start, end: span.end, surface: span.surface, kind: 'lexical' }]);
        if (lexical.length === 0) {
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

// Phase 4.8E: lexical occurrence context for the occurrence arbitration layer.
// Best paths minimise unknown characters, then segment count; all tied best paths are kept
// (a relation must be admissible on every one of them). Boundaries include the split points of
// reading-aligned compositions, so a compound component (弁護 in 弁護士) is a lexical unit.
export function lexicalOccurrenceContext(analysis: ReturnType<ReturnType<typeof createLexicalSpanAnalyzer>['analyze']>, maxPaths = 16) {
  const length = Array.from(analysis.text).length;
  const lexical = analysis.spans.filter((s) => s.kind === 'lexical');
  const startsAt = new Map<number, Span[]>();
  for (const span of lexical) startsAt.set(span.start, [...(startsAt.get(span.start) ?? []), span]);
  type Cost = [number, number];
  const better = (a: Cost, b: Cost) => a[0] - b[0] || a[1] - b[1];
  const best: (Cost | null)[] = new Array(length + 1).fill(null);
  best[length] = [0, 0];
  for (let i = length - 1; i >= 0; i -= 1) {
    const options: Cost[] = [];
    for (const span of startsAt.get(i) ?? []) if (best[span.end]) options.push([best[span.end]![0], best[span.end]![1] + 1]);
    if (!startsAt.has(i) && best[i + 1]) options.push([best[i + 1]![0] + 1, best[i + 1]![1] + 1]);
    best[i] = options.sort(better)[0] ?? null;
  }
  const paths: { boundaries: number[]; units: [number, number][]; lexemes: Record<string, string[]> }[] = [];
  const walk = (i: number, segments: { span?: Span; start: number; end: number }[]) => {
    if (paths.length >= maxPaths) return;
    if (i === length) {
      const boundaries = new Set<number>();
      const units: [number, number][] = [];
      const lexemes: Record<string, string[]> = {};
      for (const seg of segments) {
        boundaries.add(seg.start); boundaries.add(seg.end);
        if (!seg.span) continue;
        units.push([seg.start, seg.end]);
        lexemes[`${seg.start}:${seg.end}`] = seg.span.candidates.map((c) => c.lexeme);
        for (const candidate of seg.span.candidates) for (const composition of candidate.compositions) {
          let at = seg.start;
          for (const part of composition) {
            const end = at + Array.from(part.surface).length;
            boundaries.add(at); boundaries.add(end);
            units.push([at, end]);
            const key = `${at}:${end}`;
            lexemes[key] = [...new Set([...(lexemes[key] ?? []), ...part.lexemes])].sort();
            at = end;
          }
        }
      }
      const uniqueUnits = [...new Map(units.map((u) => [`${u[0]}:${u[1]}`, u])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      paths.push({ boundaries: [...boundaries].sort((a, b) => a - b), units: uniqueUnits, lexemes });
      return;
    }
    const target = best[i]!;
    for (const span of [...(startsAt.get(i) ?? [])].sort((a, b) => b.end - a.end)) {
      const cost = best[span.end];
      if (cost && cost[0] === target[0] && cost[1] + 1 === target[1]) walk(span.end, [...segments, { span, start: i, end: span.end }]);
    }
    if (!startsAt.has(i)) {
      const cost = best[i + 1];
      if (cost && cost[0] + 1 === target[0] && cost[1] + 1 === target[1]) walk(i + 1, [...segments, { start: i, end: i + 1 }]);
    }
  };
  if (length > 0) walk(0, []);
  return { paths: paths.length ? paths : [{ boundaries: [0, length], units: [], lexemes: {} }] };
}
