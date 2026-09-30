import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

const expectedRelations = [
  ['溶接', '熔接', 'ev-douon-yosetsu'],
  ['間欠', '間歇', 'ev-douon-kanketsu'],
  ['賛嘆', '讃嘆', 'ev-douon-santan'],
  ['装丁', '装釘', 'ev-douon-sotei-kugi'],
  ['装丁', '装幀', 'ev-douon-sotei-tei']
] as const;

test('4.6C bounded homophone slice remains exactly the five official lexical relations', async () => {
  const pack = await json('data/packs/contextual-kanji/homophone-rewrite.json');
  assert.deepEqual(
    pack.positiveRelations.map((relation: any) => [relation.match, relation.target, relation.evidenceRefs[0]]),
    expectedRelations
  );
  assert.equal(pack.positiveRelations.every((relation: any) => Array.from(relation.match).length > 1), true);
});

test('4.6C executable homophone relations declare lexical responsibility and intake closure', async () => {
  const pack = await json('data/packs/contextual-kanji/homophone-rewrite.json');
  for (const relation of pack.positiveRelations) {
    assert.equal(relation.responsibility, 'lexical_historical_kanji', relation.id);
    assert.equal(typeof relation.intakeRecordRef, 'string', relation.id);
    assert.notEqual(relation.intakeRecordRef.trim(), '', relation.id);
  }
});

test('4.6C intake represents three exact admissions and one complete ambiguous 装丁 record', async () => {
  const intake = await json('data/intake/phase46c-homophone-rewrite.json');
  assert.equal(intake.schemaVersion, '1');
  assert.equal(intake.kind, 'orthography_intake_bundle');
  assert.deepEqual(intake.snapshots.map((snapshot: any) => [snapshot.sourceId, snapshot.sourceClass, snapshot.coverageRole]), [
    ['phase46c-culture-agency-1956-douon', 'official', 'supplemental']
  ]);

  const singles = intake.records.filter((record: any) => record.disposition === 'admitted');
  assert.deepEqual(
    singles.map((record: any) => [record.modernSurface, record.historicalSurface, record.responsibility]),
    [
      ['溶接', '熔接', 'lexical_historical_kanji'],
      ['間欠', '間歇', 'lexical_historical_kanji'],
      ['賛嘆', '讃嘆', 'lexical_historical_kanji']
    ]
  );

  const ambiguous = intake.records.filter((record: any) => record.disposition === 'candidate_ambiguous');
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].modernSurface, '装丁');
  assert.equal(ambiguous[0].responsibility, 'lexical_historical_kanji');
  assert.deepEqual([...ambiguous[0].alternatives].sort(), ['装幀', '装釘'].sort());
  assert.deepEqual([...ambiguous[0].evidenceRefs].sort(), ['ev-douon-sotei-kugi', 'ev-douon-sotei-tei'].sort());
  assert.equal('lexicalIdentity' in ambiguous[0], false);
});

test('4.6C pack references matching intake records without collapsing 装丁 source order', async () => {
  const [pack, intake] = await Promise.all([
    json('data/packs/contextual-kanji/homophone-rewrite.json'),
    json('data/intake/phase46c-homophone-rewrite.json')
  ]);
  const records = new Map(intake.records.map((record: any) => [record.id, record]));

  for (const relation of pack.positiveRelations) {
    const record: any = records.get(relation.intakeRecordRef);
    assert.ok(record, relation.id);
    assert.equal(record.responsibility, relation.responsibility, relation.id);
    assert.equal(record.modernSurface, relation.match, relation.id);
    if (record.disposition === 'admitted') {
      assert.equal(record.historicalSurface, relation.target, relation.id);
    } else {
      assert.equal(record.disposition, 'candidate_ambiguous', relation.id);
      assert.ok(record.alternatives.includes(relation.target), relation.id);
    }
  }

  const sotei = pack.positiveRelations.filter((relation: any) => relation.match === '装丁');
  assert.equal(sotei.length, 2);
  assert.equal(new Set(sotei.map((relation: any) => relation.intakeRecordRef)).size, 1);
  assert.deepEqual(new Set(sotei.map((relation: any) => relation.target)), new Set(['装釘', '装幀']));
});
