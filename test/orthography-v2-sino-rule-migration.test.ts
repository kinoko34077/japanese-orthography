import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { loadJmdictIntake } from '../tools/jmdict-intake.ts';
import { validateOrthographyKnowledge } from '../tools/orthography-knowledge-model.ts';
import { normalizeAcceptedOrthographySources } from '../tools/orthography-source-normalization.ts';
import { createSinoDagRuntime, historicalSinoRelations, projectSinoDag } from '../tools/sino-dag-projection.ts';
import { deriveSinoVariants, projectSinoDagFromKnowledge, SINO_MECHANISM_RULES, sinoRelationsFromKnowledge } from '../tools/sino-rule-normalization.ts';
import { createLexicalHistoryResolver, loadJoinSources } from '../tools/lexical-historical-join.ts';

// Frozen copy of the accepted Phase-4.6E relationForms() derivation: the oracle for the migration.
const VOICED: Record<string, string> = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ', た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ' };
const SEMI: Record<string, string> = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };
const MOD: Record<string, string> = { ゐ: 'い', ゑ: 'え', を: 'お', ぢ: 'じ', づ: 'ず' };
const modernize = (v: string) => Array.from(v, (c) => MOD[c] ?? c).join('').replace(/^くゎ/u, 'か').replace(/^ぐゎ/u, 'が');
function legacyRelationForms(modern: string, historical: string) {
  const base: [string, string, string | null][] = [[modern, historical, null]];
  if (['く', 'き', 'ち', 'つ'].includes(modern.slice(-1))) base.push([`${modern.slice(0, -1)}っ`, historical, 'coda-gemination']);
  if (historical.endsWith('ふ')) { const stem = historical.slice(0, -1); base.push([`${modernize(stem)}っ`, `${stem}っ`, 'fu-gemination']); }
  const out = [...base];
  for (const [m, h, mech] of base) for (const [table, name] of [[VOICED, 'voicing'], [SEMI, 'semi-voicing']] as const) {
    if (table[m[0]!] && table[h[0]!]) out.push([table[m[0]!] + m.slice(1), table[h[0]!] + h.slice(1), mech ? `${mech}+${name}` : name]);
  }
  return out.map(([m, h, mech]) => ({ modern: m, historical: h, mechanism: mech }));
}

const rawSinoArtifact = JSON.parse(await readFile('data/historical/sino/phase46e-sino-kana.json', 'utf8'));
const relations = historicalSinoRelations(rawSinoArtifact.componentRelations as { character: string; modernReading: string; context: string | null; historicalReadings: string[]; evidenceRefs: string[]; readingClasses?: string[] }[]);
const sinoArtifact = { ...rawSinoArtifact, componentRelations: relations };
const normalized = await normalizeAcceptedOrthographySources(process.cwd());
const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

test('derivation mechanisms are named first-class rules in the v2 knowledge graph', () => {
  assert.deepEqual(validateOrthographyKnowledge(normalized.graph), []);
  const ids = SINO_MECHANISM_RULES.map((r) => r.id).sort();
  assert.deepEqual(ids, ['rule:sino-mech:coda-gemination', 'rule:sino-mech:fu-gemination', 'rule:sino-mech:semi-voicing', 'rule:sino-mech:stem-modernization', 'rule:sino-mech:voicing']);
  for (const id of ids) assert.ok(normalized.graph.rules.some((r) => r.id === id), id);
  // no 呉音/漢音 class gate is invented without a source-backed class model
  for (const rule of SINO_MECHANISM_RULES) assert.equal(JSON.stringify(rule.predicate ?? {}).includes('readingClass'), false);
  const ledger = normalized.graph.dispositions.filter((d) => d.disposition === 'rule_definition' && d.targetIds.some((t) => t.startsWith('rule:sino-mech:')));
  assert.equal(ledger.length, 5);
});

test('data-driven mechanism derivation reproduces the accepted relationForms for every table pair', () => {
  const pairs = new Set(relations.flatMap((r) => r.historicalReadings.map((h) => `${h}>${r.modernReading}`)));
  assert.equal(pairs.size, 177);
  for (const pair of pairs) {
    const [historical, modern] = pair.split('>') as [string, string];
    assert.deepEqual(deriveSinoVariants(modern, historical), legacyRelationForms(modern, historical), pair);
  }
});

test('the 字音 DAG is a projection of the v2 knowledge graph, identical to the accepted projection', () => {
  const fromKnowledge = projectSinoDagFromKnowledge(normalized.graph, 'phase46e-sino-table');
  const fromRelations = projectSinoDag(relations, 'phase46e-sino-table');
  assert.equal(JSON.stringify(fromKnowledge), JSON.stringify(fromRelations));
  // v2 bindings carry the accepted evidence (identical or superset), never generated authority
  const rows = sinoRelationsFromKnowledge(normalized.graph);
  const byKey = new Map(rows.map((r) => [JSON.stringify([r.character, r.modernReading, r.context]), r]));
  for (const r of relations) {
    const row = byKey.get(JSON.stringify([r.character, r.modernReading, r.context]))!;
    assert.deepEqual(row.historicalReadings, r.historicalReadings);
    for (const ref of r.evidenceRefs) assert.ok(row.evidenceRefs.includes(ref), `${r.character} ${ref}`);
  }
});

test('v2-derived DAG keeps exact Phase-4.8 parity: 2,000 relations x 3 contexts and the JMdict word set', async () => {
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile('runtime/historical-sino-runtime.js', 'utf8'), sandbox);
  const legacy = sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(sinoArtifact);
  const dag = createSinoDagRuntime(projectSinoDagFromKnowledge(normalized.graph, 'phase46e-sino-table'));
  for (const r of relations) for (const query of [{}, { context: null }, { context: '仏教用語' }]) {
    assert.deepEqual(plain(dag.resolveDirect(r.character, r.modernReading, query)), plain(legacy.resolveHistoricalSino({ character: r.character, modernReading: r.modernReading, ...query })));
  }
  const { extract } = await loadJmdictIntake(process.cwd());
  const known = new Set(relations.map((r) => r.character));
  let compared = 0;
  for (const entry of extract) for (const k of entry.k ?? []) {
    const chars = Array.from(k.t);
    if (chars.length < 2 || chars.length > 4 || !chars.every((c) => known.has(c))) continue;
    for (const r of entry.r) {
      if (r.nokanji || (r.restr && !r.restr.includes(k.t))) continue;
      // same query set as the accepted 4.8C proof (法 words also queried with 仏教用語)
      for (const query of chars.includes('法') ? [{}, { context: '仏教用語' }] : [{}]) {
        assert.deepEqual(plain(dag.reconstructWord(k.t, r.t, query)), plain(legacy.reconstructWord(k.t, r.t, query)), `${k.t}/${r.t}`);
        compared += 1;
      }
    }
  }
  assert.equal(compared, 18495);
});

test('pinned examples survive the migration', async () => {
  const resolver = createLexicalHistoryResolver(await loadJoinSources(process.cwd()));
  const gakkou = resolver.resolveHistory({ form: '学校', reading: 'がっこう' });
  assert.deepEqual(gakkou.reading.historical, ['がくかう']);
  assert.ok((gakkou.reading as any).dagCrossCheck.includes('がくかう'));
  const bunpou = resolver.resolveHistory({ form: '文法', reading: 'ぶんぽう', context: null });
  assert.equal((bunpou.reading as any).components[1].basePattern, 'pattern:はふ>ほう');
  assert.deepEqual(resolver.resolveHistory({ form: '法', reading: 'ほう' }).reading.historical, ['はふ', 'ほふ']);
  assert.deepEqual(resolver.resolveHistory({ form: '法', reading: 'ほう', context: '仏教用語' }).reading.historical, ['ほふ']);
});
