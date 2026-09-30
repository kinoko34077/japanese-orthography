import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCanonicalWorkspace } from './load-workspace.ts';
import { loadIntakeWorkspace } from './load-intake.ts';
import { validatePhase46AuthorityClosure } from './phase46-authority-closure.ts';
import { validatePackLocal } from './semantic-validator.ts';
import {
  validateIntegration,
  type ExternalPackIndex,
  type LexicalNamespaceDescriptor
} from './integration-validator.ts';
import type { CanonicalWorkspace, Diagnostic } from './model.ts';
import type { CompilationBindings } from './compiler.ts';

interface FirstSliceIntegrationFixture {
  schemaVersion: '1';
  kind: 'integration_fixture';
  lexicalNamespace: {
    id: string;
    compatibleSourceNamespaces: string[];
    bindings: Record<string, string[]>;
  };
  externalPacks: Array<{
    packId: string;
    exportedRelationIds: string[];
  }>;
}

const repositoryRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));

export function loadFirstSliceIntegrationFixture(): FirstSliceIntegrationFixture {
  const fixturePath = resolve(
    process.env.ORTHOGRAPHY_INTEGRATION_FIXTURE ??
      resolve(repositoryRoot, 'test', 'fixtures', 'integration', 'first-slice.json')
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Partial<FirstSliceIntegrationFixture>;
  if (
    fixture.schemaVersion !== '1' ||
    fixture.kind !== 'integration_fixture' ||
    !fixture.lexicalNamespace ||
    typeof fixture.lexicalNamespace.id !== 'string' ||
    !Array.isArray(fixture.lexicalNamespace.compatibleSourceNamespaces) ||
    !fixture.lexicalNamespace.bindings ||
    !Array.isArray(fixture.externalPacks)
  ) {
    throw new Error(`Invalid first-slice integration fixture: ${fixturePath}`);
  }
  return fixture as FirstSliceIntegrationFixture;
}

function lexicalNamespaceDescriptor(fixture: FirstSliceIntegrationFixture): LexicalNamespaceDescriptor {
  return {
    id: fixture.lexicalNamespace.id,
    compatibleSourceNamespaces: new Set(fixture.lexicalNamespace.compatibleSourceNamespaces)
  };
}

function externalPackIndexes(fixture: FirstSliceIntegrationFixture): readonly ExternalPackIndex[] {
  return fixture.externalPacks.map((pack) => ({
    packId: pack.packId,
    exportedRelationIds: new Set(pack.exportedRelationIds)
  }));
}

export function createFirstSliceCompilationBindings(
  fixture: FirstSliceIntegrationFixture
): CompilationBindings {
  return {
    lexicalNamespaceId: fixture.lexicalNamespace.id,
    lexicalBindings: new Map(
      Object.entries(fixture.lexicalNamespace.bindings).map(([constraintId, ids]) => [
        constraintId,
        [...new Set(ids)].sort((a, b) => a.localeCompare(b, 'en'))
      ])
    )
  };
}

export async function validateRoot(rootDir: string): Promise<{
  workspace: CanonicalWorkspace;
  diagnostics: Diagnostic[];
  integrationFixture: FirstSliceIntegrationFixture;
}> {
  const [workspace, intake] = await Promise.all([
    loadCanonicalWorkspace(rootDir),
    loadIntakeWorkspace(rootDir)
  ]);
  const integrationFixture = loadFirstSliceIntegrationFixture();
  const diagnostics = [
    ...validatePackLocal(workspace),
    ...validateIntegration(
      workspace,
      externalPackIndexes(integrationFixture),
      lexicalNamespaceDescriptor(integrationFixture)
    ),
    ...validatePhase46AuthorityClosure(workspace, intake)
  ];
  return { workspace, diagnostics, integrationFixture };
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
