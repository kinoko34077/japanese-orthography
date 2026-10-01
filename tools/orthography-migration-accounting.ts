import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizeSourceDispositions } from './orthography-knowledge-model.ts';
import { assertNoSilentSourceDrop, normalizeAcceptedOrthographySources, type NormalizationResult } from './orthography-source-normalization.ts';

// ARCH-V2 B (#166) source-accounting report: deterministic, generated from the accepted sources.
export const SOURCE_ACCOUNTING_REPORT = 'data/reports/orthography-v2-source-accounting.json';

export function buildSourceAccountingReport(result: NormalizationResult) {
  return {
    schemaVersion: '1',
    kind: 'orthography-v2-source-accounting',
    owner: 'japanese-orthography#166',
    note: 'Every record enumerated by a source adapter has exactly one disposition. Source files are provenance roots and are not modified.',
    totals: {
      inputRecords: result.accounting.inputRecords,
      disposedRecords: result.accounting.disposedRecords,
      unaccounted: result.accounting.unaccounted.length,
      byDisposition: summarizeSourceDispositions(result.graph)
    },
    graph: {
      sources: result.graph.sources.length,
      facts: result.graph.facts.length,
      rules: result.graph.rules.length,
      bindings: result.graph.bindings.length,
      sha256: createHash('sha256').update(JSON.stringify(result.graph)).digest('hex')
    },
    bySource: result.accounting.bySource
  };
}

if (process.argv[1]?.endsWith('orthography-migration-accounting.ts')) {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const result = await normalizeAcceptedOrthographySources(rootDir);
  assertNoSilentSourceDrop(result);
  const text = `${JSON.stringify(buildSourceAccountingReport(result), null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const { readFile } = await import('node:fs/promises');
    const { normalizeCheckoutText } = await import('./verification-text.ts');
    if (normalizeCheckoutText(await readFile(resolve(rootDir, SOURCE_ACCOUNTING_REPORT), 'utf8')) !== text) throw new Error(`stale ${SOURCE_ACCOUNTING_REPORT}`);
    if (result.accounting.unaccounted.length) throw new Error('unaccounted source records');
    console.log(`orthography-v2 source accounting OK: ${result.accounting.disposedRecords} records, 0 unaccounted`);
  } else {
    await writeFile(resolve(rootDir, SOURCE_ACCOUNTING_REPORT), text);
    console.log(text);
  }
}
