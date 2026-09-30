import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileWorkspace } from './compiler.ts';
import type { ArtifactFileName, CompiledArtifact } from './model.ts';
import {
  createFirstSliceCompilationBindings,
  printDiagnostics,
  validateRoot
} from './validate.ts';
import { normalizeCheckoutText } from './verification-text.ts';

const artifactFiles: readonly ArtifactFileName[] = [
  'manifest.json',
  'hot-relations.json',
  'hot-safety.json',
  'cold-review.json',
  'audit-map.json'
];

const repositoryRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));

function assertArtifactsEqual(first: CompiledArtifact, second: CompiledArtifact, label: string): void {
  for (const name of artifactFiles) {
    if (first[name] !== second[name]) {
      throw new Error(`${label}: ${name} differs\nACTUAL:\n${first[name]}\nEXPECTED:\n${second[name]}`);
    }
  }
}

async function readGolden(goldenDir: string): Promise<CompiledArtifact> {
  const entries = await Promise.all(
    artifactFiles.map(async (name) => [
      name,
      normalizeCheckoutText(await readFile(resolve(goldenDir, name), 'utf8'))
    ] as const)
  );
  return Object.fromEntries(entries) as CompiledArtifact;
}

export async function checkRoot(rootDir: string, goldenDir: string): Promise<void> {
  const { workspace, diagnostics, integrationFixture } = await validateRoot(rootDir);
  printDiagnostics(diagnostics);
  if (diagnostics.length > 0) {
    throw new Error('Production check requires zero unresolved ERROR/REVIEW diagnostics');
  }

  const bindings = createFirstSliceCompilationBindings(integrationFixture);
  const first = compileWorkspace(workspace, bindings);
  const second = compileWorkspace(workspace, bindings);
  assertArtifactsEqual(first, second, 'Deterministic double compile failed');

  const golden = await readGolden(goldenDir);
  assertArtifactsEqual(first, golden, 'Golden artifact mismatch');
}

function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain(import.meta.url)) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const goldenDir = resolve(
    process.env.ORTHOGRAPHY_GOLDEN_DIR ?? resolve(repositoryRoot, 'test', 'golden', 'contextual-kanji')
  );
  try {
    await checkRoot(rootDir, goldenDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
