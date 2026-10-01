// Phase 4.8B typed lexical entity graph + shared historical->modern reading-convergence DAG (#134).
//
// Every entity is addressed by a typed id `<namespace>:<key>`. Generated/compact storage may use
// dense per-namespace integers, but each reference field declares the namespace it points into, so
// a FormId can never be read as a SymbolId (or a ReadingPath as a ReadingAtom).
//
// Convergence patterns are canonical in the historical -> modern direction. Historical
// reconstruction walks them backwards from a modern reading, restricted to the patterns bound to
// (symbol, modern reading path, optional context), and returns every admissible predecessor.

export const NAMESPACES = [
  'symbol', 'form', 'reading-atom', 'reading-path', 'pattern', 'lexeme',
  'morpheme', 'category', 'relation', 'source', 'evidence', 'context'
] as const;
export type Namespace = typeof NAMESPACES[number];
export type Id<N extends Namespace> = `${N}:${string}`;

const NAMESPACE_SET = new Set<string>(NAMESPACES);

export function makeId<N extends Namespace>(namespace: N, key: string): Id<N> {
  if (!NAMESPACE_SET.has(namespace)) throw new Error(`unknown namespace ${namespace}`);
  if (key === '') throw new Error(`empty ${namespace} key`);
  return `${namespace}:${key}` as Id<N>;
}

export function parseId(id: string): { namespace: Namespace; key: string } {
  for (const namespace of NAMESPACES) {
    if (id.startsWith(`${namespace}:`) && id.length > namespace.length + 1) {
      return { namespace, key: id.slice(namespace.length + 1) };
    }
  }
  throw new Error(`untyped id ${id}`);
}

export const READING_PATH_SEPARATOR = '|';
const pathId = (atoms: readonly string[]) => makeId('reading-path', atoms.join(READING_PATH_SEPARATOR));

export interface PatternEnvironment { leftEndsWith?: string; rightStartsWith?: string }

export interface EntityGraph {
  schemaVersion: '1';
  kind: 'japanese-orthography-lexical-entity-graph';
  sources: { id: Id<'source'>; sourceClass: string }[];
  evidence: { id: Id<'evidence'>; source: Id<'source'> }[];
  contexts: { id: Id<'context'> }[];
  categories: { id: Id<'category'> }[];
  symbols: { id: Id<'symbol'>; text: string }[];
  forms: { id: Id<'form'>; text: string; symbols: Id<'symbol'>[] }[];
  readingAtoms: { id: Id<'reading-atom'>; kana: string }[];
  readingPaths: { id: Id<'reading-path'>; atoms: Id<'reading-atom'>[] }[];
  convergencePatterns: { id: Id<'pattern'>; from: Id<'reading-path'>; to: Id<'reading-path'>; environment?: PatternEnvironment; base?: Id<'pattern'>; mechanism?: string; derivations?: Id<'pattern'>[] }[];
  bindings: { symbol: Id<'symbol'>; modern: Id<'reading-path'>; context: Id<'context'> | null; patterns: Id<'pattern'>[]; evidence: Id<'evidence'>[] }[];
  lexemes: { id: Id<'lexeme'>; forms: Id<'form'>[]; readings: Id<'reading-path'>[]; categories: Id<'category'>[]; sourceRefs: string[]; composition?: (Id<'lexeme'> | Id<'morpheme'>)[] }[];
  morphemes: { id: Id<'morpheme'>; form: Id<'form'>; reading: Id<'reading-path'> }[];
  relations: { id: Id<'relation'>; lexeme: Id<'lexeme'> }[];
  // Reading restricted to a subset of the lexeme's forms (JMdict re_restr; empty = re_nokanji).
  restrictions: { lexeme: Id<'lexeme'>; reading: Id<'reading-path'>; forms: Id<'form'>[] }[];
}

export type Collection = Exclude<keyof EntityGraph, 'schemaVersion' | 'kind'>;

// Field schema: `ns` single ref, `ns[]` ref list, `ns|null` nullable ref, `a/b[]` union ref list,
// `value` opaque scalar/JSON, trailing `?` optional field.
export const ENTITY_SCHEMA: Record<Collection, { namespace: Namespace | null; fields: Record<string, string> }> = {
  sources: { namespace: 'source', fields: { sourceClass: 'value' } },
  evidence: { namespace: 'evidence', fields: { source: 'source' } },
  contexts: { namespace: 'context', fields: {} },
  categories: { namespace: 'category', fields: {} },
  symbols: { namespace: 'symbol', fields: { text: 'value' } },
  forms: { namespace: 'form', fields: { text: 'value', symbols: 'symbol[]' } },
  readingAtoms: { namespace: 'reading-atom', fields: { kana: 'value' } },
  readingPaths: { namespace: 'reading-path', fields: { atoms: 'reading-atom[]' } },
  convergencePatterns: { namespace: 'pattern', fields: { from: 'reading-path', to: 'reading-path', environment: 'value?', base: 'pattern?', mechanism: 'value?', derivations: 'pattern[]?' } },
  bindings: { namespace: null, fields: { symbol: 'symbol', modern: 'reading-path', context: 'context|null', patterns: 'pattern[]', evidence: 'evidence[]' } },
  lexemes: { namespace: 'lexeme', fields: { forms: 'form[]', readings: 'reading-path[]', categories: 'category[]', sourceRefs: 'value', composition: 'lexeme/morpheme[]?' } },
  morphemes: { namespace: 'morpheme', fields: { form: 'form', reading: 'reading-path' } },
  relations: { namespace: 'relation', fields: { lexeme: 'lexeme' } },
  restrictions: { namespace: null, fields: { lexeme: 'lexeme', reading: 'reading-path', forms: 'form[]' } }
};
export const COLLECTIONS = Object.keys(ENTITY_SCHEMA) as Collection[];

interface FieldSpec { optional: boolean; kind: 'value' | 'ref' | 'refs' | 'nullable'; namespaces: Namespace[] }
function fieldSpec(spec: string): FieldSpec {
  const optional = spec.endsWith('?');
  const body = optional ? spec.slice(0, -1) : spec;
  if (body === 'value') return { optional, kind: 'value', namespaces: [] };
  if (body.endsWith('[]')) return { optional, kind: 'refs', namespaces: body.slice(0, -2).split('/') as Namespace[] };
  if (body.endsWith('|null')) return { optional, kind: 'nullable', namespaces: [body.slice(0, -5) as Namespace] };
  return { optional, kind: 'ref', namespaces: [body as Namespace] };
}

// ---------------------------------------------------------------------------------------------
// Builder

export interface RawEntityGraph {
  sources: { key: string; sourceClass: string }[];
  evidence: { key: string; source: string }[];
  contexts: string[];
  patterns: { key: string; from: string[]; to: string[]; environment?: PatternEnvironment; base?: string; mechanism?: string; derivations?: string[] }[];
  bindings: { symbol: string; modern: string[]; context: string | null; patterns: string[]; evidence: string[] }[];
  lexemes: { key: string; forms: string[]; readings: { path: string[] }[]; categories: string[]; sourceRefs: string[]; composition?: string[] }[];
  morphemes: { key: string; form: string; reading: string[] }[];
  relations: { key: string; lexeme: string }[];
  restrictions?: { lexeme: string; reading: string[]; forms: string[] }[];
}

export function buildEntityGraph(raw: RawEntityGraph): EntityGraph {
  const maps = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map<string, any>()])) as Record<Collection, Map<string, any>>;
  const put = (collection: Collection, entity: { id: string; [field: string]: unknown }) => {
    const existing = maps[collection].get(entity.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(entity)) throw new Error(`conflicting ${entity.id}`);
    maps[collection].set(entity.id, entity);
    return entity.id;
  };
  const symbol = (text: string) => put('symbols', { id: makeId('symbol', text), text });
  const form = (text: string) => put('forms', { id: makeId('form', text), text, symbols: Array.from(text.normalize('NFC')).map(symbol) });
  const atom = (kana: string) => put('readingAtoms', { id: makeId('reading-atom', kana), kana });
  const path = (atoms: string[]) => {
    if (atoms.length === 0) throw new Error('empty reading path');
    return put('readingPaths', { id: pathId(atoms), atoms: atoms.map(atom) });
  };
  const ref = <N extends Namespace>(namespace: N, value: string) => (value.startsWith(`${namespace}:`) ? value : makeId(namespace, value));

  for (const s of raw.sources) put('sources', { id: makeId('source', s.key), sourceClass: s.sourceClass });
  for (const e of raw.evidence) put('evidence', { id: makeId('evidence', e.key), source: ref('source', e.source) });
  for (const c of raw.contexts) put('contexts', { id: makeId('context', c) });
  for (const p of raw.patterns) {
    put('convergencePatterns', {
      id: makeId('pattern', p.key), from: path(p.from), to: path(p.to),
      ...(p.environment ? { environment: p.environment } : {}),
      ...(p.base ? { base: ref('pattern', p.base) } : {}),
      ...(p.mechanism ? { mechanism: p.mechanism } : {}),
      ...(p.derivations?.length ? { derivations: p.derivations.map((d) => ref('pattern', d)) } : {})
    });
  }
  const bindingKeys = new Set<string>();
  const bindings: EntityGraph['bindings'] = [];
  for (const b of raw.bindings) {
    const entry = {
      symbol: symbol(b.symbol) as Id<'symbol'>,
      modern: path(b.modern) as Id<'reading-path'>,
      context: b.context === null ? null : ref('context', b.context) as Id<'context'>,
      patterns: b.patterns.map((p) => ref('pattern', p)) as Id<'pattern'>[],
      evidence: b.evidence.map((e) => ref('evidence', e)) as Id<'evidence'>[]
    };
    const key = JSON.stringify([entry.symbol, entry.modern, entry.context]);
    if (bindingKeys.has(key)) throw new Error(`duplicate binding ${key}`);
    bindingKeys.add(key);
    bindings.push(entry);
  }
  for (const m of raw.morphemes) put('morphemes', { id: makeId('morpheme', m.key), form: form(m.form), reading: path(m.reading) });
  for (const l of raw.lexemes) {
    put('lexemes', {
      id: makeId('lexeme', l.key),
      forms: l.forms.map(form),
      readings: l.readings.map((r) => path(r.path)),
      categories: l.categories.map((c) => put('categories', { id: makeId('category', c) })),
      sourceRefs: [...l.sourceRefs],
      ...(l.composition ? { composition: l.composition.map((part) => { parseId(part); return part; }) } : {})
    });
  }
  for (const r of raw.relations) put('relations', { id: makeId('relation', r.key), lexeme: ref('lexeme', r.lexeme) });
  const restrictions = (raw.restrictions ?? []).map((r) => ({ lexeme: ref('lexeme', r.lexeme), reading: path(r.reading), forms: r.forms.map(form) }));

  const graph = {
    schemaVersion: '1', kind: 'japanese-orthography-lexical-entity-graph',
    ...Object.fromEntries(COLLECTIONS.map((c) => [c, [...maps[c].values()]])),
    bindings,
    restrictions
  } as EntityGraph;
  const diagnostics = validateEntityGraph(graph);
  if (diagnostics.length) throw new Error(`entity graph invalid:\n${diagnostics.join('\n')}`);
  return canonicalizeEntityGraph(graph);
}

// ---------------------------------------------------------------------------------------------
// Validation (fail closed on cross-namespace misuse and dangling references)

export function validateEntityGraph(graph: EntityGraph): string[] {
  const diagnostics: string[] = [];
  const known = new Set<string>();
  for (const collection of COLLECTIONS) {
    const { namespace } = ENTITY_SCHEMA[collection];
    if (!namespace) continue;
    for (const entity of graph[collection] as { id: string }[]) {
      try {
        if (parseId(entity.id).namespace !== namespace) diagnostics.push(`${collection} holds ${entity.id}`);
      } catch (error) { diagnostics.push((error as Error).message); }
      if (known.has(entity.id)) diagnostics.push(`duplicate ${entity.id}`);
      known.add(entity.id);
    }
  }
  const check = (owner: string, field: string, spec: FieldSpec, value: unknown) => {
    const one = (ref: unknown) => {
      if (typeof ref !== 'string') return diagnostics.push(`${owner}.${field} holds non-id ${JSON.stringify(ref)}`);
      let namespace: Namespace;
      try { namespace = parseId(ref).namespace; } catch { return diagnostics.push(`${owner}.${field} holds untyped ${ref}`); }
      if (!spec.namespaces.includes(namespace)) return diagnostics.push(`${owner}.${field} expects ${spec.namespaces.join('/')}, got ${ref}`);
      if (!known.has(ref)) diagnostics.push(`${owner}.${field} dangling ${ref}`);
    };
    if (spec.kind === 'refs') {
      if (!Array.isArray(value)) return diagnostics.push(`${owner}.${field} must be a list`);
      value.forEach(one);
    } else if (spec.kind === 'nullable') { if (value !== null) one(value); } else one(value);
  };
  for (const collection of COLLECTIONS) {
    const { fields } = ENTITY_SCHEMA[collection];
    (graph[collection] as Record<string, unknown>[]).forEach((entity, index) => {
      const owner = (entity.id as string | undefined) ?? `${collection}[${index}]`;
      for (const [field, raw] of Object.entries(fields)) {
        const spec = fieldSpec(raw);
        if (!(field in entity)) { if (!spec.optional) diagnostics.push(`${owner}.${field} missing`); continue; }
        if (spec.kind !== 'value') check(owner, field, spec, entity[field]);
      }
      for (const field of Object.keys(entity)) if (field !== 'id' && !(field in fields)) diagnostics.push(`${owner} has unknown field ${field}`);
    });
  }
  const seen = new Set<string>();
  for (const b of graph.bindings) {
    const key = JSON.stringify([b.symbol, b.modern, b.context]);
    if (seen.has(key)) diagnostics.push(`duplicate binding ${key}`);
    seen.add(key);
  }
  for (const p of graph.readingPaths) {
    const expected = pathId(p.atoms.map((a) => (a.startsWith('reading-atom:') ? a.slice('reading-atom:'.length) : a)));
    if (p.atoms.every((a) => a.startsWith('reading-atom:')) && expected !== p.id) diagnostics.push(`${p.id} does not match its atoms`);
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------------------------
// Canonicalization (storage order never carries meaning)

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function canonicalizeEntityGraph(graph: EntityGraph): EntityGraph {
  const sortedRefs = new Set(['patterns', 'evidence', 'categories', 'derivations']);
  const result: Record<string, unknown> = { schemaVersion: graph.schemaVersion, kind: graph.kind };
  for (const collection of COLLECTIONS) {
    const { fields } = ENTITY_SCHEMA[collection];
    const entities = (graph[collection] as Record<string, unknown>[]).map((entity) => {
      const out: Record<string, unknown> = 'id' in entity ? { id: entity.id } : {};
      for (const field of Object.keys(fields)) {
        if (!(field in entity)) continue;
        const value = entity[field];
        out[field] = Array.isArray(value) && sortedRefs.has(field) ? [...value].sort(cmp) : value;
      }
      return out;
    });
    const sortKey = (e: Record<string, unknown>) => String(e.id ?? JSON.stringify(e));
    entities.sort((a, b) => cmp(sortKey(a), sortKey(b)));
    result[collection] = entities;
  }
  return structuredClone(result) as unknown as EntityGraph;
}

// ---------------------------------------------------------------------------------------------
// Compact representation: per-namespace dense tables, references as indexes into the declared namespace.

export interface CompactEntityGraph {
  schemaVersion: '1';
  kind: 'japanese-orthography-lexical-entity-graph-compact';
  schema: Record<string, Record<string, string>>;
  /** Columns omitted because every row equals the declared derivation from its key (4.8G). */
  derived?: Record<string, string[]>;
  tables: Record<string, Record<string, unknown[]> & { key: string[] }> & Record<string, any>;
}

// Content-derived columns: identical to a pure function of the entity key for graphs built by
// buildEntityGraph. A column is only omitted when the derivation holds for every row.
const DERIVATIONS: Partial<Record<Collection, Record<string, (key: string) => unknown>>> = {
  symbols: { text: (key) => key },
  forms: { text: (key) => key, symbols: (key) => Array.from(key).map((c) => `symbol:${c}`) },
  readingAtoms: { kana: (key) => key },
  readingPaths: { atoms: (key) => key.split(READING_PATH_SEPARATOR).map((a) => `reading-atom:${a}`) }
};

const tableName = (collection: Collection) => ENTITY_SCHEMA[collection].namespace ?? collection;
const expectedSchema = () => Object.fromEntries(COLLECTIONS.map((c) => [tableName(c), { ...ENTITY_SCHEMA[c].fields }]));

export function compactEntityGraph(input: EntityGraph): CompactEntityGraph {
  const graph = canonicalizeEntityGraph(input);
  const index = new Map<string, number>();
  for (const collection of COLLECTIONS) {
    if (!ENTITY_SCHEMA[collection].namespace) continue;
    (graph[collection] as { id: string }[]).forEach((entity, i) => index.set(entity.id, i));
  }
  const encode = (spec: FieldSpec, ref: string) => {
    const at = index.get(ref)!;
    if (spec.namespaces.length === 1) return at;
    return [spec.namespaces.indexOf(parseId(ref).namespace), at];
  };
  const tables: Record<string, any> = {};
  const derived: Record<string, string[]> = {};
  for (const collection of COLLECTIONS) {
    const { namespace, fields } = ENTITY_SCHEMA[collection];
    const entities = graph[collection] as Record<string, any>[];
    const table: Record<string, unknown[]> = {};
    if (namespace) table.key = entities.map((e) => parseId(e.id).key);
    for (const [field, raw] of Object.entries(fields)) {
      const spec = fieldSpec(raw);
      const derive = DERIVATIONS[collection]?.[field];
      if (derive && entities.every((e, i) => JSON.stringify(derive(table.key![i] as string)) === JSON.stringify(e[field]))) {
        (derived[tableName(collection)] ??= []).push(field);
        continue;
      }
      table[field] = entities.map((e) => {
        if (!(field in e)) return undefined;
        const value = e[field];
        if (spec.kind === 'value') return value;
        if (spec.kind === 'refs') return (value as string[]).map((ref) => encode(spec, ref));
        if (value === null) return null;
        return encode(spec, value as string);
      }).map((v) => (v === undefined ? null : v)); // optional fields are never null, so null marks absence
    }
    tables[tableName(collection)] = table;
  }
  return { schemaVersion: '1', kind: 'japanese-orthography-lexical-entity-graph-compact', schema: expectedSchema(), derived, tables };
}

export function inflateEntityGraph(compact: CompactEntityGraph): EntityGraph {
  const expected = expectedSchema();
  for (const [table, fields] of Object.entries(expected)) {
    for (const [field, spec] of Object.entries(fields)) {
      if (compact.schema?.[table]?.[field] !== spec) throw new Error(`schema mismatch ${table}.${field}`);
    }
    if (Object.keys(compact.schema?.[table] ?? {}).length !== Object.keys(fields).length) throw new Error(`schema mismatch ${table}`);
  }
  const keys = (namespace: Namespace) => (compact.tables[namespace]?.key ?? []) as string[];
  const decodeOne = (spec: FieldSpec, raw: unknown, owner: string) => {
    let namespace = spec.namespaces[0]!;
    let at = raw;
    if (spec.namespaces.length > 1) {
      if (!Array.isArray(raw) || raw.length !== 2) throw new Error(`${owner}: malformed union ref`);
      namespace = spec.namespaces[raw[0] as number]!;
      at = raw[1];
      if (!namespace) throw new Error(`${owner}: union namespace code ${raw[0]} out of range`);
    }
    const table = keys(namespace);
    if (!Number.isInteger(at) || (at as number) < 0 || (at as number) >= table.length) throw new Error(`${owner}: ${namespace} index ${String(at)} out of range`);
    return makeId(namespace, table[at as number]!);
  };
  const graph: Record<string, unknown> = { schemaVersion: '1', kind: 'japanese-orthography-lexical-entity-graph' };
  for (const collection of COLLECTIONS) {
    const { namespace, fields } = ENTITY_SCHEMA[collection];
    const table = compact.tables[tableName(collection)] as Record<string, unknown[]>;
    const size = namespace ? table.key!.length : (table[Object.keys(fields)[0]!] ?? []).length;
    const entities: Record<string, unknown>[] = [];
    for (let i = 0; i < size; i += 1) {
      const entity: Record<string, unknown> = namespace ? { id: makeId(namespace, table.key![i] as string) } : {};
      for (const [field, raw] of Object.entries(fields)) {
        const spec = fieldSpec(raw);
        if (compact.derived?.[tableName(collection)]?.includes(field)) {
          const derive = DERIVATIONS[collection]?.[field];
          if (!derive || !namespace) throw new Error(`no derivation for ${tableName(collection)}.${field}`);
          entity[field] = derive(table.key![i] as string);
          continue;
        }
        const value = table[field]?.[i];
        if (spec.optional && value === null) continue;
        if (value === undefined) throw new Error(`${tableName(collection)}.${field} missing at ${i}`);
        const owner = `${tableName(collection)}[${i}].${field}`;
        if (spec.kind === 'value') entity[field] = value;
        else if (spec.kind === 'refs') {
          if (!Array.isArray(value)) throw new Error(`${owner}: expected list`);
          entity[field] = value.map((v) => decodeOne(spec, v, owner).toString());
        } else if (value === null && spec.kind === 'nullable') entity[field] = null;
        else entity[field] = decodeOne(spec, value, owner);
      }
      entities.push(entity);
    }
    graph[collection] = entities;
  }
  const inflated = graph as unknown as EntityGraph;
  const diagnostics = validateEntityGraph(inflated);
  if (diagnostics.length) throw new Error(`inflated graph invalid: ${diagnostics[0]}`);
  return canonicalizeEntityGraph(inflated);
}

// ---------------------------------------------------------------------------------------------
// Runtime: lookups and reverse reading-DAG reconstruction

export interface ReconstructOptions { context?: string | null }
export interface Reconstruction {
  status: 'resolved' | 'candidates' | 'unresolved';
  historical: string[];
  chains?: Id<'pattern'>[][];
}

export function createEntityGraphRuntime(input: EntityGraph) {
  const graph = canonicalizeEntityGraph(input);
  const pathAtoms = new Map(graph.readingPaths.map((p) => [p.id, p.atoms]));
  const atomKana = new Map(graph.readingAtoms.map((a) => [a.id, a.kana]));
  const pathText = (id: string) => (pathAtoms.get(id as Id<'reading-path'>) ?? []).map((a) => atomKana.get(a)).join('');
  const patterns = new Map(graph.convergencePatterns.map((p) => [p.id, p]));
  const byForm = new Map<string, string[]>();
  const byReading = new Map<string, string[]>();
  const toModern = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => { const list = map.get(key) ?? []; list.push(value); map.set(key, list); };
  for (const l of graph.lexemes) {
    for (const f of l.forms) push(byForm, f, l.id);
    for (const r of l.readings) push(byReading, r, l.id);
  }
  for (const p of graph.convergencePatterns) push(toModern, p.to, p.id);
  const bindingsByKey = new Map<string, EntityGraph['bindings']>();
  for (const b of graph.bindings) push(bindingsByKey as unknown as Map<string, string[]>, JSON.stringify([b.symbol, b.modern]), b as unknown as string);
  const sorted = (values: string[] | undefined) => [...new Set(values ?? [])].sort(cmp);

  const selectBindings = (symbol: string, modern: string, options: ReconstructOptions) => {
    const all = (bindingsByKey.get(JSON.stringify([makeId('symbol', symbol), pathId([modern])])) ?? []) as EntityGraph['bindings'];
    if (!('context' in options) || options.context === undefined) return all;
    const context = options.context === null ? null : makeId('context', options.context.replace(/^context:/, ''));
    const exact = all.filter((b) => b.context === context);
    if (exact.length > 0) return exact;
    if (all.some((b) => b.context !== null)) return [];
    return all.filter((b) => b.context === null);
  };

  // Walk allowed patterns backwards from `node`; every terminal predecessor reached through at least
  // one pattern is an admissible historical path.
  const predecessors = (node: string, allowed: Set<string>, left: string | undefined, right: string | undefined) => {
    const out: { historical: string; chain: Id<'pattern'>[] }[] = [];
    const walk = (current: string, chain: Id<'pattern'>[], visited: Set<string>) => {
      const incoming = (toModern.get(current) ?? []).filter((id) => allowed.has(id)).map((id) => patterns.get(id as Id<'pattern'>)!)
        .filter((p) => (!p.environment?.leftEndsWith || (left ?? '').endsWith(p.environment.leftEndsWith))
          && (!p.environment?.rightStartsWith || (right ?? '').startsWith(p.environment.rightStartsWith)));
      if (incoming.length === 0) { if (chain.length) out.push({ historical: pathText(current), chain }); return; }
      for (const p of incoming) {
        // identity pattern: the source attests no spelling change for this reading
        if (p.from === current) { out.push({ historical: pathText(current), chain: [...chain, p.id] }); continue; }
        if (visited.has(p.from)) continue;
        walk(p.from, [...chain, p.id], new Set([...visited, p.from]));
      }
    };
    walk(node, [], new Set([node]));
    return out;
  };

  const reconstruct = (symbols: readonly string[], modernAtoms: readonly string[], options: ReconstructOptions = {}): Reconstruction => {
    if (symbols.length === 0 || symbols.length !== modernAtoms.length) return { status: 'unresolved', historical: [] };
    const positions: { historical: string; chain: Id<'pattern'>[] }[][] = [];
    for (let i = 0; i < symbols.length; i += 1) {
      const bindings = selectBindings(symbols[i]!, modernAtoms[i]!, options);
      const options_: { historical: string; chain: Id<'pattern'>[] }[] = [];
      for (const b of bindings) {
        if (b.patterns.length === 0) { options_.push({ historical: modernAtoms[i]!, chain: [] }); continue; }
        options_.push(...predecessors(b.modern, new Set(b.patterns), modernAtoms[i - 1], modernAtoms[i + 1]));
      }
      if (options_.length === 0) return { status: 'unresolved', historical: [] };
      positions.push(options_);
    }
    const results = new Map<string, Id<'pattern'>[][]>();
    const walk = (i: number, text: string, chains: Id<'pattern'>[][]) => {
      if (i === positions.length) { if (!results.has(text)) results.set(text, chains); return; }
      for (const option of positions[i]!) walk(i + 1, text + option.historical, [...chains, option.chain]);
    };
    walk(0, '', []);
    const historical = [...results.keys()].sort(cmp);
    if (historical.length === 1) return { status: 'resolved', historical, chains: results.get(historical[0]!)! };
    return { status: 'candidates', historical };
  };

  return {
    graph,
    lexemesByForm: (form: string) => sorted(byForm.get(form)),
    lexemesByReading: (path: string) => sorted(byReading.get(path)),
    patternsToModern: (path: string) => sorted(toModern.get(path)),
    reconstruct
  };
}
