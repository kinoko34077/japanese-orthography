import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateCoverageAccounting } from './intake-accounting.ts';
import { createSchemaValidator } from './schema-validator.ts';
import { buildPhase46fArtifacts, CONSUMER_COMMIT, PHASE46F_SNAPSHOTS } from './kinotch-profile-intake.ts';

export function gitBlobSha(bytes: Buffer): string {
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest('hex');
}

async function main(): Promise<void> {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const generated = await buildPhase46fArtifacts(rootDir);
  const schema = createSchemaValidator()(generated.bundle, 'orthography-intake-bundle-v1');
  if (schema.length > 0) throw new Error(`Phase 4.6F intake schema validation failed: ${schema[0]!.message}`);

  for (const snapshot of PHASE46F_SNAPSHOTS) {
    const bytes = await readFile(resolve(rootDir, `data/sources/txt-auto-replace/${CONSUMER_COMMIT}`, snapshot.path));
    if (gitBlobSha(bytes) !== snapshot.blobSha) throw new Error(`Vendored consumer source drift: ${snapshot.path}`);
    const parse = generated.parses.get(snapshot.sourceId)!;
    const diagnostics = validateCoverageAccounting({
      snapshot, discoveredRecordIds: parse.records.map((record) => record.locator),
      records: generated.bundle.records, remainders: parse.remainders
    });
    if (diagnostics.length > 0) throw new Error(`${diagnostics[0]!.code}: ${diagnostics[0]!.message}`);
    if (parse.remainders.length > 0) throw new Error(`Phase 4.6F parser remainder for ${snapshot.sourceId}`);
  }

  for (const [path, text] of Object.entries(generated.texts)) {
    if (await readFile(resolve(rootDir, path), 'utf8') !== text) throw new Error(`Phase 4.6F artifact is stale: ${path}`);
  }
  console.log(`Phase 4.6F KiNoTch profile intake validation OK: ${generated.bundle.records.length} records`);
}

await main();
