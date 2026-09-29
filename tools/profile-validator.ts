import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import type { Diagnostic } from './model.ts';
import type { KinotchProfileManifest, KinotchProfilePack, ProfilePhraseRule } from './profile-model.ts';

const schemaFiles = [
  '../schema/v1/kinotch-profile-manifest.schema.json',
  '../schema/v1/kinotch-profile-pack.schema.json'
] as const;

function loadSchema(relativePath: string): object {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as object;
}

function fromAjv(error: ErrorObject): Diagnostic {
  return {
    severity: 'ERROR',
    code: 'E_SCHEMA',
    path: error.instancePath || '/',
    message: `${error.keyword}: ${error.message ?? 'schema violation'}`
  };
}

export function createProfileSchemaValidator(): (document: unknown, schemaId: string) => Diagnostic[] {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  for (const path of schemaFiles) ajv.addSchema(loadSchema(path));
  return (document, schemaId) => {
    const validator = ajv.getSchema(schemaId);
    if (!validator) return [{ severity: 'ERROR', code: 'E_UNKNOWN_SCHEMA', path: '/', message: `Unknown schema: ${schemaId}` }];
    if (validator(document)) return [];
    return (validator.errors ?? []).map(fromAjv);
  };
}

function duplicateDiagnostics(values: string[], code: string, label: string): Diagnostic[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort().map((value) => ({
    severity: 'ERROR' as const,
    code,
    path: '/',
    message: `Duplicate ${label}: ${value}`
  }));
}

function phraseMatches(rules: ProfilePhraseRule[] | undefined): string[] {
  return (rules ?? []).map((rule) => rule.match);
}

export function validateProfileDocuments(
  manifest: KinotchProfileManifest | unknown,
  packs: Array<KinotchProfilePack | any>
): Diagnostic[] {
  const validateSchema = createProfileSchemaValidator();
  const diagnostics: Diagnostic[] = [
    ...validateSchema(manifest, 'kinotch-profile-manifest-v1'),
    ...packs.flatMap((pack) => validateSchema(pack, 'kinotch-profile-pack-v1'))
  ];

  const typedManifest = manifest as KinotchProfileManifest;
  const typedPacks = packs as KinotchProfilePack[];
  diagnostics.push(...duplicateDiagnostics(typedPacks.map((pack) => pack.packId), 'E_PROFILE_DUPLICATE_PACK', 'pack id'));

  for (const pack of typedPacks) {
    if (pack.profileId !== typedManifest.profileId) {
      diagnostics.push({ severity: 'ERROR', code: 'E_PROFILE_ID_MISMATCH', path: '/', message: `Pack ${pack.packId} profileId does not match manifest` });
    }
    if (pack.groups) {
      diagnostics.push(...duplicateDiagnostics(pack.groups.map((group) => group.id), 'E_PROFILE_DUPLICATE_GROUP', `group id in ${pack.packId}`));
      const matches = pack.groups.flatMap((group) => phraseMatches(group.phraseRules));
      diagnostics.push(...duplicateDiagnostics(matches, 'E_PROFILE_DUPLICATE_RULE', `phrase match in ${pack.packId}`));
    } else {
      diagnostics.push(...duplicateDiagnostics(phraseMatches(pack.phraseRules), 'E_PROFILE_DUPLICATE_RULE', `phrase match in ${pack.packId}`));
    }
  }

  const manifestPackIds = new Set(typedManifest.packs?.map((pack) => pack.id) ?? []);
  for (const pack of typedPacks) {
    if (!manifestPackIds.has(pack.packId)) {
      diagnostics.push({ severity: 'ERROR', code: 'E_PROFILE_UNDECLARED_PACK', path: '/', message: `Pack ${pack.packId} is not declared by manifest` });
    }
  }
  return diagnostics;
}
