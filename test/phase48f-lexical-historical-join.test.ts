import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildLexicalAuthorityJoin, createLexicalHistoryResolver, LEXICAL_JOIN_PATH, loadJoinSources } from '../tools/lexical-historical-join.ts';
import { normalizeCheckoutText } from '../tools/verification-text.ts';

const sources = await loadJoinSources(process.cwd());
const resolver = createLexicalHistoryResolver(sources);
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

test('そうてい lexical family shares one reading reconstruction without JMdict choosing a written form', () => {
  const soutei = resolver.resolveHistory({ form: '装丁', reading: 'そうてい' });
  assert.deepEqual(soutei.lexicalEquivalents, ['装幀', '装訂', '装釘']);
  // written form authority comes only from the accepted 4.6C record (candidates 装幀 | 装釘); 装訂 is not promoted
  assert.deepEqual(plain(soutei.writtenForm), {
    status: 'candidates', basis: 'source_candidates', candidates: ['装幀', '装釘'],
    intakeRecords: ['phase46c-homophone-sotei'], evidenceRefs: soutei.writtenForm!.evidenceRefs
  });
  assert.equal(soutei.reading.route, 'sino-dag');
  assert.deepEqual(soutei.reading.historical, ['さうてい']);
  assert.equal(soutei.reading.basis, 'generated_productive_span');
  const sau = (soutei.reading as any).components[0];
  assert.equal(sau.pattern, 'pattern:さう>そう');
  // the same shared pattern node serves every member of the family
  for (const form of ['装幀', '装釘', '装訂']) {
    const member = resolver.resolveHistory({ form, reading: 'そうてい' });
    assert.deepEqual(member.reading.historical, ['さうてい']);
    assert.equal((member.reading as any).components[0].pattern, 'pattern:さう>そう');
    assert.equal(member.writtenForm, null, `${form} gains no written-form authority from JMdict`);
  }
});

test('path-level convergence 文法 ぶんぽう reconstructs through a derived shared pattern', () => {
  // without context the 法 ambiguity propagates into the word: both predecessors survive
  const open = resolver.resolveHistory({ form: '文法', reading: 'ぶんぽう' });
  assert.equal(open.reading.status, 'candidates');
  assert.deepEqual(open.reading.historical, ['ぶんぱふ', 'ぶんぽふ']);
  // the unqualified table row (explicit null context) yields ぶんぱふ via ぱふ>ぽう, derived from はふ>ほう
  const bunpou = resolver.resolveHistory({ form: '文法', reading: 'ぶんぽう', context: null });
  assert.deepEqual(bunpou.reading.historical, ['ぶんぱふ']);
  const hou = (bunpou.reading as any).components[1];
  assert.equal(hou.pattern, 'pattern:ぱふ>ぽう');
  assert.equal(hou.basePattern, 'pattern:はふ>ほう');
});

test('法 / ほう keeps はふ | ほふ, Buddhist context selects ほふ, and no non-Buddhist default is admitted', () => {
  const hou = resolver.resolveHistory({ form: '法', reading: 'ほう' });
  assert.equal(hou.reading.status, 'candidates');
  assert.deepEqual(hou.reading.historical, ['はふ', 'ほふ']);
  assert.deepEqual(resolver.resolveHistory({ form: '法', reading: 'ほう', context: '仏教用語' }).reading.historical, ['ほふ']);
  // an unknown/other context does not fall through to はふ
  assert.equal(resolver.resolveHistory({ form: '法', reading: 'ほう', context: '法律用語' }).reading.status, 'unresolved');
});

test('whole-word source authority outranks reconstruction and stays exact', () => {
  const gakkou = resolver.resolveHistory({ form: '学校', reading: 'がっこう' });
  assert.equal(gakkou.reading.route, 'whole-word-source');
  assert.equal(gakkou.reading.basis, 'source_exact');
  assert.deepEqual(gakkou.reading.historical, ['がくかう']);
  assert.ok((gakkou.reading as any).dagCrossCheck.includes('がくかう'));
});

test('component authority is reused through reading-aligned composition', () => {
  const welder = resolver.resolveHistory({ form: '溶接工', reading: 'ようせつこう' });
  assert.deepEqual(plain(welder.writtenForm).candidates, ['熔接工']);
  assert.equal(welder.writtenForm!.basis, 'generated_productive_span');
  assert.equal((welder.writtenForm as any).component, '溶接');
  assert.deepEqual(resolver.resolveHistory({ form: '溶接', reading: 'ようせつ' }).writtenForm!.basis, 'source_exact');
});

test('the committed join artifact binds every accepted intake record and is current', async () => {
  const generated = buildLexicalAuthorityJoin(sources, resolver.sinoGraph);
  const committed = normalizeCheckoutText(await readFile(LEXICAL_JOIN_PATH, 'utf8'));
  assert.equal(committed, `${JSON.stringify(generated)}\n`);
  const total = Object.values(sources.intake).reduce((n, r) => n + r.length, 0);
  assert.equal(generated.records.length, total);
  const byId = new Map(generated.records.map((r) => [r[0], r]));
  assert.deepEqual(byId.get('phase46c-homophone-sotei')!.slice(1, 4), ['lexeme', 'candidate_ambiguous', 'unique']);
  assert.deepEqual(byId.get('phase46e:phase46e-sino-table:row:153:token:0')![4], ['symbol:法', 'pattern:はふ>ほう']);
});
