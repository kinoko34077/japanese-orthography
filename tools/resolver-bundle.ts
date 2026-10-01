import { createHash } from 'node:crypto';
import { compileWorkspace } from './compiler.ts';
import { createContextualCompilationBindings, type ContextualLexicalBindingSlice } from './contextual-lexical-bindings.ts';
import { compileLexicalSourceSlice, type LexicalArtifact, type UniDicSourceSlice } from './lexical-compiler.ts';
import type { OrthographyV2BundleSection } from './orthography-v2-bundle.ts';

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
  /** ARCH-V2 I (#173): present -> `orthography-v2` semantics (the default build path);
   *  absent -> the retained `phase3-first-slice-v1` compatibility semantics. */
  orthographyV2Section?: OrthographyV2BundleSection;
}

export type ResolverBundleSemantics = 'phase3-first-slice-v1' | 'orthography-v2';

export interface ResolverBundleArtifact {
  schemaVersion: '1';
  kind: 'japanese-orthography-resolver-bundle-artifact';
  bundleSemantics: ResolverBundleSemantics;
  bundleContentId: string;
  capabilities: readonly string[];
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
  orthographyV2?: OrthographyV2BundleSection;
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
  const v2 = inputs.orthographyV2Section;
  if (v2 && (v2.schemaVersion !== '1' || v2.kind !== 'orthography-v2-bundle-section')) throw new Error('Resolver bundle orthography-v2 section is malformed');
  const semantics: ResolverBundleSemantics = v2 ? 'orthography-v2' : 'phase3-first-slice-v1';
  const capabilities = v2 ? [...CAPABILITIES, 'orthography-v2'] : [...CAPABILITIES];
  const sections = [
    { id: 'lexical', contentId: lexicalArtifact.artifactContentId },
    { id: 'historical-native', contentId: sha256(inputs.nativeSlice) },
    { id: 'historical-sino', contentId: sha256(inputs.sinoSlice) },
    { id: 'contextual-kanji', contentId: sha256(contextual) },
    { id: 'safe-character', contentId: sha256(inputs.safeCharacterSlice) },
    ...(v2 ? [{ id: 'orthography-v2', contentId: sha256(v2) }] : [])
  ];
  const bundleIdentity = {
    bundleSemantics: semantics,
    lexicalNamespaceId,
    capabilities,
    sections
  };

  return {
    schemaVersion: '1',
    kind: 'japanese-orthography-resolver-bundle-artifact',
    bundleSemantics: semantics,
    bundleContentId: sha256(bundleIdentity),
    capabilities,
    sections,
    lexicalArtifact,
    historicalNativeSlice: structuredClone(inputs.nativeSlice),
    historicalSinoSlice: structuredClone(inputs.sinoSlice),
    contextual,
    safeCharacterSlice: structuredClone(inputs.safeCharacterSlice),
    ...(v2 ? { orthographyV2: structuredClone(v2) } : {})
  };
}

/** Default build path: the accepted slices plus the committed orthography-v2 section. */
export async function buildDefaultResolverBundleArtifact(rootDir: string): Promise<ResolverBundleArtifact> {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const json = async (path: string) => JSON.parse(await readFile(resolve(rootDir, path), 'utf8'));
  return buildResolverBundleArtifact({
    lexicalSource: await json('data/lexical/sources/unidic-cwj-202512-first-slice.json'),
    nativeSlice: await json('data/historical/native/phase46d-native-kana.json'),
    sinoSlice: await json('data/historical/sino/phase46e-sino-kana.json'),
    contextualBindingSlice: await json('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
    contextualManifest: await json('data/packs/contextual-kanji/manifest.json'),
    contextualTaiPack: await json('data/packs/contextual-kanji/merged-tai.json'),
    safeCharacterSlice: await json('data/deterministic/safe-character-first-slice.json'),
    orthographyV2Section: await json('data/runtime/orthography-v2-bundle-section.json')
  });
}
