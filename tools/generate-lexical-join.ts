import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildLexicalAuthorityJoin, createLexicalHistoryResolver, LEXICAL_JOIN_PATH, loadJoinSources } from './lexical-historical-join.ts';
import { normalizeCheckoutText } from './verification-text.ts';

// generate:lexical-join writes the 4.8F join artifact; validate:lexical-join (in npm run check) fails if it is stale.
const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
const sources = await loadJoinSources(rootDir);
const text = `${JSON.stringify(buildLexicalAuthorityJoin(sources, createLexicalHistoryResolver(sources).sinoGraph))}\n`;
const path = resolve(rootDir, LEXICAL_JOIN_PATH);
if (process.argv.includes('--check')) {
  if (normalizeCheckoutText(await readFile(path, 'utf8')) !== text) throw new Error(`Phase 4.8F join artifact is stale: ${LEXICAL_JOIN_PATH}`);
  console.log(`Phase 4.8F lexical authority join OK`);
} else {
  await writeFile(path, text);
  console.log(`wrote ${LEXICAL_JOIN_PATH} (${text.length} chars)`);
}
