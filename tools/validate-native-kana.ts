import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildPhase46dNativeKanaDocuments,
  buildPhase46dNativeKanaMaterialization,
  serializeGeneratedJson
} from './generate-native-kana.ts';
import { validateCoverageAccounting } from './intake-accounting.ts';
import { createSchemaValidator } from './schema-validator.ts';

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(Buffer.from('blob ' + bytes.byteLength + '\0', 'utf8'))
    .update(bytes)
    .digest('hex');
}

async function sourceBytes(rootDir: string, sourceId: string, path: string): Promise<Uint8Array> {
  if (sourceId === 'phase46d-kkh-kana-jisyo') {
    return readFile(join(
      rootDir,
      'data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/kana-jisyo'
    ));
  }
  return readFile(join(rootDir, path));
}

async function requireGeneratedFile(rootDir: string, path: string, expected: unknown): Promise<void> {
  const actual = await readFile(join(rootDir, path), 'utf8');
  const canonical = serializeGeneratedJson(expected);
  if (actual !== canonical) throw new Error('Generated Phase 4.6D artifact drift: ' + path);
}

async function main(): Promise<void> {
  const rootDir = process.env.ORTHOGRAPHY_ROOT ?? process.cwd();
  const generated = await buildPhase46dNativeKanaDocuments(rootDir);
  const validateSchema = createSchemaValidator();
  const schemaDiagnostics = validateSchema(generated.intake, 'orthography-intake-bundle-v1');
  if (schemaDiagnostics.length > 0) {
    throw new Error('Generated Phase 4.6D intake fails schema: ' + JSON.stringify(schemaDiagnostics));
  }

  for (const source of generated.sources) {
    const diagnostics = validateCoverageAccounting({
      snapshot: source.snapshot,
      discoveredRecordIds: source.parseResult.discoveredRecordIds,
      records: generated.intake.records,
      remainders: source.parseResult.remainders
    });
    if (diagnostics.length > 0) {
      throw new Error('Phase 4.6D coverage failure for ' + source.snapshot.sourceId + ': ' + JSON.stringify(diagnostics));
    }
    if (!source.snapshot.blobSha) throw new Error('Phase 4.6D source lacks blob pin: ' + source.snapshot.sourceId);
    const bytes = await sourceBytes(rootDir, source.snapshot.sourceId, source.snapshot.path);
    const actualBlob = gitBlobSha(bytes);
    if (actualBlob !== source.snapshot.blobSha) {
      throw new Error(
        'Phase 4.6D source blob drift for ' + source.snapshot.sourceId +
        ': expected ' + source.snapshot.blobSha + ', got ' + actualBlob
      );
    }
  }

  const materialization = buildPhase46dNativeKanaMaterialization(generated);
  for (const artifact of materialization) await requireGeneratedFile(rootDir, artifact.path, artifact.value);

  const expectedShardNames = materialization
    .filter(artifact => artifact.path.startsWith('data/intake/phase46d-native-kana/'))
    .map(artifact => artifact.path.split('/').at(-1)!)
    .sort();
  const actualShardNames = (await readdir(join(rootDir, 'data/intake/phase46d-native-kana')))
    .filter(name => name.endsWith('.json'))
    .sort();
  if (JSON.stringify(actualShardNames) !== JSON.stringify(expectedShardNames)) {
    throw new Error('Phase 4.6D intake shard set drift');
  }

  const total = generated.coverageReport.sources.reduce((sum, source) => sum + source.discovered, 0);
  console.log('Phase 4.6D native kana validation OK: ' + generated.sources.length + ' sources, ' + total + ' discovered records');
}

await main();
