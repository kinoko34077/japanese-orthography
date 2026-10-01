import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { JMDICT_EXTRACT_FILE, JMDICT_INTAKE_DIR, loadJmdictIntake, sha256 } from './jmdict-intake.ts';
import { compileJmdictLexicalGraph } from './jmdict-lexical-graph.ts';
import { buildHotArtifact } from './lexical-hot-artifact.ts';
import { compactEntityGraph, inflateEntityGraph } from './lexical-entity-graph.ts';
import { projectSinoDag } from './sino-dag-projection.ts';

export const COMPACT_RUNTIME_REPORT = 'data/reports/phase48g-compact-runtime-measurements.json';

const size = (text: string) => ({ bytes: Buffer.byteLength(text), gzipBytes: gzipSync(text, { level: 9 }).length, sha256: sha256(text) });

export async function buildCompactRuntimeArtifacts(rootDir: string) {
  const { extract, accounting } = await loadJmdictIntake(rootDir);
  const lexical = compileJmdictLexicalGraph(extract, accounting);
  const sinoArtifactText = await readFile(resolve(rootDir, 'data/historical/sino/phase46e-sino-kana.json'), 'utf8');
  const sinoSource = JSON.parse(sinoArtifactText);
  const sino = projectSinoDag(sinoSource.componentRelations, 'phase46e-sino-table');
  const canonicalText = JSON.stringify(lexical);
  const compact = compactEntityGraph(lexical);
  const hot = buildHotArtifact(lexical, sino, {
    jmdictSnapshot: accounting.createdDate,
    license: 'CC-BY-SA-4.0 (JMdict-derived data; see data/lexical/sources/jmdict/2026-10-01/NOTICE.md)',
    canonicalGraphSha256: sha256(canonicalText),
    sinoSource: 'phase46e-sino-table'
  });
  return { extract, lexical, sino, sinoSource, sinoArtifactText, canonicalText, compact, hot };
}

async function main(): Promise<void> {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const built = await buildCompactRuntimeArtifacts(rootDir);
  const rawGz = await readFile(resolve(rootDir, JMDICT_INTAKE_DIR, JMDICT_EXTRACT_FILE));
  const compactText = JSON.stringify(built.compact);
  const hotText = JSON.stringify(built.hot);
  const dagText = JSON.stringify({ strings: [], patterns: built.hot.patterns, bindings: built.hot.bindings });

  // informational performance observations (machine-dependent)
  const { createLexicalHotRuntime } = createRequire(import.meta.url)('../runtime/lexical-hot-runtime.js');
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  let t = performance.now();
  const runtime = createLexicalHotRuntime(JSON.parse(hotText));
  const startupMs = performance.now() - t;
  const heapDeltaMb = (process.memoryUsage().heapUsed - heapBefore) / 2 ** 20;
  const forms = built.lexical.forms.map((f) => f.text);
  t = performance.now();
  let hits = 0;
  for (let round = 0; round < 3; round += 1) for (const f of forms) hits += runtime.lookupForm(f).length;
  const lookupMs = performance.now() - t;
  const words = built.extract.flatMap((e) => (e.k ?? []).filter((k) => /^\p{Script=Han}{2,4}$/u.test(k.t)).map((k) => [k.t, e.r[0]!.t] as const)).slice(0, 20000);
  t = performance.now();
  for (const [w, r] of words) runtime.reconstructWord(w, r);
  const reconstructMs = performance.now() - t;
  t = performance.now();
  inflateEntityGraph(JSON.parse(compactText));
  const inflateMs = performance.now() - t;

  const report = {
    schemaVersion: '1',
    kind: 'phase48g-compact-runtime-measurements',
    owner: 'japanese-orthography#139',
    note: 'sizes/hashes are deterministic real compiled data; performance values are informational observations from the machine that ran npm run measure:compact-runtime.',
    sizes: {
      rawJmdictExtract: { bytes: gunzipSync(rawGz).length, gzipBytes: rawGz.length },
      canonicalLexicalGraph: size(built.canonicalText),
      compactLexicalGraph: size(compactText),
      hotRuntimeArtifact: size(hotText),
      phase46eArtifact: { bytes: Buffer.byteLength(built.sinoArtifactText) },
      sinoDagHotTables: { bytes: Buffer.byteLength(dagText) }
    },
    counts: { lexemes: built.lexical.lexemes.length, hotStrings: built.hot.strings.length, hotForms: built.hot.forms.text.length, hotReadings: built.hot.readings.text.length, patterns: built.hot.patterns.from.length, bindings: built.hot.bindings.symbol.length },
    performanceObserved: {
      node: process.version,
      hotStartupMs: Math.round(startupMs),
      hotHeapDeltaMb: Math.round(heapDeltaMb),
      formLookupsPerSecond: Math.round((forms.length * 3) / (lookupMs / 1000)),
      formLookupHits: hits,
      reconstructWordsPerSecond: Math.round(words.length / (reconstructMs / 1000)),
      compactInflateMs: Math.round(inflateMs)
    }
  };
  await writeFile(resolve(rootDir, COMPACT_RUNTIME_REPORT), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1]?.endsWith('measure-compact-runtime.ts')) await main();
