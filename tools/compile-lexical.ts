import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileLexicalSourceSlice, serializeLexicalArtifact, type UniDicSourceSlice } from './lexical-compiler.ts';

export async function compileLexicalFile(sourcePath: string, outPath: string): Promise<void> {
  const source = JSON.parse(await readFile(sourcePath, 'utf8')) as UniDicSourceSlice;
  const artifact = compileLexicalSourceSlice(source);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, serializeLexicalArtifact(artifact), 'utf8');
}

function isMain(metaUrl: string): boolean {
  return process.argv[1] !== undefined && metaUrl === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain(import.meta.url)) {
  const sourcePath = process.argv[2];
  const outPath = process.argv[3];
  if (!sourcePath || !outPath) {
    console.error('usage: compile-lexical <source-slice.json> <artifact.json>');
    process.exitCode = 2;
  } else {
    try {
      await compileLexicalFile(resolve(sourcePath), resolve(outPath));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
