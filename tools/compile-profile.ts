import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileKinotchProfile } from './profile-compiler.ts';
import { writeProfileArtifactAtomically } from './profile-artifact-writer.ts';
import { loadKinotchProfile } from './profile-loader.ts';

export async function compileProfileRoot(rootDir: string, outDir: string): Promise<void> {
  const profile = await loadKinotchProfile(rootDir);
  await writeProfileArtifactAtomically(compileKinotchProfile(profile), outDir);
}

function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain(import.meta.url)) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const outDir = resolve(process.env.ORTHOGRAPHY_PROFILE_OUT_DIR ?? resolve(rootDir, 'dist', 'compat', 'txt-auto-replace'));
  try {
    await compileProfileRoot(rootDir, outDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
