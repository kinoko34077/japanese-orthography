import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadKinotchProfile } from './profile-loader.ts';

export async function validateProfileRoot(rootDir: string): Promise<void> {
  await loadKinotchProfile(rootDir);
}

function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain(import.meta.url)) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  try {
    await validateProfileRoot(rootDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
