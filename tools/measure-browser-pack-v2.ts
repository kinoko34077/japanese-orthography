import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { BrowserPackBuild } from './browser-pack-compiler.ts';
import { buildAcceptedBrowserPackV2 } from './generate-browser-pack.ts';

// #196 I — BrowserPack v2 physical measurements over the real accepted pack and the real runtime
// path (pack runtime + lexical runtime + resolver adapter + diagnostic contract). Sizes are exact;
// latencies and heap are machine-dependent observations recorded for comparison, never asserted.
//
//   npm run measure:browser-pack-v2   (node --expose-gc) -> data/reports/browser-pack-v2-measurements.json

export const BROWSER_PACK_V2_MEASUREMENTS = 'data/reports/browser-pack-v2-measurements.json';

const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');
const { summarize, expandDetail, expandUnitDetail } = require('../runtime/browser-diagnostic-contract.js');

export const MEASUREMENT_TEXTS = {
  short: '溶接の装丁を円周に描いた台風の日のこと。',
  representative: '今日は学校で分からないことを調べた。｜学校《がっこう》の帰りに円周率を考え、台風の進路を思うと、ドイツの友人に手紙を書きます。味わおう、みる、法律。'
} as const;

const gc = () => (globalThis as { gc?: () => void }).gc?.();
const heap = () => { gc(); return process.memoryUsage().heapUsed; };

export async function measureBrowserPackV2(build: BrowserPackBuild) {
  const sizes = { total: 0, totalGzip: 0, byLoading: {} as Record<string, { sections: number; bytes: number; gzipBytes: number }>, byKind: {} as Record<string, { sections: number; bytes: number; gzipBytes: number }> };
  for (const s of build.manifest.sections) {
    const body = build.files.get(s.path)!;
    const gz = gzipSync(body, { level: 9 }).length;
    sizes.total += body.byteLength; sizes.totalGzip += gz;
    for (const [table, key] of [[sizes.byLoading, s.loading], [sizes.byKind, s.kind]] as const) {
      const row = (table[key] ??= { sections: 0, bytes: 0, gzipBytes: 0 });
      row.sections += 1; row.bytes += body.byteLength; row.gzipBytes += gz;
    }
  }
  const runs: Record<string, unknown> = {};
  for (const [name, text] of Object.entries(MEASUREMENT_TEXTS)) {
    const log: Array<{ id: string; bytes: number; gzip: number }> = [];
    const before = heap();
    const t0 = performance.now();
    const pack = await openBrowserPack(build.manifest, async (s: { sectionId: string; path: string }) => {
      const body = build.files.get(s.path)!;
      log.push({ id: s.sectionId, bytes: body.byteLength, gzip: gzipSync(body, { level: 6 }).length });
      return body;
    });
    const tOpen = performance.now();
    const eager = log.length;
    const lexical = createBrowserLexicalRuntime(pack);
    const raw = await transformWithResolver(pack, lexical, text, 'historical', { renderMode: 'plain' });
    const tFirst = performance.now();
    const summary = summarize(raw);
    const cold = log.slice(eager);
    const t2 = performance.now();
    await transformWithResolver(pack, lexical, text, 'historical', { renderMode: 'plain' });
    const tWarm = performance.now();
    const warmRequests = log.length - eager - cold.length;
    const span = raw.spans[0];
    const t3 = performance.now();
    if (span) await expandDetail(pack, raw, '0');
    const tDetail = performance.now();
    const unit = summary.units[0];
    const t4 = performance.now();
    if (unit) await expandUnitDetail(pack, lexical, raw, unit.detailRef);
    const tUnit = performance.now();
    const after = heap();
    runs[name] = {
      textLength: text.length,
      renderedText: raw.renderedText,
      eager: { requests: eager, bytes: log.slice(0, eager).reduce((n, r) => n + r.bytes, 0), gzipBytes: log.slice(0, eager).reduce((n, r) => n + r.gzip, 0), openMs: Math.round(tOpen - t0) },
      coldFirstResult: { requests: cold.length, bytes: cold.reduce((n, r) => n + r.bytes, 0), gzipBytes: cold.reduce((n, r) => n + r.gzip, 0), ms: Math.round(tFirst - tOpen) },
      warmRepeat: { requests: warmRequests, ms: Math.round(tWarm - t2) },
      detailLatencyMs: span ? Math.round(tDetail - t3) : null,
      unitDetailLatencyMs: unit ? Math.round(tUnit - t4) : null,
      residentArrayBufferBytes: log.reduce((n, r) => n + r.bytes, 0),
      jsHeapDeltaBytes: after - before,
      spans: summary.spans.length,
      inspectableUnits: summary.units.length
    };
  }
  return {
    schemaVersion: '1',
    kind: 'browser-pack-v2-measurements',
    owner: 'japanese-orthography#196 I',
    packDigest: build.manifest.packDigest,
    sections: build.manifest.sections.length,
    sizes,
    runs,
    note: 'sizes exact; ms and heap are local observations (machine-dependent), recorded for comparison only'
  };
}

if (process.argv[1]?.endsWith('measure-browser-pack-v2.ts')) {
  const root = resolve(process.cwd());
  const report = await measureBrowserPackV2(await buildAcceptedBrowserPackV2(root));
  let previous: unknown = null;
  try { previous = JSON.parse(await readFile(resolve(root, BROWSER_PACK_V2_MEASUREMENTS), 'utf8')).baselineBeforeI ?? null; } catch { previous = null; }
  const baselineBeforeI = process.argv.includes('--baseline') ? { packDigest: report.packDigest, sections: report.sections, sizes: { total: report.sizes.total, totalGzip: report.sizes.totalGzip, byLoading: report.sizes.byLoading }, runs: report.runs } : previous;
  await writeFile(resolve(root, BROWSER_PACK_V2_MEASUREMENTS), `${JSON.stringify({ ...report, baselineBeforeI }, null, 2)}\n`);
  console.log(JSON.stringify({ total: report.sizes.total, gzip: report.sizes.totalGzip, runs: report.runs }, null, 1));
}
