import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { compileBrowserPack } from '../tools/browser-pack-compiler.ts';
import { buildLexicalModel, jmdictLexemeMorphology, lexicalLayer } from '../tools/browser-pack-lexical-compiler.ts';
import { BROWSER_PACK_V2_COMPILER_VERSION } from '../tools/browser-pack-model.ts';
import { loadJmdictIntake } from '../tools/jmdict-intake.ts';
import type { OrthographyKnowledgeGraph } from '../tools/orthography-knowledge-model.ts';
import { HISTORICAL_PROFILE, MODERN_PROFILE, withProfileRules } from '../tools/orthography-policy.ts';
import { normalizeAcceptedOrthographySources } from '../tools/orthography-source-normalization.ts';
import { compileRuleIR } from '../tools/rule-ir.ts';
const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { createResolver } = require('../runtime/orthography-resolver.js');

const normalized = await normalizeAcceptedOrthographySources(process.cwd());
const graph = normalized.graph;
const intake = await loadJmdictIntake(process.cwd());

test('R1: shared JMdict form/reading assertions keep lexeme-scoped tags and evidence', () => {
  const meihaku = graph.facts.filter((f) => f.kind === 'literal_form' && f.surface === '明白');
  const ordinary = meihaku.find((f) => f.lexicalRefs.includes('lexeme:明白/めいはく'));
  const ateji = meihaku.find((f) => f.lexicalRefs.includes('lexeme:明白/あからさま'));
  assert.ok(ordinary && ateji);
  assert.deepEqual(ordinary.tags ?? [], []);
  assert.ok(ateji.tags?.includes('ateji') && ateji.tags?.includes('rK'));
  assert.notDeepEqual(ordinary.evidenceRefs, ateji.evidenceRefs);

  const barista = graph.facts.filter((f) => f.kind === 'literal_reading' && f.surface === undefined && f.reading === 'バリスタ');
  const common = barista.find((f) => f.lexicalRefs.includes('lexeme:バリスタ/バリスタ#1'));
  const searchOnly = barista.find((f) => f.lexicalRefs.includes('lexeme:バリスター/バリスター#2'));
  assert.ok(common && searchOnly);
  assert.deepEqual(common.tags ?? [], []);
  assert.ok(searchOnly.tags?.includes('sk'));
  assert.notDeepEqual(common.evidenceRefs, searchOnly.evidenceRefs);
});

test('R1: identical modern/historical reading keeps both period roles', () => {
  const rows = graph.facts.filter((f) => f.kind === 'literal_reading' && f.surface === '一層' && f.reading === 'いっそう');
  assert.ok(rows.some((f) => f.periodRefs?.includes('period:modern') && !f.periodRefs?.includes('period:historical-kana')));
  assert.ok(rows.some((f) => f.periodRefs?.includes('period:historical-kana') && !f.periodRefs?.includes('period:modern')));

  const lexeme = buildLexicalModel(graph).lexemes.find((l) => l.lexicalIdentity === 'lexeme:一層/いっそう');
  assert.ok(lexeme);
  assert.ok(lexeme.readings.some((r) => r.reading === 'いっそう' && r.period === 1));
  assert.ok(lexeme.readings.some((r) => r.reading === 'いっそう' && r.period === 2));

  const tiny: OrthographyKnowledgeGraph = { ...graph, facts: rows, rules: [], bindings: [], dispositions: [] };
  const ir = compileRuleIR(tiny, []);
  assert.ok(ir.rules.some((r) => r.direction === 'reconstruct' && r.input === 'いっそう'));
  assert.ok(ir.rules.some((r) => r.direction === 'to-historical' && r.input === '一層'));
});

test('R1: Phase-4.6D native dictionary ambiguity stays a reading candidate', () => {
  const candidates = graph.facts.filter((f) =>
    f.kind === 'literal_reading' && f.surface === '阿呆' &&
    ['あはう', 'アホ'].includes(f.reading ?? '') && f.tags?.includes('candidate')
  );
  assert.deepEqual(candidates.map((f) => f.reading).sort(), ['あはう', 'アホ'].sort());
  assert.equal(graph.facts.filter((f) => f.kind === 'form_relation' && f.target === '阿呆' && ['あはう', 'アホ'].includes(f.surface ?? '')).length, 0);

  const tiny: OrthographyKnowledgeGraph = { ...graph, facts: candidates, rules: [], bindings: [], dispositions: [] };
  const ir = compileRuleIR(tiny, []);
  assert.ok(ir.rules.length > 0);
  assert.ok(ir.rules.every((r) => r.channel === 'reading' && r.branches.every((b) => b.candidate)));
});

test('R1: historical lexical rows preserve justified modern-reading basis only', () => {
  const school = graph.facts.find((f) => f.kind === 'literal_reading' && f.surface === '学校' && f.reading === 'がくかう' && f.basisReading === 'がっこう');
  assert.ok(school);
  assert.ok(school.lexicalRefs.includes('lexeme:学校/がっこう'));

  const ha_e = graph.facts.find((f) => f.kind === 'literal_reading' && f.surface === '南風' && f.reading === 'はえ' && f.periodRefs?.includes('period:historical-kana'));
  assert.ok(ha_e);
  assert.equal(ha_e.basisReading, undefined);
  assert.deepEqual(ha_e.lexicalRefs, []);
});

test('R1: JMdict sense restrictions scope executable POS to form/reading', () => {
  const entry = intake.extract.find((e) => e.seq === 1187500);
  assert.ok(entry, 'JMdict 仮借 entry');
  const rows = [...jmdictLexemeMorphology([entry]).values()][0] ?? [];
  const kasha = rows.find((r) => r.surface === '仮借' && r.reading === 'かしゃ');
  const kashaku = rows.find((r) => r.surface === '仮借' && r.reading === 'かしゃく');
  assert.ok(kasha && kashaku);
  assert.ok(!kasha.pos.includes('vs'));
  assert.ok(kashaku.pos.includes('vs'));
});

const P = { sourceRefs: ['src:r1'], evidenceRefs: ['ev:r1'] };
const miniGraph = withProfileRules({
  schemaVersion: '2', kind: 'japanese-orthography-knowledge-graph', lexicalNamespaceId: 'r1',
  sources: [{ sourceId: 'src:r1' }],
  facts: [
    { id: 'f:no-reading-form', kind: 'literal_form', lexicalRefs: ['lexeme:少しずつ/すこしずつ'], surface: '少し宛', periodRefs: ['period:modern'], ...P },
    { id: 'f:allowed-form', kind: 'literal_form', lexicalRefs: ['lexeme:少しずつ/すこしずつ'], surface: '少しずつ', periodRefs: ['period:modern'], ...P },
    { id: 'f:allowed-reading', kind: 'literal_reading', lexicalRefs: ['lexeme:少しずつ/すこしずつ'], surface: '少しずつ', reading: 'すこしずつ', periodRefs: ['period:modern'], ...P },
    { id: 'f:multi-form', kind: 'literal_form', lexicalRefs: ['lexeme:試語/よみ1'], surface: '試語', periodRefs: ['period:modern'], ...P },
    { id: 'f:multi-r1', kind: 'literal_reading', lexicalRefs: ['lexeme:試語/よみ1'], surface: '試語', reading: 'よみ1', periodRefs: ['period:modern'], ...P },
    { id: 'f:multi-r2', kind: 'literal_reading', lexicalRefs: ['lexeme:試語/よみ1'], surface: '試語', reading: 'よみ2', periodRefs: ['period:modern'], ...P },
    { id: 'f:hist', kind: 'literal_reading', lexicalRefs: ['lexeme:試語/よみ1'], surface: '試語', reading: 'れきし', basisReading: 'よみ2', tags: ['candidate'], periodRefs: ['period:historical-kana'], ...P }
  ],
  rules: [], bindings: [], dispositions: []
} as OrthographyKnowledgeGraph);

const miniHistorical = { ...HISTORICAL_PROFILE, thresholds: {} };
const miniBuild = compileBrowserPack(miniGraph, [MODERN_PROFILE, miniHistorical], {
  compilerVersion: BROWSER_PACK_V2_COMPILER_VERSION,
  layers: [lexicalLayer({ lexemeShardSize: 8, indexShardBudgetBytes: 2048 })]
});

async function miniLexical() {
  const pack = await openBrowserPack(miniBuild.manifest, async (s: { path: string }) => miniBuild.files.get(s.path)!);
  return createBrowserLexicalRuntime(pack);
}

test('R1: surface lookup never fabricates a forbidden head reading', async () => {
  const lexical = await miniLexical();
  const [candidate] = await lexical.lookupSurface('少し宛');
  assert.equal(candidate.reading, null);
  assert.deepEqual(candidate.modernReadings, []);
});

test('R1: Browser binary preserves historical basis/candidate and filters per reading hypothesis', async () => {
  const lexical = await miniLexical();
  const [candidate] = await lexical.lookupSurface('試語');
  assert.equal(candidate.reading, 'よみ1');
  assert.equal(candidate.historicalReadings[0].basisReading, 'よみ2');
  assert.equal(candidate.historicalReadings[0].candidate, true);
  assert.deepEqual(lexical.withReading(candidate, 'よみ1').historicalReadings, []);
  const r2 = lexical.withReading(candidate, 'よみ2');
  assert.deepEqual(r2.historicalReadings.map((h: any) => [h.reading, h.basisReading, h.candidate]), [['れきし', 'よみ2', true]]);
});

test('R1: a unique contextual candidate is not promoted to AUTO', () => {
  const lexical = [{ lexicalIdentity: 'lex:r1', surface: '対象', reading: 'たいしょう', viableBindingIds: ['lex:r1'], evidenceRefs: [] }];
  const candidateResolver = createResolver({
    lexicalLookup: (surface: string) => surface === '対象' ? lexical : [],
    contextualRelations: [{ id: 'candidate-only', match: '対象', target: '對象', lexicalBindingIds: [], candidate: true }],
    contextualSafety: [], safeKanjiMap: {}
  });
  const unit = candidateResolver.resolveUnit('対象');
  assert.equal(unit.historical.contextualKanji.status, 'candidates');
  assert.equal(unit.historical.disposition, 'CANDIDATES');

  const admittedResolver = createResolver({
    lexicalLookup: (surface: string) => surface === '対象' ? lexical : [],
    contextualRelations: [{ id: 'admitted', match: '対象', target: '對象', lexicalBindingIds: [], candidate: false }],
    contextualSafety: [], safeKanjiMap: {}
  });
  assert.equal(admittedResolver.resolveUnit('対象').historical.contextualKanji.status, 'resolved');
});
