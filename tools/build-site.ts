import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serializeBrowserPackManifest } from './browser-pack-model.ts';
import { buildAcceptedBrowserPack, buildAcceptedBrowserPackV2, buildAcceptedBrowserPackV3 } from './generate-browser-pack.ts';

// #185 G/I: assemble the static GitHub Pages site.
//   dist-site/                 site/* (HTML, CSS, UI scripts, terminology)
//   dist-site/runtime/         browser runtime modules + transform worker
//   dist-site/browser-pack/    manifest + generated BrowserPack sections
export const SITE_OUT = 'dist-site';
export const SITE_RUNTIME_MODULES = [
  'browser-pack-binary.js',
  'browser-pack-runtime.js',
  'occurrence-arbitration.js',
  'browser-span-planner.js',
  'browser-diagnostic-contract.js',
  'browser-section-fetcher.js',
  'transform-shared.js',
  'orthography-resolver.js',
  'browser-lexical-runtime.js',
  'browser-inflection.js',
  'historical-sino-runtime.js',
  'browser-resolver-adapter.js',
  'symbol-registry-runtime.js',
  'sequence-pool-runtime.js',
  'rule-program-vm.js',
  'browser-program-runtime.js',
  'browser-transform-worker.js'
];

/** #211 J: the site ships BrowserPack v3 (symbol-encoded hot pack, lazy cold evidence); `--v2` / `--v1` keep the earlier builds available. */
export async function buildSite(rootDir: string, outDir = resolve(rootDir, SITE_OUT), pack: 'v1' | 'v2' | 'v3' = 'v3'): Promise<{ outDir: string; packDigest: string; files: number }> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(resolve(outDir, 'runtime'), { recursive: true });
  await mkdir(resolve(outDir, 'browser-pack'), { recursive: true });
  let files = 0;
  for (const name of await readdir(resolve(rootDir, 'site'))) {
    await copyFile(resolve(rootDir, 'site', name), resolve(outDir, name));
    files += 1;
  }
  for (const name of SITE_RUNTIME_MODULES) {
    await copyFile(resolve(rootDir, 'runtime', name), resolve(outDir, 'runtime', name));
    files += 1;
  }
  const build = pack === 'v3' ? await buildAcceptedBrowserPackV3(rootDir) : pack === 'v2' ? await buildAcceptedBrowserPackV2(rootDir) : await buildAcceptedBrowserPack(rootDir);
  for (const [path, body] of build.files) {
    await writeFile(resolve(outDir, 'browser-pack', path), body);
    files += 1;
  }
  await writeFile(resolve(outDir, 'browser-pack', 'manifest.json'), serializeBrowserPackManifest(build.manifest));
  // GitHub Pages must serve the files as-is (no Jekyll processing of names/paths)
  await writeFile(resolve(outDir, '.nojekyll'), '');
  return { outDir, packDigest: build.manifest.packDigest, files: files + 2 };
}

if (process.argv[1]?.endsWith('build-site.ts')) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const result = await buildSite(rootDir, resolve(rootDir, SITE_OUT), process.argv.includes('--v1') ? 'v1' : process.argv.includes('--v2') ? 'v2' : 'v3');
  console.log(`site built in ${result.outDir}: ${result.files} files, pack ${result.packDigest}`);
}
