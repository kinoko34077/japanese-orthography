import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileWorkspace } from './compiler.ts';
import { writeArtifactAtomically } from './artifact-writer.ts';
import {
  createFirstSliceCompilationBindings,
  printDiagnostics,
  validateRoot
} from './validate.ts';

export async function compileRoot(rootDir: string, outDir: string): Promise<void> {
  const { workspace, diagnostics } = await validateRoot(rootDir);
  printDiagnostics(diagnostics);
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'ERROR')) {
    throw new Error('Compilation blocked by validation ERROR diagnostics');
  }
  const artifact = compileWorkspace(workspace, createFirstSliceCompilationBindings(workspace));
  await writeArtifactAtomically(artifact, outDir);
}

function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain(import.meta.url)) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const outDir = resolve(
    process.env.ORTHOGRAPHY_OUT_DIR ?? resolve(rootDir, 'dist', 'contextual-kanji')
  );
  try {
    await compileRoot(rootDir, outDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
