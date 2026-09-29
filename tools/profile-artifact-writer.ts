import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { CompiledProfileArtifact, ProfileArtifactFileName } from './profile-compiler.ts';

const fileNames: readonly ProfileArtifactFileName[] = [
  'manifest.json',
  '40-legacy-kanji.json5',
  '50-official-homophone-restoration.json5',
  '55-homophone-kanji.json5'
];

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function removeIfExists(path: string): Promise<void> {
  if (await exists(path)) await rm(path, { recursive: true, force: true });
}

export async function writeProfileArtifactAtomically(artifact: CompiledProfileArtifact, outDir: string): Promise<void> {
  const parent = dirname(outDir);
  const base = basename(outDir);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(join(parent, `.${base}.staging-`));
  const backup = join(parent, `.${base}.previous-${randomUUID()}`);
  let movedPrevious = false;
  try {
    for (const name of fileNames) await writeFile(join(staging, name), artifact[name], 'utf8');
    if (await exists(outDir)) {
      await rename(outDir, backup);
      movedPrevious = true;
    }
    try { await rename(staging, outDir); }
    catch (error) {
      if (movedPrevious) {
        await removeIfExists(outDir);
        await rename(backup, outDir);
        movedPrevious = false;
      }
      throw error;
    }
    if (movedPrevious) await removeIfExists(backup);
  } catch (error) {
    await removeIfExists(staging);
    if (movedPrevious && !(await exists(outDir)) && await exists(backup)) await rename(backup, outDir);
    throw error;
  }
}
