import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildPhase46fArtifacts, extractStage, parseJson5 } from '../tools/kinotch-profile-intake.ts';
import { normalizeCheckoutText } from '../tools/verification-text.ts';

test('every active KiNoTch-local consumer relation has an explicit responsibility', async () => {
  const { bundle, coverageReport } = await buildPhase46fArtifacts(process.cwd());
  assert.equal(bundle.records.length, 373);
  for (const source of coverageReport.sources) {
    assert.equal(source.discovered, source.admitted + source.ambiguous + source.excluded, source.sourceId);
    assert.equal(source.unclassified, 0, source.sourceId);
    assert.equal(source.unparsedMappingRecords, 0, source.sourceId);
  }
  for (const record of bundle.records) {
    assert.ok(record.responsibility, record.id);
    assert.notEqual(record.exclusionReason, 'unclassified_stage60_entry', record.id);
  }
  const byFrom = new Map(bundle.records.map((record) => [record.modernSurface, record]));
  assert.equal(byFrom.get('こと')?.responsibility, 'kinotch_style');
  assert.equal(byFrom.get('面倒+ごと')?.responsibility, 'kinotch_semantic');
  assert.equal(byFrom.get('バッター')?.responsibility, 'preserve_unresolved');
  assert.equal(byFrom.get('分かる')?.responsibility, 'kinotch_style');
  assert.equal(byFrom.get('暗')?.responsibility, 'kinotch_semantic');
  assert.equal(byFrom.get('台')?.responsibility, 'merged_character');
  assert.equal(byFrom.get('奇'), undefined); // removed from Stage 60 by 4.5C
});

test('project relations never become generic authority', async () => {
  const { bundle } = await buildPhase46fArtifacts(process.cwd());
  const safe = JSON.parse(await readFile('data/deterministic/safe-character-first-slice.json', 'utf8'));
  const safePairs = new Set(safe.mappings.map((mapping: any) => `${mapping.modern}>${mapping.historical}`));
  for (const record of bundle.records) {
    const pair = `${record.modernSurface}>${record.historicalSurface}`;
    if (record.responsibility === 'character_form' && record.disposition === 'admitted') {
      assert.ok(safePairs.has(pair), pair);
    }
    if (record.responsibility.startsWith('kinotch_')) {
      assert.ok(!safePairs.has(pair), pair);
    }
  }
});

test('stage extraction reports unknown rule shapes instead of dropping them', () => {
  const parsed = extractStage(parseJson5('{ rules: [ { from: "a", to: "b" }, { unknown: 1 }, ], // note\n phrase_rules: [ { x: 1 } ] }'));
  assert.equal(parsed.records.length, 1);
  assert.deepEqual(parsed.remainders.map((remainder) => remainder.sourceRecordId), ['rules[1]', 'phrase_rules']);
});

test('Phase 4.6F artifacts are reproducible', async () => {
  const { texts } = await buildPhase46fArtifacts(process.cwd());
  for (const [path, text] of Object.entries(texts)) assert.equal(normalizeCheckoutText(await readFile(path, 'utf8')), text, path);
});
