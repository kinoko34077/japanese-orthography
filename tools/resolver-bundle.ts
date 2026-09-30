import { createHash } from 'node:crypto';
import { compileWorkspace } from './compiler.ts';
import { createContextualCompilationBindings, type ContextualLexicalBindingSlice } from './contextual-lexical-bindings.ts';
import { compileLexicalSourceSlice, type LexicalArtifact, type UniDicSourceSlice } from './lexical-compiler.ts';

const CAPABILITIES = [
  'lexical',
  'historical-native',
  'historical-sino',
  'contextual-kanji',
  'safe-character',
  'late-rendering'
] as const;

type JsonRecord = Record<string, any>;

export interface ResolverBundleBuildInputs {
  lexicalSource: UniDicSourceSlice;
  nativeSlice: JsonRecord;
  sinoSlice: JsonRecord;
  contextualBindingSlice: ContextualLexicalBindingSlice;
  contextualManifest: JsonRecord;
  contextualTaiPack: JsonRecord;
  safeCharacterSlice: JsonRecord;
}

export interface ResolverBundleArtifact {
  schemaVersion: '1';
  kind: 'japanese-orthography-resolver-bundle-artifact';
  bundleSemantics: 'phase3-first-slice-v1';
  bundleContentId: string;
  capabilities: typeof CAPABILITIES;
  sections: Array<{ id: string; contentId: string }>;
  lexicalArtifact: LexicalArtifact;
  historicalNativeSlice: JsonRecord;
  historicalSinoSlice: JsonRecord;
  contextual: {
    bindingNamespaceId: string;
    sourceLexicalNamespaceId: string;
    relations: JsonRecord[];
    safety: JsonRecord[];
  };
  safeCharacterSlice: JsonRecord;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort(compareText)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = canonicalize(child);
    }
    return output;
  }
  throw new TypeError(`Unsupported resolver bundle value: ${typeof value}`);
}

function serialize(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  return createHash('sha256').update(serialize(value), 'utf8').digest('hex');
}

function located(value: JsonRecord, file: string, pointer: string) {
  return { value, location: { file, pointer } };
}

function compileContextualAnchor(inputs: ResolverBundleBuildInputs, lexicalNamespaceId: string) {
  const bindings = createContextualCompilationBindings(inputs.contextualBindingSlice, inputs.lexicalSource);
  if (inputs.contextualBindingSlice.sourceLexicalNamespaceId !== lexicalNamespaceId) {
    throw new Error('Resolver bundle contextual source lexical namespace mismatch');
  }

  const relation = inputs.contextualTaiPack.positiveRelations?.find((entry: JsonRecord) => entry.id === 'rel-taifu');
  if (!relation) throw new Error('Resolver bundle requires canonical rel-taifu');
  const unit = inputs.contextualTaiPack.restorationUnits?.find((entry: JsonRecord) => entry.id === relation.unitId);
  if (!unit) throw new Error('Resolver bundle requires rel-taifu restoration unit');

  const workspace: any = {
    sources: [], evidence: [], lexicalEvidence: [], lexicalConstraintSets: [],
    restorationUnits: [located(unit, 'data/packs/contextual-kanji/merged-tai.json', '/restorationUnits')],
    positiveRelations: [located(relation, 'data/packs/contextual-kanji/merged-tai.json', '/positiveRelations')],
    safetyConstraints: [], reviewHints: [],
    packMetadata: [located(inputs.contextualManifest, 'data/packs/contextual-kanji/manifest.json', '')]
  };
  const compiled = compileWorkspace(workspace, bindings);
  return {
    bindingNamespaceId: bindings.lexicalNamespaceId,
    sourceLexicalNamespaceId: inputs.contextualBindingSlice.sourceLexicalNamespaceId,
    relations: JSON.parse(compiled['hot-relations.json']) as JsonRecord[],
    safety: [] as JsonRecord[]
  };
}

export function buildResolverBundleArtifact(inputs: ResolverBundleBuildInputs): ResolverBundleArtifact {
  const lexicalArtifact = compileLexicalSourceSlice(inputs.lexicalSource);
  const lexicalNamespaceId = lexicalArtifact.lexicalNamespaceId;
  if (inputs.nativeSlice?.lexicalNamespaceId !== lexicalNamespaceId) {
    throw new Error('Resolver bundle native lexical namespace mismatch');
  }
  if (inputs.sinoSlice?.lexicalNamespaceId !== lexicalNamespaceId) {
    throw new Error('Resolver bundle Sino lexical namespace mismatch');
  }

  const contextual = compileContextualAnchor(inputs, lexicalNamespaceId);
  const sections = [
    { id: 'lexical', contentId: lexicalArtifact.artifactContentId },
    { id: 'historical-native', contentId: sha256(inputs.nativeSlice) },
    { id: 'historical-sino', contentId: sha256(inputs.sinoSlice) },
    { id: 'contextual-kanji', contentId: sha256(contextual) },
    { id: 'safe-character', contentId: sha256(inputs.safeCharacterSlice) }
  ];
  const bundleIdentity = {
    bundleSemantics: 'phase3-first-slice-v1',
    lexicalNamespaceId,
    capabilities: CAPABILITIES,
    sections
  };

  return {
    schemaVersion: '1',
    kind: 'japanese-orthography-resolver-bundle-artifact',
    bundleSemantics: 'phase3-first-slice-v1',
    bundleContentId: sha256(bundleIdentity),
    capabilities: CAPABILITIES,
    sections,
    lexicalArtifact,
    historicalNativeSlice: structuredClone(inputs.nativeSlice),
    historicalSinoSlice: structuredClone(inputs.sinoSlice),
    contextual,
    safeCharacterSlice: structuredClone(inputs.safeCharacterSlice)
  };
}
