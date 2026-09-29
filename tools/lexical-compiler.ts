import { createHash } from 'node:crypto';
import { stableSerialize } from './normalize.ts';

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
  };
  records: UniDicSourceRecord[];
}

export interface LexicalArtifact {
  schemaVersion: '1';
  kind: 'japanese-orthography-lexical-artifact';
  compilerSemantics: 'unidic-cwj-pmin-slice-v1';
  source: { dictionary: string; version: string; lexCsvSha256: string };
  lexicalNamespaceId: string;
  artifactContentId: string;
  sections: Array<{ id: string; sha256: string; byteLength: number }>;
  lemmas: Array<{
    localLemmaId: number;
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
    localLemmaId: number;
    morphologyId: number;
    modernReadings: string[];
  }>;
  surfaceIndex: Array<{ surface: string; candidateOffset: number; candidateCount: number }>;
}

const originEntries: ReadonlyArray<readonly [number, LexicalOrigin]> = [
  [0, 'unknown'], [1, 'native'], [2, 'sino'], [3, 'mixed'], [4, 'loan'], [5, 'proper'], [6, 'symbol']
];

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function u32(value: number): Buffer { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; }
function u64(value: number): Buffer { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; }
function lengthPrefixed(value: string): Buffer { const body = Buffer.from(value, 'utf8'); return Buffer.concat([u32(body.length), body]); }

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

function namespaceId(source: UniDicSourceSlice['source'], lemmas: LexicalArtifact['lemmas']): string {
  const chunks: Buffer[] = [Buffer.from('JORTHLEXNS1\0', 'ascii')];
  chunks.push(lengthPrefixed(source.dictionary), lengthPrefixed(source.version));
  if (!/^[0-9a-f]{64}$/.test(source.archiveMemberSha256)) throw new Error('Invalid source lex.csv SHA-256');
  chunks.push(Buffer.from(source.archiveMemberSha256, 'hex'), u32(originEntries.length));
  for (const [code, name] of originEntries) {
    chunks.push(Buffer.from([code]), lengthPrefixed(name));
  }
  chunks.push(u32(lemmas.length));
  for (const lemma of lemmas) {
    const origin = originEntries.find((entry) => entry[1] === lemma.lexicalOrigin)?.[0] ?? 0;
    chunks.push(u32(lemma.localLemmaId), u64(lemma.sourceLemmaId), lengthPrefixed(lemma.lForm), Buffer.from([origin]));
  }
  return sha256(Buffer.concat(chunks));
}

function section(id: string, value: unknown): { id: string; sha256: string; byteLength: number } {
  const text = `${stableSerialize(value as never)}\n`;
  return { id, sha256: sha256(text), byteLength: Buffer.byteLength(text, 'utf8') };
}

export function compileLexicalSourceSlice(sourceSlice: UniDicSourceSlice): LexicalArtifact {
  if (sourceSlice.schemaVersion !== '1' || sourceSlice.kind !== 'unidic_cwj_source_slice') {
    throw new Error('Unsupported lexical source slice');
  }
  const lemmaBySourceId = new Map<number, { lemma: string; lForm: string; lexicalOrigin: LexicalOrigin }>();
  for (const record of sourceSlice.records) {
    const value = { lemma: record.lemma, lForm: record.lForm, lexicalOrigin: toOrigin(record.goshu) };
    const prior = lemmaBySourceId.get(record.sourceLemmaId);
    if (prior && stableSerialize(prior as never) !== stableSerialize(value as never)) {
      throw new Error(`Inconsistent lexical identity for source lemma ${record.sourceLemmaId}`);
    }
    lemmaBySourceId.set(record.sourceLemmaId, value);
  }
  const sourceLemmaIds = [...lemmaBySourceId.keys()].sort((a, b) => a - b);
  const localBySource = new Map(sourceLemmaIds.map((sourceLemmaId, localLemmaId) => [sourceLemmaId, localLemmaId]));
  const lemmas: LexicalArtifact['lemmas'] = sourceLemmaIds.map((sourceLemmaId, localLemmaId) => {
    const value = lemmaBySourceId.get(sourceLemmaId)!;
    return {
      localLemmaId,
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
    morphologyValues.set(stableSerialize(value as never), value);
  }
  const morphologies: LexicalArtifact['morphologies'] = [...morphologyValues.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, value], morphologyId) => ({ morphologyId, ...value }));
  const morphologyIdByKey = new Map(morphologies.map((value) => [
    stableSerialize({ pos: value.pos, cType: value.cType, cForm: value.cForm } as never), value.morphologyId
  ]));

  const grouped = new Map<string, { surface: string; sourceLemmaId: number; morphologyId: number; modernReadings: Set<string> }>();
  for (const record of sourceSlice.records) {
    const morphologyId = morphologyIdByKey.get(stableSerialize({ pos: record.pos, cType: record.cType, cForm: record.cForm } as never));
    if (morphologyId === undefined) throw new Error('Missing morphology identity');
    const key = stableSerialize([record.surface, record.sourceLemmaId, morphologyId] as never);
    const group = grouped.get(key) ?? { surface: record.surface, sourceLemmaId: record.sourceLemmaId, morphologyId, modernReadings: new Set<string>() };
    group.modernReadings.add(toHiragana(record.kana));
    grouped.set(key, group);
  }
  const orderedGroups = [...grouped.values()].sort((a, b) => (
    compareText(a.surface, b.surface) || a.sourceLemmaId - b.sourceLemmaId || a.morphologyId - b.morphologyId
  ));
  const candidates: LexicalArtifact['candidates'] = orderedGroups.map((group) => ({
    localLemmaId: localBySource.get(group.sourceLemmaId)!,
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

  const lexicalNamespaceId = namespaceId(sourceSlice.source, lemmas);
  const source = { dictionary: sourceSlice.source.dictionary, version: sourceSlice.source.version, lexCsvSha256: sourceSlice.source.archiveMemberSha256 };
  const sections = [section('lemmas', lemmas), section('morphologies', morphologies), section('candidates', candidates), section('surfaceIndex', surfaceIndex)];
  const artifactContentId = sha256(stableSerialize({ compilerSemantics: 'unidic-cwj-pmin-slice-v1', source, lexicalNamespaceId, sections } as never));
  return { schemaVersion: '1', kind: 'japanese-orthography-lexical-artifact', compilerSemantics: 'unidic-cwj-pmin-slice-v1', source, lexicalNamespaceId, artifactContentId, sections, lemmas, morphologies, candidates, surfaceIndex };
}

export function serializeLexicalArtifact(artifact: LexicalArtifact): string {
  return `${stableSerialize(artifact as never)}\n`;
}
