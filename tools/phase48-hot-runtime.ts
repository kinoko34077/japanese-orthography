import type { EntityGraph, Id } from './lexical-entity-graph.ts';

export interface Phase48HotRuntime {
  schemaVersion: '1';
  kind: 'phase48-hot-runtime';
  strings: string[];
  readingAtoms: number[];
  readingPaths: number[][];
  lexemeIds: string[];
  formIndex: Array<[number, number[]]>;
  readingIndex: Array<[number, number[]]>;
  restrictions: Array<[number, number, number[]]>;
  patterns: Array<[number, number, number, number, number[]]>;
  bindings: Array<[number, number, number, number[], number[]]>;
}

export interface Phase48ColdProjection {
  schemaVersion: '1';
  kind: 'phase48-cold-provenance';
  lexicalSources: EntityGraph['sources'];
  sinoSources: EntityGraph['sources'];
  lexicalSourceRefs: Array<[string, string[]]>;
  lexicalCategories: Array<[string, string[]]>;
  sinoEvidence: EntityGraph['evidence'];
}

export interface Phase48RuntimeBundle {
  schemaVersion: '1';
  kind: 'phase48-runtime-bundle';
  hot: Phase48HotRuntime;
  cold: Phase48ColdProjection;
}

export interface HotSinoQuery { context?: string | null }
type HotDirectResult =
  | { status: 'resolved'; historicalReading: string; evidenceRefs: string[] }
  | { status: 'candidates'; historicalReadings: string[] }
  | null;
type HotWordResult =
  | { status: 'resolved'; historicalReading: string; components: Array<{ surface: string; modernReading: string; historicalReading: string; context: string | null; evidenceRefs: string[] }>; evidenceRefs: string[]; selectionContext?: string | null }
  | { status: 'candidates'; historicalReadings: string[] }
  | null;

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const HAN = /^\p{Script=Han}$/u;
const SINO_SYLLABLE = /^[ぁ-ゔ](?:[ゃゅょゎ])?(?:[いうくきちつんっ])?$/u;
const MAX_RESULTS = 64;

const idKey = (id: string) => id.slice(id.indexOf(':') + 1);

export function buildPhase48RuntimeBundle(lexicalGraph: EntityGraph, sinoGraph: EntityGraph): Phase48RuntimeBundle {
  const stringSet = new Set<string>();
  const addString = (value: string | null | undefined) => {
    if (value !== null && value !== undefined) stringSet.add(value);
  };

  for (const form of lexicalGraph.forms) addString(form.text);
  for (const atom of [...lexicalGraph.readingAtoms, ...sinoGraph.readingAtoms]) addString(atom.kana);
  for (const symbol of sinoGraph.symbols) addString(symbol.text);
  for (const context of sinoGraph.contexts) addString(idKey(context.id));
  for (const pattern of sinoGraph.convergencePatterns) addString(pattern.mechanism ?? null);
  for (const evidence of sinoGraph.evidence) addString(idKey(evidence.id));
  const strings = [...stringSet].sort(cmp);
  const stringId = new Map(strings.map((value, index) => [value, index]));

  const atomKana = new Map<string, string>();
  for (const atom of [...lexicalGraph.readingAtoms, ...sinoGraph.readingAtoms]) atomKana.set(atom.id, atom.kana);
  const atomValues = [...new Set(atomKana.values())].sort(cmp);
  for (const value of atomValues) addString(value);
  const atomIndex = new Map(atomValues.map((value, index) => [value, index]));
  const readingAtoms = atomValues.map((value) => stringId.get(value)!);

  const pathById = new Map<string, string[]>();
  for (const path of [...lexicalGraph.readingPaths, ...sinoGraph.readingPaths]) {
    const values = path.atoms.map((atom) => {
      const value = atomKana.get(atom);
      if (value === undefined) throw new Error(`unknown reading atom ${atom}`);
      return value;
    });
    const existing = pathById.get(path.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(values)) throw new Error(`conflicting reading path ${path.id}`);
    pathById.set(path.id, values);
  }
  const pathEntries = [...pathById.entries()].sort(([a], [b]) => cmp(a, b));
  const readingPaths = pathEntries.map(([, values]) => values.map((value) => atomIndex.get(value)!));
  const pathIndex = new Map(pathEntries.map(([id], index) => [id, index]));

  const lexemeIds = lexicalGraph.lexemes.map((lexeme) => lexeme.id).sort(cmp);
  const lexemeIndex = new Map(lexemeIds.map((id, index) => [id, index]));
  const formLexemes = new Map<string, number[]>();
  const readingLexemes = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, key: string, value: number) => {
    const list = map.get(key) ?? [];
    list.push(value);
    map.set(key, list);
  };
  for (const lexeme of lexicalGraph.lexemes) {
    const li = lexemeIndex.get(lexeme.id)!;
    for (const form of lexeme.forms) push(formLexemes, form, li);
    for (const reading of lexeme.readings) push(readingLexemes, reading, li);
  }

  const formText = new Map(lexicalGraph.forms.map((form) => [form.id, form.text]));
  const formIndex: Array<[number, number[]]> = [...formLexemes.entries()]
    .map(([form, ids]) => [stringId.get(formText.get(form as Id<'form'>)!)!, [...new Set(ids)].sort((a,b) => a-b)] as [number, number[]])
    .sort((a,b) => a[0]-b[0]);
  const readingIndex: Array<[number, number[]]> = [...readingLexemes.entries()]
    .map(([reading, ids]) => [pathIndex.get(reading)!, [...new Set(ids)].sort((a,b) => a-b)] as [number, number[]])
    .sort((a,b) => a[0]-b[0]);

  const restrictions: Array<[number, number, number[]]> = lexicalGraph.restrictions
    .map((restriction): [number, number, number[]] => [
      lexemeIndex.get(restriction.lexeme)!,
      pathIndex.get(restriction.reading)!,
      restriction.forms.map((form) => stringId.get(formText.get(form)!)!).sort((a,b) => a-b)
    ])
    .sort((a,b) => a[0]-b[0] || a[1]-b[1] || JSON.stringify(a[2]).localeCompare(JSON.stringify(b[2])));

  const patternIds = sinoGraph.convergencePatterns.map((pattern) => pattern.id).sort(cmp);
  const patternIndex = new Map(patternIds.map((id, index) => [id, index]));
  const patternMap = new Map(sinoGraph.convergencePatterns.map((pattern) => [pattern.id, pattern]));
  const patterns: Phase48HotRuntime['patterns'] = patternIds.map((id) => {
    const pattern = patternMap.get(id)!;
    return [
      pathIndex.get(pattern.from)!,
      pathIndex.get(pattern.to)!,
      pattern.base ? patternIndex.get(pattern.base)! : -1,
      pattern.mechanism ? stringId.get(pattern.mechanism)! : -1,
      (pattern.derivations ?? []).map((derived) => patternIndex.get(derived)!).sort((a,b) => a-b)
    ];
  });

  const symbolText = new Map(sinoGraph.symbols.map((symbol) => [symbol.id, symbol.text]));
  const evidenceText = new Map(sinoGraph.evidence.map((evidence) => [evidence.id, idKey(evidence.id)]));
  const bindings: Phase48HotRuntime['bindings'] = sinoGraph.bindings
    .map((binding): [number, number, number, number[], number[]] => [
      stringId.get(symbolText.get(binding.symbol)!)!,
      pathIndex.get(binding.modern)!,
      binding.context === null ? -1 : stringId.get(idKey(binding.context))!,
      binding.patterns.map((pattern) => patternIndex.get(pattern)!).sort((a,b) => a-b),
      binding.evidence.map((evidence) => stringId.get(evidenceText.get(evidence)!)!).sort((a,b) => a-b)
    ])
    .sort((a,b) => a[0]-b[0] || a[1]-b[1] || a[2]-b[2]);

  const cold: Phase48ColdProjection = {
    schemaVersion: '1',
    kind: 'phase48-cold-provenance',
    lexicalSources: structuredClone(lexicalGraph.sources),
    sinoSources: structuredClone(sinoGraph.sources),
    lexicalSourceRefs: lexicalGraph.lexemes
      .map((lexeme): [string, string[]] => [lexeme.id, [...lexeme.sourceRefs]])
      .sort((a,b) => cmp(a[0],b[0])),
    lexicalCategories: lexicalGraph.lexemes
      .map((lexeme): [string, string[]] => [lexeme.id, [...lexeme.categories].sort(cmp)])
      .filter(([, categories]) => categories.length > 0)
      .sort((a,b) => cmp(a[0],b[0])),
    sinoEvidence: structuredClone(sinoGraph.evidence)
  };

  return {
    schemaVersion: '1',
    kind: 'phase48-runtime-bundle',
    hot: { schemaVersion: '1', kind: 'phase48-hot-runtime', strings, readingAtoms, readingPaths, lexemeIds, formIndex, readingIndex, restrictions, patterns, bindings },
    cold
  };
}

export function createPhase48HotRuntime(hot: Phase48HotRuntime) {
  const strings = hot.strings;
  const pathText = hot.readingPaths.map((path) => path.map((atom) => strings[hot.readingAtoms[atom]!]!).join(''));
  const pathByText = new Map(pathText.map((text, index) => [text, index]));
  const formLexemes = new Map(hot.formIndex.map(([string, lexemes]) => [strings[string]!, lexemes]));
  const readingLexemes = new Map(hot.readingIndex.map(([path, lexemes]) => [path, lexemes]));
  const restrictions = new Map<string, number[]>();
  for (const [lexeme, path, forms] of hot.restrictions) restrictions.set(`${lexeme}:${path}`, forms);

  const lexemesForFormReading = (form: string, reading: string): string[] => {
    const path = pathByText.get(reading);
    if (path === undefined) return [];
    const formString = strings.indexOf(form);
    if (formString < 0) return [];
    const a = new Set(formLexemes.get(form) ?? []);
    const b = new Set(readingLexemes.get(path) ?? []);
    const out: string[] = [];
    for (const lexeme of a) {
      if (!b.has(lexeme)) continue;
      const allowed = restrictions.get(`${lexeme}:${path}`);
      if (allowed !== undefined && !allowed.includes(formString)) continue;
      out.push(hot.lexemeIds[lexeme]!);
    }
    return out.sort(cmp);
  };

  const matchesBySymbol = new Map<string, Array<{ modern: string; historical: string; context: string | null; evidence: string[] }>>();
  const tableForms = new Set<string>();
  for (const [symbolId, modernPath, contextId, patternIds, evidenceIds] of hot.bindings) {
    const symbol = strings[symbolId]!;
    const list = matchesBySymbol.get(symbol) ?? [];
    const context = contextId < 0 ? null : strings[contextId]!;
    const evidence = evidenceIds.map((id) => strings[id]!);
    for (const patternId of patternIds) {
      const base = hot.patterns[patternId]!;
      const ids = [patternId, ...base[4]];
      for (const id of ids) {
        const pattern = hot.patterns[id]!;
        const modern = pathText[pattern[1]]!;
        const historical = pathText[pattern[0]]!;
        list.push({ modern, historical, context, evidence });
        tableForms.add(modern);
      }
    }
    matchesBySymbol.set(symbol, list);
  }

  const uniqueSorted = (values: string[]) => [...new Set(values)].sort(cmp);
  const selectMatches = (symbol: string, modern: string, query: HotSinoQuery) => {
    const all = (matchesBySymbol.get(symbol) ?? []).filter((match) => match.modern === modern);
    if (query.context === undefined || all.length === 0) return all;
    const exact = all.filter((match) => match.context === query.context);
    if (exact.length > 0) return exact;
    if (all.some((match) => match.context !== null)) return [];
    return all.filter((match) => match.context === null);
  };

  const resolveDirect = (symbol: string, modern: string, query: HotSinoQuery = {}): HotDirectResult => {
    const chosen = hot.bindings.filter(([symbolId, modernPath, contextId]) =>
      strings[symbolId] === symbol &&
      pathText[modernPath] === modern &&
      (query.context === undefined || (contextId < 0 ? null : strings[contextId]) === query.context)
    );
    const historicalReadings = uniqueSorted(chosen.flatMap((binding) =>
      binding[3].map((patternId) => pathText[hot.patterns[patternId]![0]]!)
    ));
    if (historicalReadings.length === 0) return null;
    if (historicalReadings.length > 1) return { status: 'candidates', historicalReadings };
    return {
      status: 'resolved',
      historicalReading: historicalReadings[0]!,
      evidenceRefs: uniqueSorted(chosen.flatMap((binding) => binding[4].map((id) => strings[id]!)))
    };
  };

  const segmentOptions = (symbol: string, segment: string, query: HotSinoQuery) => {
    if (!SINO_SYLLABLE.test(segment)) return [] as Array<{ historical: string; context: string | null; evidence: string[] }>;
    const matches = selectMatches(symbol, segment, query);
    if (matches.length > 0) return matches;
    if (tableForms.has(segment) || segment.endsWith('っ')) return [];
    return [{ historical: segment, context: null, evidence: [] }];
  };

  const reconstructWord = (surface: string, modernReading: string, query: HotSinoQuery = {}): HotWordResult => {
    const symbols = Array.from(surface.normalize('NFC'));
    if (symbols.length === 0 || modernReading === '' || !symbols.every((symbol) => HAN.test(symbol))) return null;
    const results = new Map<string, Array<{ surface: string; modernReading: string; historicalReading: string; context: string | null; evidenceRefs: string[] }>>();
    let overflow = false;
    const walk = (index: number, offset: number, text: string, components: Array<{ surface: string; modernReading: string; historicalReading: string; context: string | null; evidenceRefs: string[] }>) => {
      if (overflow) return;
      if (index === symbols.length) {
        if (offset !== modernReading.length) return;
        if (!results.has(text)) results.set(text, components);
        if (results.size > MAX_RESULTS) overflow = true;
        return;
      }
      for (let end = offset + 1; end <= Math.min(modernReading.length, offset + 4); end += 1) {
        const segment = modernReading.slice(offset, end);
        for (const option of segmentOptions(symbols[index]!, segment, query)) {
          walk(index + 1, end, text + option.historical, [...components, {
            surface: symbols[index]!, modernReading: segment, historicalReading: option.historical,
            context: option.context, evidenceRefs: option.evidence
          }]);
        }
      }
    };
    walk(0, 0, '', []);
    if (overflow || results.size === 0) return null;
    const historicalReadings = [...results.keys()].sort(cmp);
    if (historicalReadings.length > 1) return { status: 'candidates', historicalReadings };
    const components = results.get(historicalReadings[0]!)!;
    return {
      status: 'resolved',
      historicalReading: historicalReadings[0]!,
      components,
      evidenceRefs: uniqueSorted(components.flatMap((component) => component.evidenceRefs)),
      ...(query.context !== undefined ? { selectionContext: query.context } : {})
    };
  };

  return { lexemesForFormReading, resolveDirect, reconstructWord };
}
