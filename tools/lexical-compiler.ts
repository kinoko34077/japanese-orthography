import { createHash } from 'node:crypto';

export type LexicalOrigin = 'unknown' | 'native' | 'sino' | 'mixed' | 'loan' | 'proper' | 'symbol';

export interface UniDicSourceRecord {
  surface: string;
  pos: [string, string, string, string];
  cType: string;
  cForm: string;
  lForm: string;
  lemma: string;
  orth: string;
  orthBase: string;
  goshu: string;
  kana: string;
  kanaBase: string;
  form: string;
  formBase: string;
  lid: string;
  sourceLemmaId: number;
}

export interface UniDicSourceSlice {
  schemaVersion: '1';
  kind: 'unidic_cwj_source_slice';
  source: {
    dictionary: string;
    version: string;
    archiveMemberSha256: string;
    archiveMemberBytes: number;
    archiveMemberRows: number;
    lexicalNamespaceId: string;
    lexicalNamespaceEvidence: string;
  };
  records: UniDicSourceRecord[];
}

export interface LexicalArtifact {
  schemaVersion: '1';
  kind: 'japanese-orthography-lexical-artifact';
  compilerSemantics: 'unidic-cwj-pmin-slice-v1';
  source: {
    dictionary: string;
    version: string;
    lexCsvSha256: string;
    lexicalNamespaceEvidence: string;
  };
  lexicalNamespaceId: string;
  artifactContentId: string;
  sections: Array<{ id: string; sha256: string; byteLength: number }>;
  lemmas: Array<{
    lemmaIndex: number;
    sourceLemmaId: number;
    lemma: string;
    lForm: string;
    lexicalReading: string;
    lexicalOrigin: LexicalOrigin;
    lexicalIdentity: string;
  }>;
  morphologies: Array<{
    morphologyId: number;
    pos: [string, string, string, string];
    cType: string;
    cForm: string;
  }>;
  candidates: Array<{
    lemmaIndex: number;
    morphologyId: number;
    modernReadings: string[];
  }>;
  surfaceIndex: Array<{ surface: string; candidateOffset: number; candidateCount: number }>;
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalOrdered(value: unknown): CanonicalJson {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalOrdered);
  if (typeof value === 'object') {
    const output: { [key: string]: CanonicalJson } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareText)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = canonicalOrdered(child);
    }
    return output;
  }
  throw new TypeError(`Unsupported lexical artifact value: ${typeof value}`);
}

function orderedSerialize(value: unknown): string {
  return JSON.stringify(canonicalOrdered(value));
}

function toHiragana(value: string): string {
  return Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
  }).join('');
}

function toOrigin(goshu: string): LexicalOrigin {
  if (goshu === '和') return 'native';
  if (goshu === '漢') return 'sino';
  if (goshu === '混') return 'mixed';
  if (goshu === '外') return 'loan';
  if (goshu === '固') return 'proper';
  if (goshu === '記号') return 'symbol';
  return 'unknown';
}

function sourceIdentity(source: UniDicSourceSlice['source'], sourceLemmaId: number): string {
  return `${source.dictionary.toLowerCase()}:${source.version}:lemma:${sourceLemmaId}`;
}

function section(id: string, value: unknown): { id: string; sha256: string; byteLength: number } {
  const text = `${orderedSerialize(value)}\n`;
  return { id, sha256: sha256(text), byteLength: Buffer.byteLength(text, 'utf8') };
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Invalid ${label}`);
}

function validateSourceIdentity(source: UniDicSourceSlice['source']): void {
  requireNonEmptyString(source.dictionary, 'source dictionary');
  requireNonEmptyString(source.version, 'source version');
  if (!/^[0-9a-f]{64}$/.test(source.archiveMemberSha256)) throw new Error('Invalid source lex.csv SHA-256');
  if (!Number.isSafeInteger(source.archiveMemberBytes) || source.archiveMemberBytes <= 0) throw new Error('Invalid source archiveMemberBytes');
  if (!Number.isSafeInteger(source.archiveMemberRows) || source.archiveMemberRows <= 0) throw new Error('Invalid source archiveMemberRows');
  if (!/^[0-9a-f]{64}$/.test(source.lexicalNamespaceId)) throw new Error('Invalid lexicalNamespaceId');
  requireNonEmptyString(source.lexicalNamespaceEvidence, 'lexical namespace evidence');
}

function validateSourceRecord(record: UniDicSourceRecord, index: number): void {
  const prefix = `record[${index}]`;
  requireNonEmptyString(record.surface, `${prefix}.surface`);
  if (!Array.isArray(record.pos) || record.pos.length !== 4 || !record.pos.every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error(`Invalid ${prefix}.pos`);
  }
  requireNonEmptyString(record.cType, `${prefix}.cType`);
  requireNonEmptyString(record.cForm, `${prefix}.cForm`);
  requireNonEmptyString(record.lForm, `${prefix}.lForm`);
  requireNonEmptyString(record.lemma, `${prefix}.lemma`);
  requireNonEmptyString(record.goshu, `${prefix}.goshu`);
  requireNonEmptyString(record.kana, `${prefix}.kana`);
  if (!Number.isSafeInteger(record.sourceLemmaId) || record.sourceLemmaId <= 0) {
    throw new Error(`Invalid ${prefix}.sourceLemmaId`);
  }
}

function validateSourceSlice(sourceSlice: UniDicSourceSlice): void {
  validateSourceIdentity(sourceSlice.source);
  if (!Array.isArray(sourceSlice.records) || sourceSlice.records.length === 0) throw new Error('Lexical source slice requires records');
  sourceSlice.records.forEach(validateSourceRecord);
}

export function compileLexicalSourceSlice(sourceSlice: UniDicSourceSlice): LexicalArtifact {
  if (sourceSlice.schemaVersion !== '1' || sourceSlice.kind !== 'unidic_cwj_source_slice') {
    throw new Error('Unsupported lexical source slice');
  }
  validateSourceSlice(sourceSlice);

  const lemmaBySourceId = new Map<number, { lemma: string; lForm: string; lexicalOrigin: LexicalOrigin }>();
  for (const record of sourceSlice.records) {
    const value = { lemma: record.lemma, lForm: record.lForm, lexicalOrigin: toOrigin(record.goshu) };
    const prior = lemmaBySourceId.get(record.sourceLemmaId);
    if (prior && orderedSerialize(prior) !== orderedSerialize(value)) {
      throw new Error(`Inconsistent lexical identity for source lemma ${record.sourceLemmaId}`);
    }
    lemmaBySourceId.set(record.sourceLemmaId, value);
  }

  const sourceLemmaIds = [...lemmaBySourceId.keys()].sort((a, b) => a - b);
  const lemmaIndexBySource = new Map(sourceLemmaIds.map((sourceLemmaId, lemmaIndex) => [sourceLemmaId, lemmaIndex]));
  const lemmas: LexicalArtifact['lemmas'] = sourceLemmaIds.map((sourceLemmaId, lemmaIndex) => {
    const value = lemmaBySourceId.get(sourceLemmaId)!;
    return {
      lemmaIndex,
      sourceLemmaId,
      lemma: value.lemma,
      lForm: value.lForm,
      lexicalReading: toHiragana(value.lForm),
      lexicalOrigin: value.lexicalOrigin,
      lexicalIdentity: sourceIdentity(sourceSlice.source, sourceLemmaId)
    };
  });

  const morphologyValues = new Map<string, Omit<LexicalArtifact['morphologies'][number], 'morphologyId'>>();
  for (const record of sourceSlice.records) {
    const value = { pos: record.pos, cType: record.cType, cForm: record.cForm };
    morphologyValues.set(orderedSerialize(value), value);
  }
  const morphologies: LexicalArtifact['morphologies'] = [...morphologyValues.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, value], morphologyId) => ({ morphologyId, ...value }));
  const morphologyIdByKey = new Map(morphologies.map((value) => [
    orderedSerialize({ pos: value.pos, cType: value.cType, cForm: value.cForm }), value.morphologyId
  ]));

  const grouped = new Map<string, { surface: string; sourceLemmaId: number; morphologyId: number; modernReadings: Set<string> }>();
  for (const record of sourceSlice.records) {
    const morphologyId = morphologyIdByKey.get(orderedSerialize({ pos: record.pos, cType: record.cType, cForm: record.cForm }));
    if (morphologyId === undefined) throw new Error('Missing morphology identity');
    const key = orderedSerialize([record.surface, record.sourceLemmaId, morphologyId]);
    const group = grouped.get(key) ?? {
      surface: record.surface,
      sourceLemmaId: record.sourceLemmaId,
      morphologyId,
      modernReadings: new Set<string>()
    };
    group.modernReadings.add(toHiragana(record.kana));
    grouped.set(key, group);
  }

  const orderedGroups = [...grouped.values()].sort((a, b) => (
    compareText(a.surface, b.surface) || a.sourceLemmaId - b.sourceLemmaId || a.morphologyId - b.morphologyId
  ));
  const candidates: LexicalArtifact['candidates'] = orderedGroups.map((group) => ({
    lemmaIndex: lemmaIndexBySource.get(group.sourceLemmaId)!,
    morphologyId: group.morphologyId,
    modernReadings: [...group.modernReadings].sort(compareText)
  }));

  const surfaceIndex: LexicalArtifact['surfaceIndex'] = [];
  let offset = 0;
  while (offset < orderedGroups.length) {
    const surface = orderedGroups[offset]!.surface;
    let end = offset + 1;
    while (end < orderedGroups.length && orderedGroups[end]!.surface === surface) end += 1;
    surfaceIndex.push({ surface, candidateOffset: offset, candidateCount: end - offset });
    offset = end;
  }

  const lexicalNamespaceId = sourceSlice.source.lexicalNamespaceId;
  const source = {
    dictionary: sourceSlice.source.dictionary,
    version: sourceSlice.source.version,
    lexCsvSha256: sourceSlice.source.archiveMemberSha256,
    lexicalNamespaceEvidence: sourceSlice.source.lexicalNamespaceEvidence
  };
  const sections = [
    section('lemmas', lemmas),
    section('morphologies', morphologies),
    section('candidates', candidates),
    section('surfaceIndex', surfaceIndex)
  ];
  const artifactContentId = sha256(orderedSerialize({
    compilerSemantics: 'unidic-cwj-pmin-slice-v1', source, lexicalNamespaceId, sections
  }));

  return {
    schemaVersion: '1',
    kind: 'japanese-orthography-lexical-artifact',
    compilerSemantics: 'unidic-cwj-pmin-slice-v1',
    source,
    lexicalNamespaceId,
    artifactContentId,
    sections,
    lemmas,
    morphologies,
    candidates,
    surfaceIndex
  };
}

export function serializeLexicalArtifact(artifact: LexicalArtifact): string {
  return `${orderedSerialize(artifact)}\n`;
}
