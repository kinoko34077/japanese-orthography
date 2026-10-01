import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildCoverageSummary, validateCoverageAccounting } from './intake-accounting.ts';
import { createSchemaValidator } from './schema-validator.ts';
import { buildPhase46eSinoArtifacts, PHASE46E_SINO_SOURCE_SNAPSHOT } from './sino-kana.ts';
import { normalizeCheckoutText } from './verification-text.ts';

async function main(): Promise<void> {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const generated = await buildPhase46eSinoArtifacts(rootDir);

  const schemaDiagnostics = createSchemaValidator()(generated.bundle, 'orthography-intake-bundle-v1');
  if (schemaDiagnostics.length > 0) {
    throw new Error(`Phase 4.6E intake schema validation failed: ${schemaDiagnostics[0]!.message}`);
  }

  const input = {
    snapshot: PHASE46E_SINO_SOURCE_SNAPSHOT,
    discoveredRecordIds: generated.parsed.discoveredRecordIds,
    records: generated.bundle.records,
    remainders: generated.parsed.remainders
  };
  const diagnostics = validateCoverageAccounting(input);
  if (diagnostics.length > 0) throw new Error(`${diagnostics[0]!.code}: ${diagnostics[0]!.message}`);
  const summary = buildCoverageSummary(input);
  if (summary.discovered !== summary.admitted + summary.ambiguous + summary.excluded) {
    throw new Error('Phase 4.6E coverage partition mismatch');
  }
  if (summary.unparsedMappingRecords !== 0) throw new Error('Phase 4.6E parser remainder is not empty');

  for (const [relativePath, text] of Object.entries(generated.texts)) {
    if (normalizeCheckoutText(await readFile(resolve(rootDir, relativePath), 'utf8')) !== text) {
      throw new Error(`Phase 4.6E artifact is stale: ${relativePath}`);
    }
  }

  console.log(`Phase 4.6E Sino kana validation OK: ${generated.bundle.records.length} records`);
}

await main();
