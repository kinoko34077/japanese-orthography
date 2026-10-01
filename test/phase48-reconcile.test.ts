import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import type { JmdictEntry } from '../tools/jmdict-intake.ts';
import { createLexicalSpanAnalyzer, lexicalOccurrenceContext, type UnidicRecord } from '../tools/lexical-span-analysis.ts';
import type { NormalizedOrthographyGraph, NormalizedOrthographyRelation } from '../tools/normalized-relation-model.ts';
import { resolveProductiveOrthography, type LexicalOccurrenceContext } from '../tools/productive-orthography.ts';
import { compileCompactOrthographyArtifact as compactOrthographyGraph, inflateCompactOrthographyArtifact as inflateCompactOrthography } from '../tools/compact-orthography.ts';
import { createLexicalHistoryResolver, loadJoinSources, type JoinSources } from '../tools/lexical-historical-join.ts';

// #154 reconciliation regressions (A1–A8, R2–R4, H4). Synthetic lexicons isolate each finding.

let seq = 9000000;
const entry = (forms: string[], readings: (string | { t: string; restr?: string[] })[]): JmdictEntry => ({
  seq: (seq += 1), ...(forms.length ? { k: forms.map((t) => ({ t })) } : {}),
  r: readings.map((r) => (typeof r === 'string' ? { t: r } : r)), s: [{ pos: ['n'] }]
});
const analyzerOf = (entries: JmdictEntry[], unidic: UnidicRecord[] = []) =>
  createLexicalSpanAnalyzer({ createdDate: '2026-10-01', entries, unidic, unidicVersion: '2025.12' });
const ctx = (analyzer: ReturnType<typeof analyzerOf>, text: string) => lexicalOccurrenceContext(analyzer.analyze(text)) as LexicalOccurrenceContext;
const rel = (id: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({
  id, relationKind: 'mapping', channel: 'surface', applicationMode: 'substring_productive',
  fromForms: [from], toForms: [to], basis: 'source_exact', evidenceRefs: [`t:${id}`], ...extra
}) as NormalizedOrthographyRelation;
const reasons = (r: { blockedRules: { reason: string }[] }) => r.blockedRules.map((b) => b.reason);

async function vmRuntime() {
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  for (const file of ['runtime/occurrence-arbitration.js', 'runtime/productive-relation-runtime.js']) {
    vm.runInNewContext(await readFile(file, 'utf8'), sandbox, { filename: file });
  }
  return sandbox.ProductiveRelationRuntime;
}
const graphOf = (relations: NormalizedOrthographyRelation[]) => ({ schemaVersion: '1', kind: 'normalized_orthography_graph', lexicalNamespaceId: 'test', sources: [], relations });
const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

test('A2: more than 16 tied best analyses cannot fail open', () => {
  // each ABC block is AB+C or A+BC (two segments either way): 2^5 = 32 tied optima
  const analyzer = analyzerOf([entry(['ＡＢ'], ['あび']), entry(['Ｃ'], ['し']), entry(['Ａ'], ['あ']), entry(['ＢＣ'], ['びし'])]);
  const text = 'ＡＢＣ'.repeat(5);
  const result = resolveProductiveOrthography(text, [rel('ab', 'ＡＢ', 'Ｘ', { applicability: 'whole_lexeme' })], { lexical: ctx(analyzer, text) });
  assert.equal(result.output, text);
  assert.ok(reasons(result).every((r) => r === 'ambiguous_lexical_boundary'), reasons(result).join());
});

test('A3: unknown edges stay available so the global minimum-unknown analysis is found', () => {
  const analyzer = analyzerOf([entry(['ＡＢ'], ['あび']), entry(['ＢＣＤ'], ['びしで'])]);
  const result = resolveProductiveOrthography('ＡＢＣＤ', [rel('bcd', 'ＢＣＤ', 'Ｙ')], { lexical: ctx(analyzer, 'ＡＢＣＤ') });
  assert.equal(result.output, 'ＡＹ');
  const paths = analyzer.analyze('ＡＢＣＤ').paths(16).map((p) => p.map((s) => `${s.kind[0]}:${s.surface}`).join('+'));
  assert.ok(paths.includes('u:Ａ+l:ＢＣＤ'), paths.join(' '));
});

test('A5: a composition boundary supported by only one viable candidate stays ambiguous', () => {
  // ＸＹ has two lexemes; only reading えっくすわい aligns with Ｘ(えっくす)+Ｙ(わい)
  const analyzer = analyzerOf([entry(['ＸＹ'], ['えっくすわい']), entry(['ＸＹ'], ['ぺあ']), entry(['Ｘ'], ['えっくす']), entry(['Ｙ'], ['わい'])]);
  const result = resolveProductiveOrthography('ＸＹ', [rel('x', 'Ｘ', 'Ｘ２')], { lexical: ctx(analyzer, 'ＸＹ') });
  assert.equal(result.output, 'ＸＹ');
  assert.deepEqual(reasons(result), ['ambiguous_lexical_boundary']);
  // reversed JMdict candidate order yields the same decision
  const reversed = analyzerOf([entry(['Ｙ'], ['わい']), entry(['Ｘ'], ['えっくす']), entry(['ＸＹ'], ['ぺあ']), entry(['ＸＹ'], ['えっくすわい'])]);
  assert.deepEqual(reasons(resolveProductiveOrthography('ＸＹ', [rel('x', 'Ｘ', 'Ｘ２')], { lexical: ctx(reversed, 'ＸＹ') })), ['ambiguous_lexical_boundary']);
});

test('A4: lexicalIdentity never disappears when lexical evidence is absent (TS + runtime)', async () => {
  const identity = rel('id', 'ＡＢ', 'Ｘ', { lexicalIdentity: 'lexeme:ＡＢ/あび' });
  const ts = resolveProductiveOrthography('ＡＢ', [identity]);
  assert.equal(ts.output, 'ＡＢ');
  assert.deepEqual(reasons(ts), ['lexical_analysis_unavailable']);
  const Runtime = await vmRuntime();
  const rt = Runtime.createProductiveRelationRuntime(graphOf([identity])).transform('ＡＢ');
  assert.equal(rt.output, 'ＡＢ');
  assert.deepEqual(plain(rt.blockedRules.map((b: any) => b.reason)), ['lexical_analysis_unavailable']);
});

test('R2: requiredMorphology is executed at occurrence level (TS + runtime)', async () => {
  const unidic = (surface: string, cType: string, cForm: string, id: number): UnidicRecord =>
    ({ surface, pos: ['動詞', '一般', '*', '*'], lemma: surface, goshu: '和', kana: surface, sourceLemmaId: id, cType, cForm } as UnidicRecord);
  const analyzer = analyzerOf([entry(['合わ'], ['あわ']), entry(['合う'], ['あう']), entry(['思う'], ['おもう'])], [
    unidic('合わ', '五段-ワア行', '未然形-一般', 1), unidic('合う', '五段-ワア行', '終止形-一般', 2),
    unidic('思う', '五段-ワア行', '終止形-一般', 3), unidic('思う', '五段-ワア行', '連体形-一般', 4)
  ]);
  const need = { conjugationType: '五段-ワア行', conjugationForm: '未然形-一般' };
  const awa = rel('awa', '合わ', '合は', { requiredMorphology: need, applicability: 'whole_lexeme' });
  assert.equal(resolveProductiveOrthography('合わ', [awa], { lexical: ctx(analyzer, '合わ') }).output, '合は');
  const mismatch = resolveProductiveOrthography('合う', [rel('au', '合う', '合ふ', { requiredMorphology: need, applicability: 'whole_lexeme' })], { lexical: ctx(analyzer, '合う') });
  assert.deepEqual(reasons(mismatch), ['morphology_mismatch']);
  const unavailable = resolveProductiveOrthography('合わ', [awa]);
  assert.deepEqual(reasons(unavailable), ['lexical_analysis_unavailable']);
  const noRecord = analyzerOf([entry(['合わ'], ['あわ'])]);
  assert.deepEqual(reasons(resolveProductiveOrthography('合わ', [awa], { lexical: ctx(noRecord, '合わ') })), ['morphology_unavailable']);
  const omou = rel('omou', '思う', '思ふ', { requiredMorphology: { conjugationForm: '終止形-一般' }, applicability: 'whole_lexeme' });
  assert.deepEqual(reasons(resolveProductiveOrthography('思う', [omou], { lexical: ctx(analyzer, '思う') })), ['ambiguous_morphology']);
  const unsupported = rel('bad', '合わ', '合は', { requiredMorphology: { mood: 'x' }, applicability: 'whole_lexeme' });
  assert.deepEqual(reasons(resolveProductiveOrthography('合わ', [unsupported], { lexical: ctx(analyzer, '合わ') })), ['morphology_unsupported']);
  const Runtime = await vmRuntime();
  const rt = Runtime.createProductiveRelationRuntime(graphOf([awa]));
  assert.equal(rt.transform('合わ', { lexical: ctx(analyzer, '合わ') }).output, '合は');
  assert.deepEqual(plain(rt.transform('合わ').blockedRules.map((b: any) => b.reason)), ['lexical_analysis_unavailable']);
});

test('A8: compact normalized relations preserve applicability exactly', () => {
  const graph: NormalizedOrthographyGraph = { schemaVersion: '1', kind: 'normalized_orthography_graph', lexicalNamespaceId: 'test', sources: [], relations: [
    rel('a', '弁護', '辯護', { applicability: 'whole_lexeme' }), rel('b', '学', '學', { applicationMode: 'character_productive', channel: 'character_form' })
  ] };
  const inflated = inflateCompactOrthography(compactOrthographyGraph(graph));
  assert.equal(inflated.relations.find((r) => r.id === 'a')!.applicability, 'whole_lexeme');
  assert.equal('applicability' in inflated.relations.find((r) => r.id === 'b')!, false);
  const tampered = compactOrthographyGraph(graph) as any;
  const row = tampered.relations.find((r: any[]) => tampered.strings[r[0]] === 'a');
  row[12] = 99;
  assert.throws(() => inflateCompactOrthography(tampered), /applicability/);
});

test('H4: the scanner never truncates a selected JMdict surface', () => {
  const long = 'ＬＯＮＧ'.repeat(10);
  const analyzer = analyzerOf([entry([long], ['ながい'])]);
  assert.ok(analyzer.analyze(long).spans.some((s) => s.kind === 'lexical' && s.surface === long));
});

const realSources = await loadJoinSources(process.cwd());
const real = createLexicalHistoryResolver(realSources);

test('A1: Phase-4.6D historicalReading authority is routed without inventing lexeme authority', () => {
  const ai = real.resolveHistory({ form: '藍', reading: 'あい' });
  assert.equal(ai.reading.route, 'native-source');
  // the accepted 4.6D data holds both あゐ and アヰ for 藍; script variants are not silently folded
  assert.deepEqual(ai.reading.historical, ['あゐ', 'アヰ']);
  assert.equal((ai.reading as any).lexicalBinding, 'unique');
  assert.equal(ai.writtenForm, null, 'reading-only records create no written-form authority');
  // a reading the form's lexemes do not have is not claimed by the record
  assert.notEqual(real.resolveHistory({ form: '藍', reading: 'らん' }).reading.route, 'native-source');
  // synthetic homograph / unbound shapes
  const synth: JoinSources = {
    ...realSources,
    entries: [entry(['甲'], ['こう']), entry(['甲'], ['きのえ'])],
    intake: { ...realSources.intake, 'phase46d-native-kana': [
      { id: 'r:ko', responsibility: 'historical_kana_native', disposition: 'admitted', modernSurface: '甲', historicalReading: 'かふ' },
      { id: 'r:none', responsibility: 'historical_kana_native', disposition: 'admitted', modernSurface: '乙乙', historicalReading: 'おつおつ' }
    ] },
    wholeWordReadings: []
  };
  const resolver = createLexicalHistoryResolver(synth);
  const homograph = resolver.resolveHistory({ form: '甲', reading: 'こう' });
  assert.equal(homograph.reading.status, 'candidates');
  assert.equal((homograph.reading as any).lexicalBinding, 'reading_unassigned');
  const unbound = resolver.resolveHistory({ form: '乙乙', reading: 'おつおつ' });
  assert.deepEqual(unbound.lexemes, []);
  assert.equal((unbound.reading as any).lexicalBinding, 'unbound');
  assert.deepEqual(unbound.reading.historical, ['おつおつ']);
});

test('A7: component written authority has no traversal-order winner', () => {
  const synth: JoinSources = {
    ...realSources,
    entries: [entry(['甲乙丙'], ['あいう']), entry(['甲乙'], ['あい']), entry(['丙'], ['う']), entry(['甲'], ['あ']), entry(['乙丙'], ['いう'])],
    intake: { ...realSources.intake, 'phase46c-homophone-rewrite': [
      { id: 'w:ab', responsibility: 'lexical_historical_kanji', disposition: 'admitted', modernSurface: '甲乙', historicalSurface: '舊甲乙' },
      { id: 'w:bc', responsibility: 'lexical_historical_kanji', disposition: 'admitted', modernSurface: '乙丙', historicalSurface: '舊乙丙' }
    ], 'phase46d-native-kana': [] },
    wholeWordReadings: []
  };
  const result = createLexicalHistoryResolver(synth).resolveHistory({ form: '甲乙丙', reading: 'あいう' });
  assert.equal(result.writtenForm!.status, 'candidates');
  assert.deepEqual(plain(result.writtenForm!.candidates), ['甲舊乙丙', '舊甲乙丙']);
  assert.equal(result.writtenForm!.basis, 'source_candidates');
});

test('R3 + A6: restriction-aware hot form+reading lookup and parallel-column validation', async () => {
  const { buildHotArtifact } = await import('../tools/lexical-hot-artifact.ts');
  const { buildEntityGraph } = await import('../tools/lexical-entity-graph.ts');
  const lexical = buildEntityGraph({
    sources: [], evidence: [], contexts: [], patterns: [], bindings: [], morphemes: [], relations: [],
    lexemes: [{ key: '甲/こう', forms: ['甲', '乙'], readings: [{ path: ['こう'] }, { path: ['おつ'] }], categories: [], sourceRefs: [] }],
    restrictions: [{ lexeme: '甲/こう', reading: ['おつ'], forms: ['乙'] }]
  });
  const empty = buildEntityGraph({ sources: [], evidence: [], contexts: [], patterns: [], bindings: [], morphemes: [], relations: [], lexemes: [] });
  const hot = buildHotArtifact(lexical, empty, {});
  const { createLexicalHotRuntime } = createRequire(import.meta.url)('../runtime/lexical-hot-runtime.js');
  const runtime = createLexicalHotRuntime(hot);
  assert.deepEqual(runtime.lookupFormReading('甲', 'こう'), ['lexeme:甲/こう']);
  assert.deepEqual(runtime.lookupFormReading('乙', 'おつ'), ['lexeme:甲/こう']);
  assert.deepEqual(runtime.lookupFormReading('甲', 'おつ'), []);
  for (const column of ['forms.lexemes', 'readings.lexemes', 'restrictions.forms']) {
    const broken = structuredClone(hot) as any;
    const [table, field] = column.split('.') as [string, string];
    broken[table][field].push([]);
    assert.throws(() => createLexicalHotRuntime(broken), /row count/, column);
  }
});
