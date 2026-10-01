import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import type { Diagnostic } from './model.ts';

const schemaFiles = [
  '../schema/v1/external-relation-ref.schema.json',
  '../schema/v1/evidence-bundle.schema.json',
  '../schema/v1/lexical-constraints.schema.json',
  '../schema/v1/contextual-kanji-pack.schema.json',
  '../schema/v1/orthography-intake-bundle.schema.json',
  '../schema/v1/normalized-orthography-graph.schema.json',
  '../schema/v1/orthography-applicability-ledger.schema.json'
] as const;

function loadSchema(relativePath: string): object {
  const url = new URL(relativePath, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as object;
}

function diagnosticFromAjv(error: ErrorObject): Diagnostic {
  const path = error.instancePath || '/';
  return {
    severity: 'ERROR',
    code: 'E_SCHEMA',
    path,
    message: `${error.keyword}: ${error.message ?? 'schema violation'}`
  };
}
export function createSchemaValidator(): (document: unknown, schemaId: string) => Diagnostic[] {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const schemaFile of schemaFiles) {
    ajv.addSchema(loadSchema(schemaFile));
  }

  return (document: unknown, schemaId: string): Diagnostic[] => {
    const validator = ajv.getSchema(schemaId);
    if (!validator) {
      return [{
        severity: 'ERROR',
        code: 'E_UNKNOWN_SCHEMA',
        path: '/',
        message: `Unknown schema: ${schemaId}`
      }];
    }
    if (validator(document)) return [];
    return (validator.errors ?? []).map(diagnosticFromAjv);
  };
}
