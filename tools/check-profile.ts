import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileKinotchProfile, type CompiledProfileArtifact, type ProfileArtifactFileName } from './profile-compiler.ts';
import { loadKinotchProfile } from './profile-loader.ts';
import { normalizeCheckoutText } from './verification-text.ts';

const fileNames: readonly ProfileArtifactFileName[] = [
  'manifest.json',
  '40-legacy-kanji.json5',
  '50-official-homophone-restoration.json5',
  '55-homophone-kanji.json5'
];

async function readGolden(dir: string): Promise<CompiledProfileArtifact> {
  return Object.fromEntries(
    await Promise.all(fileNames.map(async (name) => [
      name,
      normalizeCheckoutText(await readFile(resolve(dir, name), 'utf8'))
    ] as const))
  ) as CompiledProfileArtifact;
}

function assertEqual(first: CompiledProfileArtifact, second: CompiledProfileArtifact, label: string): void {
  for (const name of fileNames) {
    if (first[name] !== second[name]) throw new Error(`${label}: ${name} differs`);
  }
}

export async function checkProfileRoot(rootDir: string, goldenDir: string): Promise<void> {
  const profile = await loadKinotchProfile(rootDir);
  const first = compileKinotchProfile(profile);
  const second = compileKinotchProfile(profile);
  assertEqual(first, second, 'Deterministic profile compile failed');
  assertEqual(first, await readGolden(goldenDir), 'Profile golden artifact mismatch');
}

function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain(import.meta.url)) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const goldenDir = resolve(process.env.ORTHOGRAPHY_PROFILE_GOLDEN_DIR ?? resolve(rootDir, 'test', 'golden', 'kinotch-profile'));
  try {
    await checkProfileRoot(rootDir, goldenDir);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
