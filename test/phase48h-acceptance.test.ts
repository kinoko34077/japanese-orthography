import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { extractJmdictIntake, loadJmdictIntake, validateJmdictIntake } from '../tools/jmdict-intake.ts';
import { createLexicalHistoryResolver, loadJoinSources } from '../tools/lexical-historical-join.ts';
import { createLexicalSpanAnalyzer, lexicalOccurrenceContext } from '../tools/lexical-span-analysis.ts';
import { buildHotArtifact } from '../tools/lexical-hot-artifact.ts';
import { compileJmdictLexicalGraph } from '../tools/jmdict-lexical-graph.ts';
import type { NormalizedOrthographyRelation } from '../tools/normalized-relation-model.ts';
import { resolveProductiveOrthography, type LexicalOccurrenceContext } from '../tools/productive-orthography.ts';

// Phase 4.8H end-to-end acceptance matrix (#140): one pass through
// pinned intake -> typed lexicon -> span lattice -> occurrence arbitration -> historical join -> hot runtime.

const { extract, accounting, manifest } = await loadJmdictIntake(process.cwd());
const unidic = JSON.parse(await readFile('data/lexical/sources/unidic-cwj-202512-first-slice.json', 'utf8'));
const analyzer = createLexicalSpanAnalyzer({ createdDate: accounting.createdDate, entries: extract, unidic: unidic.records, unidicVersion: unidic.source.version });
const history = createLexicalHistoryResolver(await loadJoinSources(process.cwd()));
const contextFor = (text: string) => lexicalOccurrenceContext(analyzer.analyze(text)) as LexicalOccurrenceContext;
const bengo = {
  id: 'acceptance:bengo', relationKind: 'mapping', channel: 'surface', applicationMode: 'substring_productive',
  fromForms: ['弁護'], toForms: ['辯護'], basis: 'source_exact', evidenceRefs: ['acceptance']
} as NormalizedOrthographyRelation;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));

test('source/intake: pinned snapshot, licence, provenance, drift detection, complete field contract', () => {
  assert.equal(manifest.source.createdDate, '2026-10-01');
  assert.equal(manifest.license.id, 'CC-BY-SA-4.0');
  assert.equal(manifest.historicalAuthority, false);
  assert.deepEqual(validateJmdictIntake(extract, accounting), []);
  const drifted = structuredClone(accounting);
  drifted.elements['entry/r_ele/reb']!.seen += 1;
  assert.match(validateJmdictIntake(extract, drifted).join('\n'), /entry\/r_ele\/reb included/);
  assert.throws(() => extractJmdictIntake('<!-- JMdict created: 2026-10-01 --><JMdict><entry><ent_seq>1</ent_seq><r_ele><reb>あ</reb><new/></r_ele><sense></sense></entry></JMdict>'), /undispositioned element/);
});

test('lexical identity: one lexeme many forms, homophones distinct, restrictions honoured', () => {
  const graph = compileJmdictLexicalGraph(extract, accounting);
  const hot = createRequire(import.meta.url)('../runtime/lexical-hot-runtime.js').createLexicalHotRuntime(buildHotArtifact(graph, history.sinoGraph, {}));
  const binding = hot.lookupForm('装丁').map((c: any) => c.lexeme);
  for (const f of ['装幀', '装釘', '装訂']) assert.deepEqual(hot.lookupForm(f).map((c: any) => c.lexeme), binding);
  assert.ok(hot.lookupReading('そうてい').length >= 4);
  assert.ok(graph.restrictions.length > 10000);
  // a kanji-surface span never offers a reading restricted to another form
  for (const entry of extract.filter((e) => e.r.some((r) => r.restr?.length)).slice(0, 200)) {
    for (const k of entry.k ?? []) {
      const span = analyzer.analyze(k.t).spans.find((s) => s.surface === k.t)!;
      const candidate = span.candidates.find((c) => c.sourceRefs.includes(`jmdict:2026-10-01:seq:${entry.seq}`))!;
      const allowed = entry.r.filter((r) => !r.nokanji && (!r.restr || r.restr.includes(k.t))).map((r) => `reading-path:${r.t}`);
      if (allowed.length === 0) { assert.equal(candidate, undefined); continue; }
      assert.deepEqual(candidate.readings, [...new Set(allowed)].sort(), k.t);
    }
  }
});

test('span/composition + overlap: 弁護 components, 勘弁護衛 blocked, unknowns valid, AB/BC traced', () => {
  for (const [input, expected] of [['国選弁護士', '国選辯護士'], ['弁護人', '辯護人'], ['弁護団', '辯護団']] as const) {
    assert.equal(resolveProductiveOrthography(input, [bengo], { lexical: contextFor(input) }).output, expected);
  }
  const kanben = resolveProductiveOrthography('勘弁護衛', [bengo], { lexical: contextFor('勘弁護衛') });
  assert.equal(kanben.output, '勘弁護衛');
  assert.equal(kanben.blockedRules[0]!.reason, 'crosses_lexical_boundary');
  const unknown = analyzer.analyze('☃弁護☃');
  assert.deepEqual(unknown.spans.filter((s) => s.kind === 'unknown').map((s) => s.surface), ['☃', '☃']);
  assert.equal(resolveProductiveOrthography('☃弁護☃', [bengo], { lexical: contextFor('☃弁護☃') }).output, '☃辯護☃');
  const rel = (id: string, from: string, to: string) => ({ ...bengo, id, fromForms: [from], toForms: [to] });
  const abc = resolveProductiveOrthography('ABC', [rel('AB', 'AB', 'X'), rel('BC', 'BC', 'Y')]);
  assert.equal(abc.output, 'ABC');
  assert.deepEqual(abc.blockedRules.map((b) => b.reason), ['unresolved_shifted_overlap', 'unresolved_shifted_overlap']);
  assert.equal(resolveProductiveOrthography('AB', [rel('A', 'A', 'a'), rel('AB', 'AB', 'X')]).output, 'X');
});

test('historical reading DAG + authority: predecessors kept, path-level class, 法 ambiguity, JMdict not winner authority', () => {
  const soutei = history.resolveHistory({ form: '装丁', reading: 'そうてい' });
  assert.deepEqual(soutei.reading.historical, ['さうてい']);
  assert.deepEqual(plain(soutei.writtenForm).candidates, ['装幀', '装釘']);
  assert.ok(soutei.lexicalEquivalents.includes('装訂'));
  assert.deepEqual(history.resolveHistory({ form: '文法', reading: 'ぶんぽう' }).reading.historical, ['ぶんぱふ', 'ぶんぽふ']);
  assert.equal((history.resolveHistory({ form: '文法', reading: 'ぶんぽう', context: null }).reading as any).components[1].basePattern, 'pattern:はふ>ほう');
  assert.deepEqual(history.resolveHistory({ form: '法', reading: 'ほう' }).reading.historical, ['はふ', 'ほふ']);
  assert.deepEqual(history.resolveHistory({ form: '法', reading: 'ほう', context: '仏教用語' }).reading.historical, ['ほふ']);
  assert.equal(history.resolveHistory({ form: '法', reading: 'ほう', context: '一般' }).reading.status, 'unresolved');
  const gakkou = history.resolveHistory({ form: '学校', reading: 'がっこう' });
  assert.equal(gakkou.reading.basis, 'source_exact');
  assert.equal(soutei.reading.basis, 'generated_productive_span');
});
