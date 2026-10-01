import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { loadJmdictIntake } from './jmdict-intake.ts';
import { compileJmdictLexicalGraph } from './jmdict-lexical-graph.ts';
import { projectSinoDag } from './sino-dag-projection.ts';
import { buildPhase48RuntimeBundle, createPhase48HotRuntime } from './phase48-hot-runtime.ts';

const REPORT = 'data/reports/phase48g-gpt-hot-runtime.json';
const SINO = 'data/historical/sino/phase46e-sino-kana.json';

const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const gzipBytes = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value), 'utf8')).byteLength;
const rounded = (value: number) => Math.round(value * 1000) / 1000;

async function main() {
  const { extract, accounting } = await loadJmdictIntake(process.cwd());
  const sinoArtifact = JSON.parse(await readFile(SINO, 'utf8'));

  const lexicalStart = performance.now();
  const lexical = compileJmdictLexicalGraph(extract, accounting);
  const lexicalCompileMs = performance.now() - lexicalStart;

  const sino = projectSinoDag(sinoArtifact.componentRelations, 'phase46e-sino-table');
  const hotStart = performance.now();
  const bundle = buildPhase48RuntimeBundle(lexical, sino);
  const hotCompileMs = performance.now() - hotStart;

  const runtimeStart = performance.now();
  const runtime = createPhase48HotRuntime(bundle.hot);
  const runtimeInitMs = performance.now() - runtimeStart;

  const lexicalQueries = [
    ['装丁', 'そうてい'],
    ['想定', 'そうてい'],
    ['学校', 'がっこう'],
    ['文法', 'ぶんぽう'],
    ['法', 'ほう']
  ] as const;
  const lookupIterations = 10_000;
  let lexicalResults = 0;
  const lookupStart = performance.now();
  for (let i = 0; i < lookupIterations; i += 1) {
    const [form, reading] = lexicalQueries[i % lexicalQueries.length]!;
    lexicalResults += runtime.lexemesForFormReading(form, reading).length;
  }
  const lookupMs = performance.now() - lookupStart;

  const readingQueries = [
    ['装丁', 'そうてい', {}],
    ['文法', 'ぶんぽう', {}],
    ['法', 'ほう', {}],
    ['法', 'ほう', { context: '仏教用語' }]
  ] as const;
  const readingIterations = 10_000;
  let readingResults = 0;
  const readingStart = performance.now();
  for (let i = 0; i < readingIterations; i += 1) {
    const [surface, reading, query] = readingQueries[i % readingQueries.length]!;
    if (runtime.reconstructWord(surface, reading, query) !== null) readingResults += 1;
  }
  const readingMs = performance.now() - readingStart;

  const report = {
    schemaVersion: '1',
    kind: 'phase48g-gpt-hot-runtime-measurements',
    source: {
      jmdictCreatedDate: accounting.createdDate,
      jmdictEntries: extract.length,
      sinoComponentRelations: sinoArtifact.componentRelations.length
    },
    entities: {
      lexemes: lexical.lexemes.length,
      forms: lexical.forms.length,
      readingAtoms: lexical.readingAtoms.length,
      readingPaths: lexical.readingPaths.length,
      sinoPatterns: sino.convergencePatterns.length,
      sinoBindings: sino.bindings.length
    },
    sizes: {
      canonicalLexicalGraph: { bytes: bytes(lexical), gzipBytes: gzipBytes(lexical) },
      canonicalSinoDag: { bytes: bytes(sino), gzipBytes: gzipBytes(sino) },
      hot: { bytes: bytes(bundle.hot), gzipBytes: gzipBytes(bundle.hot) },
      cold: { bytes: bytes(bundle.cold), gzipBytes: gzipBytes(bundle.cold) },
      fullBundle: { bytes: bytes(bundle), gzipBytes: gzipBytes(bundle) }
    },
    timingsMs: {
      compileLexicalGraph: rounded(lexicalCompileMs),
      compileHotBundle: rounded(hotCompileMs),
      initHotRuntime: rounded(runtimeInitMs),
      lexicalLookups10k: rounded(lookupMs),
      historicalReadingReconstruction10k: rounded(readingMs)
    },
    benchmarkChecks: { lexicalResults, readingResults }
  };
  await writeFile(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

await main();
