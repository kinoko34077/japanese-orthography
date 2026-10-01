import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import {
  parseOfficialHomophoneDomainTable,
  resolveHomophoneDomainContext
} from '../tools/contextual-orthography.ts';

async function loadUmd(path: string) {
  const source = await readFile(path, 'utf8');
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

async function sinoRuntime() {
  const artifact = JSON.parse(
    await readFile('data/historical/sino/phase46e-sino-kana.json', 'utf8')
  );
  const sandbox = await loadUmd('runtime/historical-sino-runtime.js');
  return sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(artifact);
}

test('official homophone domain notes are completely extractable and preserved verbatim', async () => {
  const text = await readFile(
    '仮名遣等資料/同音漢字書きかえ_対応表一式/同音漢字書きかえ_熟語対応表.csv',
    'utf8'
  );
  const rows = parseOfficialHomophoneDomainTable(text);

  assert.equal(rows.length, 301);
  assert.equal(rows.filter(row => row.domainTags.length > 0).length, 52);

  const welding = rows.find(row => row.modernForms.includes('溶接'));
  assert.equal(welding?.sourceDomainNote, '船・鉱');
  assert.deepEqual(welding?.domainTags, ['船', '鉱']);
  assert.deepEqual(welding?.historicalForms, ['熔接']);

  const roundworm = rows.find(row => row.modernForms.includes('回虫'));
  assert.equal(roundworm?.sourceDomainNote, '医');
  assert.deepEqual(roundworm?.domainTags, ['医']);
});

test('domain context selects metadata eligibility but never upgrades the official rewrite table into generic authority', async () => {
  const text = await readFile(
    '仮名遣等資料/同音漢字書きかえ_対応表一式/同音漢字書きかえ_熟語対応表.csv',
    'utf8'
  );
  const rows = parseOfficialHomophoneDomainTable(text);

  const mining = resolveHomophoneDomainContext(rows, '溶接', { domains: ['鉱'] });
  assert.equal(mining.status, 'matched');
  assert.equal(mining.authority, 'metadata_only');
  assert.deepEqual(mining.historicalCandidates, ['熔接']);
  assert.deepEqual(mining.matchedDomainTags, ['鉱']);
  assert.equal(mining.sourceDomainNotes[0], '船・鉱');

  const shipping = resolveHomophoneDomainContext(rows, '溶接', { domains: ['船'] });
  assert.equal(shipping.status, 'matched');

  const law = resolveHomophoneDomainContext(rows, '溶接', { domains: ['法'] });
  assert.equal(law.status, 'context_miss');
  assert.deepEqual(law.historicalCandidates, []);

  const absent = resolveHomophoneDomainContext(rows, '溶接');
  assert.equal(absent.status, 'context_required');
  assert.deepEqual(absent.historicalCandidates, []);
});

test('combined official domain notes match any explicitly listed specialist domain', async () => {
  const text = await readFile(
    '仮名遣等資料/同音漢字書きかえ_対応表一式/同音漢字書きかえ_熟語対応表.csv',
    'utf8'
  );
  const rows = parseOfficialHomophoneDomainTable(text);

  assert.equal(resolveHomophoneDomainContext(rows, '喫水', { domains: ['法'] }).status, 'matched');
  assert.equal(resolveHomophoneDomainContext(rows, '喫水', { domains: ['船'] }).status, 'matched');
  assert.equal(resolveHomophoneDomainContext(rows, '喫水', { domains: ['医'] }).status, 'context_miss');
});

test('word-level Sino reconstruction uses supplied usage context only for context-qualified families', async () => {
  const runtime = await sinoRuntime();

  const absent = runtime.reconstructWord('法', 'ほう');
  assert.equal(absent.status, 'candidates');
  assert.deepEqual(JSON.parse(JSON.stringify(absent.historicalReadings)), ['はふ', 'ほふ']);

  const buddhist = runtime.reconstructWord('法', 'ほう', { context: '仏教用語' });
  assert.equal(buddhist.status, 'resolved');
  assert.equal(buddhist.historicalReading, 'ほふ');
  assert.equal(buddhist.selectionContext, '仏教用語');

  const unknown = runtime.reconstructWord('法', 'ほう', { context: '未知' });
  assert.equal(unknown, null);

  const unrelated = runtime.reconstructWord('学校', 'がっこう', { context: '仏教用語' });
  assert.equal(unrelated.historicalReading, 'がくかう');
});

test('both contextual 法 rows remain directly resolvable and ordinary context omission still preserves ambiguity', async () => {
  const runtime = await sinoRuntime();

  assert.equal(
    runtime.resolveHistoricalSino({
      character: '法',
      modernReading: 'ほう',
      context: '仏教用語'
    }).historicalReading,
    'ほふ'
  );
  assert.equal(
    runtime.resolveHistoricalSino({
      character: '法',
      modernReading: 'ぼう',
      context: '仏教用語'
    }).historicalReading,
    'ぼふ'
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(
      runtime.resolveHistoricalSino({ character: '法', modernReading: 'ほう' })
    )),
    { status: 'candidates', historicalReadings: ['はふ', 'ほふ'] }
  );
});

test('Sino lookup can consume derived lexical usage context without requiring a new lexical artifact shape', async () => {
  const runtime = await sinoRuntime();
  const relation = runtime.lookup({
    lexicalIdentity: 'test:unknown-buddhist-hou',
    lexicalOrigin: 'sino',
    reading: 'ほう',
    morphology: { usage: '仏教用語' }
  }, '法');

  assert.equal(relation.reading, 'ほふ');
  assert.equal(relation.selectionContext, '仏教用語');
});
