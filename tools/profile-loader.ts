import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { KinotchProfileManifest, KinotchProfilePack, LoadedKinotchProfile } from './profile-model.ts';
import { validateProfileDocuments } from './profile-validator.ts';

async function readStrictJson(path: string): Promise<unknown> {
  const bytes = await readFile(path);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(text) as unknown;
}

export async function loadKinotchProfile(rootDir: string): Promise<LoadedKinotchProfile> {
  const profileDir = resolve(rootDir, 'data', 'profiles', 'kinotch');
  const manifest = await readStrictJson(resolve(profileDir, 'manifest.json')) as KinotchProfileManifest;
  const packs = await Promise.all(
    manifest.packs.map(async (entry) => readStrictJson(resolve(profileDir, entry.file)) as Promise<KinotchProfilePack>)
  );
  const diagnostics = validateProfileDocuments(manifest, packs);
  if (diagnostics.length > 0) {
    const summary = diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n');
    throw new Error(`Invalid KiNoTch. profile:\n${summary}`);
  }
  return { manifest, packs };
}
