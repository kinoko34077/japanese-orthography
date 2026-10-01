import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { JMDICT_EXTRACT_FILE, JMDICT_INTAKE_DIR, loadJmdictIntake } from './jmdict-intake.ts';
import { compileJmdictLexicalGraph } from './jmdict-lexical-graph.ts';
import { MEASUREMENTS_PATH, buildLexicalGraphMeasurements } from './lexical-graph-measurements.ts';
import { projectSinoDag } from './sino-dag-projection.ts';

// npm run measure:lexical-graph — recompiles the pinned JMdict lexicon and the 4.6E DAG projection
// and records real byte measurements plus the canonical graph hash (determinism anchor).
async function main(): Promise<void> {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const { extract, accounting } = await loadJmdictIntake(rootDir);
  const gz = await readFile(resolve(rootDir, JMDICT_INTAKE_DIR, JMDICT_EXTRACT_FILE));
  const started = performance.now();
  const graph = compileJmdictLexicalGraph(extract, accounting);
  const compileMs = Math.round(performance.now() - started);
  const sinoSource = JSON.parse(await readFile(resolve(rootDir, 'data/historical/sino/phase46e-sino-kana.json'), 'utf8')).componentRelations;
  const report = {
    schemaVersion: '1',
    kind: 'phase48c-lexical-graph-measurements',
    owner: 'japanese-orthography#135',
    note: 'Byte sizes are UTF-8 JSON (and gzip -9) of real compiled data. compileMsObserved is informational and machine-dependent.',
    ...buildLexicalGraphMeasurements({
      jmdict: { graph, rawExtractText: gunzipSync(gz).toString('utf8'), rawExtractGzipBytes: gz.length },
      sino: projectSinoDag(sinoSource, 'phase46e-sino-table'),
      sinoSource
    }),
    compileMsObserved: compileMs
  };
  await writeFile(resolve(rootDir, MEASUREMENTS_PATH), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

await main();
