import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildCoverageSummary,
  validateCoverageAccounting
} from './intake-accounting.ts';
import { createSchemaValidator } from './schema-validator.ts';
import {
  buildPhase46dNativeArtifacts,
  PHASE46D_COVERAGE_REPORT_PATH,
  PHASE46D_INTAKE_PATH
} from './generate-native-kana.ts';
import { normalizeCheckoutText } from './verification-text.ts';

const validateSchema = createSchemaValidator();

function parseResultForSource(parsed: Awaited<ReturnType<typeof buildPhase46dNativeArtifacts>>['parsed'], sourceId: string) {
  switch (sourceId) {
    case 'phase46d-kkh-kana': return parsed.kkh;
    case 'phase46d-native-dictionary': return parsed.dictionary;
    case 'phase46d-animal-plant': return parsed.animalPlant;
    case 'phase46d-exception-verbs': return parsed.exceptionVerbs;
    case 'phase46d-native-guide': return parsed.guide;
    default: throw new Error(`Unknown Phase 4.6D source: ${sourceId}`);
  }
}

async function main(): Promise<void> {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const generated = await buildPhase46dNativeArtifacts(rootDir);

  const schemaDiagnostics = validateSchema(generated.bundle, 'orthography-intake-bundle-v1');
  if (schemaDiagnostics.length > 0) {
    throw new Error(`Phase 4.6D intake schema validation failed: ${schemaDiagnostics[0]!.message}`);
  }

  for (const snapshot of generated.bundle.snapshots) {
    const parsed = parseResultForSource(generated.parsed, snapshot.sourceId);
    const input = {
      snapshot,
      discoveredRecordIds: parsed.discoveredRecordIds,
      records: generated.bundle.records,
      remainders: parsed.remainders
    };
    const diagnostics = validateCoverageAccounting(input);
    if (diagnostics.length > 0) {
      throw new Error(`${diagnostics[0]!.code}: ${diagnostics[0]!.message}`);
    }
    const summary = buildCoverageSummary(input);
    if (summary.discovered !== summary.admitted + summary.ambiguous + summary.excluded) {
      throw new Error(`Coverage partition mismatch for ${snapshot.sourceId}`);
    }
  }

  const [canonicalIntake, canonicalReport] = await Promise.all([
    readFile(resolve(rootDir, PHASE46D_INTAKE_PATH), 'utf8'),
    readFile(resolve(rootDir, PHASE46D_COVERAGE_REPORT_PATH), 'utf8')
  ]);
  if (normalizeCheckoutText(canonicalIntake) !== generated.intakeText) {
    throw new Error('Phase 4.6D intake artifact is stale');
  }
  if (normalizeCheckoutText(canonicalReport) !== generated.coverageReportText) {
    throw new Error('Phase 4.6D coverage report is stale');
  }

  console.log(`Phase 4.6D native kana validation OK: ${generated.bundle.records.length} records`);
}

await main();
