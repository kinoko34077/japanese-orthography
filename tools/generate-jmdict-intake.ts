import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import {
  JMDICT_EXTRACT_FILE,
  JMDICT_FIELD_CONTRACT,
  JMDICT_INTAKE_DIR,
  extractJmdictIntake,
  serializeJmdictExtract,
  sha256,
  validateJmdictIntake
} from './jmdict-intake.ts';

// Usage: npm run generate:jmdict-intake -- --source <JMdict.gz> --last-modified <http date> --etag <etag>
// Regenerates the pinned 4.8A extract from an upstream JMdict.gz download. The upstream
// file is published daily without archival, so the extract itself is the reproducible snapshot;
// the recorded upstream hash proves which download it was derived from.

function arg(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`missing --${name}`);
  return value;
}

async function main(): Promise<void> {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const compressed = await readFile(arg('source'));
  const xmlBytes = gunzipSync(compressed);
  const xml = xmlBytes.toString('utf8');
  const { extract, accounting } = extractJmdictIntake(xml);
  const diagnostics = validateJmdictIntake(extract, accounting);
  if (diagnostics.length) throw new Error(diagnostics.join('\n'));
  const dir = resolve(rootDir, JMDICT_INTAKE_DIR);
  if (!dir.endsWith(accounting.createdDate)) throw new Error(`snapshot ${accounting.createdDate} does not match pinned dir ${JMDICT_INTAKE_DIR}`);

  const text = serializeJmdictExtract(extract);
  const gz = gzipSync(text, { level: 9 });
  const manifest = {
    schemaVersion: '1',
    kind: 'jmdict_lexical_intake_snapshot',
    owner: 'japanese-orthography#133',
    historicalAuthority: false,
    source: {
      dictionary: 'JMdict',
      publisher: 'Electronic Dictionary Research and Development Group (EDRDG)',
      url: 'http://ftp.edrdg.org/pub/Nihongo/JMdict.gz',
      projectPage: 'https://www.edrdg.org/wiki/JMdict-EDICT_Dictionary_Project.html',
      createdDate: accounting.createdDate,
      httpLastModified: arg('last-modified'),
      httpEtag: arg('etag'),
      compressedSha256: sha256(compressed),
      compressedBytes: compressed.length,
      xmlSha256: sha256(xmlBytes),
      xmlBytes: xmlBytes.length,
      dtdRevision: /<!-- Rev (\d+\.\d+)/.exec(xml)?.[1] ?? null,
      archival: 'Upstream publishes a rolling daily file without archived snapshots; the committed extract is the reproducible pinned snapshot.'
    },
    license: {
      id: 'CC-BY-SA-4.0',
      url: 'https://www.edrdg.org/edrdg/licence.html',
      attribution: 'This work uses the JMdict dictionary file. This file is the property of the Electronic Dictionary Research and Development Group, and is used in conformance with the Group\'s licence.',
      shareAlike: 'Derived dictionary data files (this extract and any lexical artifact compiled from it) must be distributed under CC BY-SA 4.0 with this attribution. Code is unaffected.'
    },
    fieldContract: JMDICT_FIELD_CONTRACT,
    extract: { file: JMDICT_EXTRACT_FILE, sha256: sha256(text), bytes: Buffer.byteLength(text), entries: extract.length },
    accounting
  };
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, JMDICT_EXTRACT_FILE), gz);
  await writeFile(resolve(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`JMdict ${accounting.createdDate}: ${extract.length} entries, extract ${text.length} chars, gz ${gz.length} bytes`);
}

await main();
