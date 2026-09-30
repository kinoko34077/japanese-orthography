import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

const expected = [
  ['溶接', '熔接', 'ev-douon-yosetsu', 'ev-kotobank-phase46c-yosetsu'],
  ['間欠', '間歇', 'ev-douon-kanketsu', 'ev-kotobank-phase46c-kanketsu'],
  ['賛嘆', '讃嘆', 'ev-douon-santan', 'ev-kotobank-phase46c-santan'],
  ['装丁', '装釘', 'ev-douon-sotei-kugi', 'ev-kotobank-phase46c-sotei-kugi'],
  ['装丁', '装幀', 'ev-douon-sotei-tei', 'ev-kotobank-phase46c-sotei-tei']
] as const;

test('4.6C hot reverse relations cite official rewrite evidence and independent lexical evidence', async () => {
  const pack = await json('data/packs/contextual-kanji/homophone-rewrite.json');
  const byPair = new Map(pack.positiveRelations.map((relation: any) => [`${relation.match}\u0000${relation.target}`, relation]));

  for (const [modern, historical, officialRef, lexicalRef] of expected) {
    const relation: any = byPair.get(`${modern}\u0000${historical}`);
    assert.ok(relation, `${modern} -> ${historical}`);
    assert.ok(relation.evidenceRefs.includes(officialRef), `${relation.id}: missing official evidence`);
    assert.ok(relation.evidenceRefs.includes(lexicalRef), `${relation.id}: missing independent lexical evidence`);
  }
});

test('4.6C intake preserves both modernization provenance and lexical attestation for every executable target', async () => {
  const intake = await json('data/intake/phase46c-homophone-rewrite.json');

  for (const [modern, historical, officialRef, lexicalRef] of expected) {
    const record: any = intake.records.find((candidate: any) =>
      candidate.modernSurface === modern &&
      (candidate.historicalSurface === historical || candidate.alternatives?.includes(historical))
    );
    assert.ok(record, `${modern} -> ${historical}`);
    assert.ok(record.evidenceRefs.includes(officialRef), `${record.id}: missing official evidence`);
    assert.ok(record.evidenceRefs.includes(lexicalRef), `${record.id}: missing independent lexical evidence`);
  }
});

test('4.6C lexical evidence records attest exactly the bounded reverse pairs', async () => {
  const kotobank = await json('data/evidence/dictionaries/kotobank.json');
  const evidence = new Map(kotobank.evidence.map((item: any) => [item.id, item]));

  for (const [modern, historical, , lexicalRef] of expected) {
    const item: any = evidence.get(lexicalRef);
    assert.ok(item, lexicalRef);
    assert.equal(item.sourceRef, 'kotobank', lexicalRef);
    assert.equal(item.sourceClass, 'lexical', lexicalRef);
    assert.equal(item.claim.type, 'mapping', lexicalRef);
    assert.equal(item.claim.direction, 'modern_to_historical', lexicalRef);
    assert.equal(item.claim.rawFrom, modern, lexicalRef);
    assert.equal(item.claim.rawTo, historical, lexicalRef);
  }
});
