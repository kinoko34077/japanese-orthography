export interface ContextualLexicalBindingSlice {
  schemaVersion: '1';
  kind: 'japanese-orthography-contextual-lexical-binding-slice';
  bindingNamespaceId: string;
  sourceLexicalNamespaceId: string;
  source: {
    dictionary: string;
    version: string;
    lexicalSourcePath: string;
    archiveMemberSha256: string;
  };
  sourceEvidence: {
    surface: string;
    sourceLemmaId: number;
    lexicalIdentity: string;
    lexicalOrigin: string;
    reading: string;
  };
  bindings: Record<string, string[]>;
}

interface UniDicSourceSliceLike {
  source: {
    dictionary: string;
    version: string;
    archiveMemberSha256: string;
    lexicalNamespaceId: string;
  };
  records: Array<{
    surface: string;
    goshu: string;
    kana: string;
    sourceLemmaId: number;
  }>;
}

export interface ContextualCompilationBindings {
  lexicalNamespaceId: string;
  lexicalBindings: Map<string, string[]>;
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Invalid ${label}`);
}

function toHiragana(value: string): string {
  return Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : char;
  }).join('');
}

function lexicalOrigin(goshu: string): string {
  if (goshu === '和') return 'native';
  if (goshu === '漢') return 'sino';
  if (goshu === '混') return 'mixed';
  if (goshu === '外') return 'loan';
  if (goshu === '固') return 'proper';
  if (goshu === '記号') return 'symbol';
  return 'unknown';
}

function sourceIdentity(source: UniDicSourceSliceLike['source'], sourceLemmaId: number): string {
  return `${source.dictionary.toLowerCase()}:${source.version}:lemma:${sourceLemmaId}`;
}

export function createContextualCompilationBindings(
  slice: ContextualLexicalBindingSlice,
  lexicalSource: UniDicSourceSliceLike
): ContextualCompilationBindings {
  if (slice?.schemaVersion !== '1' || slice?.kind !== 'japanese-orthography-contextual-lexical-binding-slice') {
    throw new Error('Unsupported contextual lexical binding slice');
  }
  requireNonEmptyString(slice.bindingNamespaceId, 'binding namespace');
  requireNonEmptyString(slice.sourceLexicalNamespaceId, 'source lexical namespace');
  requireNonEmptyString(slice.source?.dictionary, 'binding source dictionary');
  requireNonEmptyString(slice.source?.version, 'binding source version');
  requireNonEmptyString(slice.source?.archiveMemberSha256, 'binding source archive SHA-256');

  if (slice.sourceLexicalNamespaceId !== lexicalSource?.source?.lexicalNamespaceId) {
    throw new Error('contextual binding source lexical namespace mismatch');
  }
  if (
    slice.source.dictionary !== lexicalSource.source.dictionary ||
    slice.source.version !== lexicalSource.source.version ||
    slice.source.archiveMemberSha256 !== lexicalSource.source.archiveMemberSha256
  ) {
    throw new Error('contextual binding source identity mismatch');
  }

  const evidence = slice.sourceEvidence;
  requireNonEmptyString(evidence?.surface, 'contextual binding evidence surface');
  if (!Number.isSafeInteger(evidence?.sourceLemmaId) || evidence.sourceLemmaId <= 0) {
    throw new Error('Invalid contextual binding source lemma id');
  }
  requireNonEmptyString(evidence?.lexicalIdentity, 'contextual binding lexical identity');
  requireNonEmptyString(evidence?.lexicalOrigin, 'contextual binding lexical origin');
  requireNonEmptyString(evidence?.reading, 'contextual binding reading');

  const expectedIdentity = sourceIdentity(lexicalSource.source, evidence.sourceLemmaId);
  if (evidence.lexicalIdentity !== expectedIdentity) {
    throw new Error('contextual binding lexical identity mismatch');
  }

  const record = lexicalSource.records.find((entry) => (
    entry.sourceLemmaId === evidence.sourceLemmaId && entry.surface === evidence.surface
  ));
  if (!record) {
    throw new Error('contextual binding source evidence record not found');
  }
  if (lexicalOrigin(record.goshu) !== evidence.lexicalOrigin) {
    throw new Error('contextual binding lexical origin mismatch');
  }
  if (toHiragana(record.kana) !== evidence.reading) {
    throw new Error('contextual binding reading mismatch');
  }

  const entries = Object.entries(slice.bindings ?? {});
  if (entries.length === 0) throw new Error('Contextual binding slice requires bindings');
  const lexicalBindings = new Map<string, string[]>();
  for (const [constraintId, identities] of entries) {
    requireNonEmptyString(constraintId, 'contextual binding constraint id');
    if (!Array.isArray(identities) || identities.length === 0) {
      throw new Error(`Contextual binding ${constraintId} requires identities`);
    }
    const normalized = [...new Set(identities)];
    for (const identity of normalized) {
      requireNonEmptyString(identity, `contextual binding ${constraintId} identity`);
      if (identity !== evidence.lexicalIdentity) {
        throw new Error(`Contextual binding identity lacks accepted source evidence: ${identity}`);
      }
    }
    lexicalBindings.set(constraintId, normalized);
  }

  return { lexicalNamespaceId: slice.bindingNamespaceId, lexicalBindings };
}
