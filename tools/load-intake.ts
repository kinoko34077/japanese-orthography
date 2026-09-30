import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { createSchemaValidator } from './schema-validator.ts';
import type { IntakeBundleDocument, IntakeRecord, SourceSnapshot } from './intake-model.ts';
import type { Located, SourceLocation } from './model.ts';

export interface IntakeWorkspace {
  snapshots: Located<SourceSnapshot>[];
  records: Located<IntakeRecord>[];
}

export class IntakeLoadError extends Error {
  constructor(public readonly code: string, message: string, public readonly file?: string) {
    super(message);
    this.name = 'IntakeLoadError';
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
    throw new IntakeLoadError('E_INTAKE_INVALID_UTF8', `Invalid UTF-8 in ${file}`, file);
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new IntakeLoadError('E_INTAKE_INVALID_JSON', `Invalid JSON in ${file}`, file);
  }
}

function requireSchema<T>(document: unknown, file: string): T {
  const diagnostics = validateSchema(document, 'orthography-intake-bundle-v1');
  if (diagnostics.length > 0) {
    const first = diagnostics[0]!;
    throw new IntakeLoadError(
      'E_INTAKE_SCHEMA_DOCUMENT',
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

export async function loadIntakeWorkspace(rootDir: string): Promise<IntakeWorkspace> {
  const workspace: IntakeWorkspace = { snapshots: [], records: [] };
  const sourceIds = new Set<string>();
  const recordIds = new Set<string>();

  const files = await listJsonFiles(join(rootDir, 'data', 'intake'));
  for (const absolutePath of files) {
    const file = diagnosticLocation(rootDir, absolutePath);
    const document = requireSchema<IntakeBundleDocument>(
      await readStrictJson(rootDir, absolutePath),
      file
    );

    document.snapshots.forEach((snapshot, index) => {
      if (sourceIds.has(snapshot.sourceId)) {
        throw new IntakeLoadError(
          'E_DUPLICATE_INTAKE_SOURCE',
          `Duplicate intake source identity: ${snapshot.sourceId}`,
          file
        );
      }
      sourceIds.add(snapshot.sourceId);
      workspace.snapshots.push(locate(snapshot, file, `/snapshots/${index}`));
    });

    document.records.forEach((record, index) => {
      if (recordIds.has(record.id)) {
        throw new IntakeLoadError(
          'E_DUPLICATE_INTAKE_RECORD',
          `Duplicate intake record identity: ${record.id}`,
          file
        );
      }
      recordIds.add(record.id);
      workspace.records.push(locate(record, file, `/records/${index}`));
    });
  }

  for (const record of workspace.records) {
    if (!sourceIds.has(record.value.sourceRef)) {
      throw new IntakeLoadError(
        'E_UNKNOWN_INTAKE_SOURCE',
        `Unknown intake source reference: ${record.value.sourceRef}`,
        record.location.file
      );
    }
  }

  return workspace;
}
