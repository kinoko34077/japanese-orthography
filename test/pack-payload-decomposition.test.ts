import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { lexicalLayer } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION } from '../tools/browser-pack-model.ts';
import { isIdentifierText, measurePackPayload, PACK_PAYLOAD_REPORT } from '../tools/measure-pack-payload.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE } from '../tools/orthography-policy.ts';
import { adapterFixture } from './fixtures/browser-pack-fixture.ts';

// #211 A — payload decomposition (#208 §16.1).
const build = compileBrowserPack(adapterFixture(), [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], {
  shardBudgetBytes: 2048, compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION, layers: [lexicalLayer({ lexemeShardSize: 4, indexShardBudgetBytes: 128 })]
});

test('every section byte is assigned to exactly one payload class', () => {
  const report = measurePackPayload(build);
  assert.equal(report.classTotalBytes, report.totalBytes);
  for (const c of Object.values(report.classes)) {
    assert.equal(c.unicodeStringBytes + c.stringOffsetBytes + c.symbolTokenBytes + c.integerBytes + c.overheadBytes + c.jsonBytes, c.bytes);
  }
  const t = report.textualPayload;
  assert.equal(t.occurrenceBytes, t.occurrences.orthographic.bytes + t.occurrences.identifier.bytes);
  assert.equal(t.duplicateBytes, t.occurrenceBytes - t.distinctBytes);
  assert.ok(report.orthographicAtoms.distinct > 0);
  assert.ok(isIdentifierText('lexeme:学校/がっこう') && isIdentifierText('src:fixture') && !isIdentifierText('學校'));
});

test('the committed v2 decomposition describes the committed v2 pack', async () => {
  const report = JSON.parse(await readFile(new URL(`../${PACK_PAYLOAD_REPORT}`, import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../data/browser-pack-v2/manifest.json', import.meta.url), 'utf8'));
  assert.equal(report.packDigest, manifest.packDigest);
  assert.equal(report.classTotalBytes, report.totalBytes);
  assert.equal(report.totalBytes, manifest.sections.reduce((n: number, s: { byteLength: number }) => n + s.byteLength, 0));
  for (const cls of ['lexical-index', 'lexeme-metadata', 'provenance-evidence', 'knowledge-strings']) assert.ok(report.classes[cls].bytes > 0, cls);
});
