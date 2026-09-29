import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { createSchemaValidator } from './schema-validator.ts';
import type {
  CanonicalWorkspace,
  ContextualKanjiPackDocument,
  EvidenceBundleDocument,
  LexicalConstraintsDocument,
  Located,
  SourceLocation
} from './model.ts';

export class CanonicalLoadError extends Error {
  constructor(public readonly code: string, message: string, public readonly file?: string) {
    super(message);
    this.name = 'CanonicalLoadError';
  }
}

const validateSchema = createSchemaValidator();

function diagnosticLocation(rootDir: string, absolutePath: string): string {
  return relative(rootDir, absolutePath).split(sep).join('/');
}
async function listJsonFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listJsonFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(fullPath);
  }
  return files.sort((a, b) => a.localeCompare(b, 'en'));
}

async function readStrictJson(rootDir: string, absolutePath: string): Promise<unknown> {
  const file = diagnosticLocation(rootDir, absolutePath);
  const bytes = await readFile(absolutePath);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CanonicalLoadError('E_INVALID_UTF8', `Invalid UTF-8 in ${file}`, file);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CanonicalLoadError('E_INVALID_JSON', `Invalid JSON in ${file}`, file);
  }
}

function requireSchema<T>(document: unknown, schemaId: string, file: string): T {
  const diagnostics = validateSchema(document, schemaId);
  if (diagnostics.length > 0) {
    const first = diagnostics[0]!;
    throw new CanonicalLoadError(
      'E_SCHEMA_DOCUMENT',
      `${file}${first.path ?? ''}: ${first.message}`,
      file
    );
  }
  return document as T;
}

function locate<T>(value: T, file: string, pointer: string): Located<T> {
  const location: SourceLocation = { file, pointer };
  return { value, location };
}

function emptyWorkspace(): CanonicalWorkspace {
  return {
    sources: [], evidence: [], lexicalEvidence: [], lexicalConstraintSets: [],
    restorationUnits: [], positiveRelations: [], safetyConstraints: [], reviewHints: [], packMetadata: []
  };
}
export async function loadCanonicalWorkspace(rootDir: string): Promise<CanonicalWorkspace> {
  const workspace = emptyWorkspace();
  const sourceIds = new Set<string>();

  const evidenceFiles = await listJsonFiles(join(rootDir, 'data', 'evidence'));
  for (const absolutePath of evidenceFiles) {
    const file = diagnosticLocation(rootDir, absolutePath);
    const document = requireSchema<EvidenceBundleDocument>(
      await readStrictJson(rootDir, absolutePath), 'evidence-bundle-v1', file
    );
    if (sourceIds.has(document.source.id)) {
      throw new CanonicalLoadError(
        'E_DUPLICATE_DOCUMENT_IDENTITY',
        `Duplicate evidence source document identity: ${document.source.id}`,
        file
      );
    }
    sourceIds.add(document.source.id);
    workspace.sources.push(locate(document.source, file, '/source'));
    document.evidence.forEach((value, index) => {
      workspace.evidence.push(locate(value, file, `/evidence/${index}`));
    });
  }

  const lexicalFiles = await listJsonFiles(join(rootDir, 'data', 'lexical', 'constraints'));
  for (const absolutePath of lexicalFiles) {
    const file = diagnosticLocation(rootDir, absolutePath);
    const document = requireSchema<LexicalConstraintsDocument>(
      await readStrictJson(rootDir, absolutePath), 'lexical-constraints-v1', file
    );
    document.lexicalEvidence.forEach((value, index) => {
      workspace.lexicalEvidence.push(locate(value, file, `/lexicalEvidence/${index}`));
    });
    document.constraintSets.forEach((value, index) => {
      workspace.lexicalConstraintSets.push(locate(value, file, `/constraintSets/${index}`));
    });
  }

  const packFiles = await listJsonFiles(join(rootDir, 'data', 'packs', 'contextual-kanji'));
  const packMetadataIndex = new Map<string, number>();
  for (const absolutePath of packFiles) {
    const file = diagnosticLocation(rootDir, absolutePath);
    const document = requireSchema<ContextualKanjiPackDocument>(
      await readStrictJson(rootDir, absolutePath), 'contextual-kanji-pack-v1', file
    );
    const metadataIndex = packMetadataIndex.get(document.packId);
    if (metadataIndex === undefined) {
      const metadata = document.requiresLexicalNamespaceId === undefined
        ? { packId: document.packId }
        : { packId: document.packId, requiresLexicalNamespaceId: document.requiresLexicalNamespaceId };
      workspace.packMetadata.push(locate(metadata, file, '/'));
      packMetadataIndex.set(document.packId, workspace.packMetadata.length - 1);
    } else if (document.requiresLexicalNamespaceId !== undefined) {
      const existing = workspace.packMetadata[metadataIndex]!.value;
      if (existing.requiresLexicalNamespaceId !== undefined && existing.requiresLexicalNamespaceId !== document.requiresLexicalNamespaceId) {
        throw new CanonicalLoadError('E_PACK_METADATA_CONFLICT', `Conflicting lexical namespace for pack ${document.packId}`, file);
      }
      existing.requiresLexicalNamespaceId = document.requiresLexicalNamespaceId;
    }
    document.restorationUnits.forEach((value, index) => {
      workspace.restorationUnits.push(locate(value, file, `/restorationUnits/${index}`));
    });
    document.positiveRelations.forEach((value, index) => {
      workspace.positiveRelations.push(locate(value, file, `/positiveRelations/${index}`));
    });
    document.safetyConstraints.forEach((value, index) => {
      workspace.safetyConstraints.push(locate(value, file, `/safetyConstraints/${index}`));
    });
    document.reviewHints.forEach((value, index) => {
      workspace.reviewHints.push(locate(value, file, `/reviewHints/${index}`));
    });
  }

  return workspace;
}
