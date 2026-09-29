import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCanonicalWorkspace } from './load-workspace.ts';
import { validatePackLocal } from './semantic-validator.ts';
import {
  validateIntegration,
  type ExternalPackIndex,
  type LexicalNamespaceDescriptor
} from './integration-validator.ts';
import type { CanonicalWorkspace, Diagnostic } from './model.ts';
import type { CompilationBindings } from './compiler.ts';

export const FIRST_SLICE_EXTERNAL_PACKS: readonly ExternalPackIndex[] = [{
  packId: 'safe-kanji',
  exportedRelationIds: new Set(['char-tai-to-dai'])
}];

export const FIRST_SLICE_LEXICAL_NAMESPACE: LexicalNamespaceDescriptor = {
  id: 'pmin-current',
  compatibleSourceNamespaces: new Set(['kkh-kanji-jisyo', 'kanjipedia', 'kotobank'])
};

export function createFirstSliceCompilationBindings(workspace: CanonicalWorkspace): CompilationBindings {
  const lexicalById = new Map(workspace.lexicalEvidence.map((record) => [record.value.id, record.value]));
  const lexicalBindings = new Map<string, readonly string[]>();
  for (const constraint of workspace.lexicalConstraintSets) {
    const ids = constraint.value.lexicalEvidenceRefs.flatMap((ref) => {
      const lexical = lexicalById.get(ref);
      return lexical ? [`${lexical.sourceRef}:${lexical.sourceIdentity}`] : [];
    });
    if (ids.length > 0) lexicalBindings.set(constraint.value.id, [...new Set(ids)].sort());
  }
  return { lexicalNamespaceId: FIRST_SLICE_LEXICAL_NAMESPACE.id, lexicalBindings };
}

export async function validateRoot(rootDir: string): Promise<{
  workspace: CanonicalWorkspace;
  diagnostics: Diagnostic[];
}> {
  const workspace = await loadCanonicalWorkspace(rootDir);
  const diagnostics = [
    ...validatePackLocal(workspace),
    ...validateIntegration(
      workspace,
      FIRST_SLICE_EXTERNAL_PACKS,
      FIRST_SLICE_LEXICAL_NAMESPACE
    )
  ];
  return { workspace, diagnostics };
}

export function printDiagnostics(diagnostics: readonly Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const path = diagnostic.path ? ` ${diagnostic.path}` : '';
    console.log(`${diagnostic.severity} ${diagnostic.code}${path}: ${diagnostic.message}`);
  }
}

function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain(import.meta.url)) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  try {
    const { diagnostics } = await validateRoot(rootDir);
    printDiagnostics(diagnostics);
    process.exitCode = diagnostics.some((diagnostic) => diagnostic.severity === 'ERROR') ? 1 : 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
