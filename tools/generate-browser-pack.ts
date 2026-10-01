import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { compileBrowserPack, type BrowserPackBuild } from './browser-pack-compiler.ts';
import { serializeBrowserPackManifest, validateBrowserPackManifest, verifyBrowserPackSections } from './browser-pack-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE, withProfileRules } from './orthography-policy.ts';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';
import { normalizeCheckoutText } from './verification-text.ts';

// BrowserPack B (#185 B): build the pack from the accepted v2 knowledge.
//   npm run generate:browser-pack            -> data/browser-pack/ (manifest committed, bodies ignored)
//   npm run validate:browser-pack            -> recompiles and requires the committed manifest lock
export const BROWSER_PACK_DIR = 'data/browser-pack';
export const BROWSER_PACK_MANIFEST = `${BROWSER_PACK_DIR}/manifest.json`;
export const BROWSER_PACK_COMPILED_REPORT = 'data/reports/browser-pack-v1-compiled.json';

export async function buildAcceptedBrowserPack(rootDir: string): Promise<BrowserPackBuild> {
  const { graph } = await normalizeAcceptedOrthographySources(rootDir);
  let terminology: unknown;
  try { terminology = JSON.parse(await readFile(resolve(rootDir, 'site/terminology-ja.json'), 'utf8')); } catch { terminology = undefined; }
  return compileBrowserPack(withProfileRules(graph), [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], terminology === undefined ? {} : { terminology });
}

export function compiledReport(build: BrowserPackBuild) {
  const byLoading: Record<string, { sections: number; bytes: number; gzipBytes: number }> = {};
  const byKind: Record<string, { sections: number; bytes: number; gzipBytes: number }> = {};
  for (const section of build.manifest.sections) {
    const body = build.files.get(section.path)!;
    const gz = gzipSync(body, { level: 9 }).length;
    for (const [table, key] of [[byLoading, section.loading], [byKind, section.kind]] as const) {
      const row = (table[key] ??= { sections: 0, bytes: 0, gzipBytes: 0 });
      row.sections += 1; row.bytes += body.byteLength; row.gzipBytes += gz;
    }
  }
  const shards = build.manifest.sections.filter((s) => s.kind === 'facts');
  return {
    schemaVersion: '1',
    kind: 'browser-pack-v1-compiled',
    owner: 'japanese-orthography#185 B',
    packDigest: build.manifest.packDigest,
    canonicalGraphSha256: build.manifest.canonicalGraphSha256,
    totals: Object.values(byLoading).reduce((t, r) => ({ sections: t.sections + r.sections, bytes: t.bytes + r.bytes, gzipBytes: t.gzipBytes + r.gzipBytes }), { sections: 0, bytes: 0, gzipBytes: 0 }),
    byLoading: Object.fromEntries(Object.entries(byLoading).sort()),
    byKind: Object.fromEntries(Object.entries(byKind).sort()),
    shards: { count: shards.length, largestFactsBytes: Math.max(...shards.map((s) => s.byteLength)) },
    baseline: { aReport: 'data/reports/browser-pack-v1-measurements.json', v2HotArtifactModernBytes: 60965586 }
  };
}

if (process.argv[1]?.endsWith('generate-browser-pack.ts')) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const build = await buildAcceptedBrowserPack(rootDir);
  const manifestText = serializeBrowserPackManifest(build.manifest);
  validateBrowserPackManifest(JSON.parse(manifestText));
  verifyBrowserPackSections(build.manifest, new Map(build.manifest.sections.map((s) => [s.sectionId, build.files.get(s.path)!])));
  const reportText = `${JSON.stringify(compiledReport(build), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (normalizeCheckoutText(await readFile(resolve(rootDir, BROWSER_PACK_MANIFEST), 'utf8')) !== manifestText) throw new Error(`stale ${BROWSER_PACK_MANIFEST}; run npm run generate:browser-pack`);
    if (normalizeCheckoutText(await readFile(resolve(rootDir, BROWSER_PACK_COMPILED_REPORT), 'utf8')) !== reportText) throw new Error(`stale ${BROWSER_PACK_COMPILED_REPORT}`);
    console.log(`BrowserPack manifest OK: ${build.manifest.sections.length} sections, pack ${build.manifest.packDigest}`);
  } else {
    const dir = resolve(rootDir, process.env.BROWSER_PACK_OUT ?? BROWSER_PACK_DIR);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    for (const [path, body] of build.files) await writeFile(resolve(dir, path), body);
    await writeFile(resolve(dir, 'manifest.json'), manifestText);
    if (!process.env.BROWSER_PACK_OUT) await writeFile(resolve(rootDir, BROWSER_PACK_COMPILED_REPORT), reportText);
    console.log(reportText);
  }
}
