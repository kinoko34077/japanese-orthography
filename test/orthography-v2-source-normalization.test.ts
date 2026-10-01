import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { validateOrthographyKnowledge } from '../tools/orthography-knowledge-model.ts';
import { assertNoSilentSourceDrop, normalizeAcceptedOrthographySources } from '../tools/orthography-source-normalization.ts';
import { buildSourceAccountingReport, SOURCE_ACCOUNTING_REPORT } from '../tools/orthography-migration-accounting.ts';
import { normalizeCheckoutText } from '../tools/verification-text.ts';

async function hashTree(dir: string, out = new Map<string, string>()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await hashTree(path, out);
    else if (!path.includes('reports')) out.set(path, createHash('sha256').update(await readFile(path)).digest('hex'));
  }
  return out;
}

const before = await hashTree('data');
const result = await normalizeAcceptedOrthographySources(process.cwd());
const factByKey = (kind: string, surface: string | undefined, reading?: string, target?: string) =>
  result.graph.facts.find((f) => f.kind === kind && f.surface === surface && f.reading === reading && f.target === target);

test('every accepted source record receives exactly one explicit disposition (zero silent drops)', () => {
  assert.equal(result.accounting.inputRecords, result.accounting.disposedRecords);
  assert.deepEqual(result.accounting.unaccounted, []);
  assert.doesNotThrow(() => assertNoSilentSourceDrop(result));
  assert.deepEqual(validateOrthographyKnowledge(result.graph), []);
  // every Phase-4.6 intake record and every JMdict entry is in the ledger
  const ledger = new Set(result.graph.dispositions.map((d) => d.sourceRecordId));
  for (const id of ['intake/phase46d-native-kana#phase46d:phase46d-kkh-kana:kana-jisyo:L17', 'intake/phase46c-homophone-rewrite#phase46c-homophone-sotei', 'jmdict/2026-10-01#1390270']) {
    assert.ok(ledger.has(id), id);
  }
  const bySource = result.accounting.bySource;
  const total = (source: string) => Object.values(bySource[source]!).reduce((a, b) => a + b, 0);
  assert.equal(total('intake/phase46d-native-kana'), 10338);
  assert.equal(total('intake/phase46e-sino-kana'), 2013);
  assert.equal(total('jmdict/2026-10-01'), 218850);
  assert.equal(bySource['intake/phase46d-native-kana']!.excluded_with_reason, 841);
  assert.equal(bySource['intake/phase46f-kinotch-profile']!.literal_fact, 0);
});

test('a broken adapter that forgets a record is reported, never hidden', () => {
  const broken = structuredClone(result);
  broken.graph.dispositions.pop();
  broken.accounting.disposedRecords -= 1;
  assert.throws(() => assertNoSilentSourceDrop(broken), /silent source drop/);
});

test('irregular readings and ateji stay literal facts with no productive rule', () => {
  const ateji = factByKey('literal_form', '独逸');
  assert.ok(ateji, '独逸 literal form');
  assert.ok(ateji.tags?.includes('ateji'));
  assert.ok(ateji.lexicalRefs.some((ref) => ref.startsWith('lexeme:')));
  const irregular = factByKey('literal_reading', '今日', 'けふ');
  assert.ok(irregular, '今日 けふ historical reading literal fact');
  // the lexeme-specific reading is not routed through any rule binding
  assert.ok(!result.graph.bindings.some((bd) => irregular.lexicalRefs.some((ref) => bd.lexicalRefs.includes(ref))));
  // 4.6D reading-only records stay readings; they never become written-form relations
  assert.ok(factByKey('literal_reading', '藍', 'あゐ'));
  assert.equal(result.graph.facts.filter((f) => f.kind === 'form_relation' && f.target === '藍').length, 0);
});

test('reusable attested patterns become shared rules plus separate bindings', () => {
  const kau = result.graph.rules.find((r) => r.id === 'rule:sino:かう>こう')!;
  assert.equal(kau.class, 'diachronic');
  assert.deepEqual([kau.from, kau.to], [['かう'], ['こう']]);
  const kouBindings = result.graph.bindings.filter((b) => b.ruleId === kau.id);
  assert.ok(kouBindings.length > 20, `${kouBindings.length} characters share かう>こう`);
  assert.ok(kouBindings.some((b) => b.lexicalRefs.includes('symbol:校')));
  // contextual 字音: 法 / ほう keeps both bindings, the Buddhist one context-qualified
  const hou = result.graph.bindings.filter((b) => b.lexicalRefs.includes('symbol:法') && result.graph.rules.find((r) => r.id === b.ruleId)!.to[0] === 'ほう');
  assert.deepEqual(hou.map((b) => [b.ruleId, b.contextRefs ?? []]).sort(), [['rule:sino:はふ>ほう', []], ['rule:sino:ほふ>ほう', ['context:usage:仏教用語']]]);
});

test('deduplicated facts keep every contributing source and evidence reference', () => {
  // 円 -> 圓 is attested by the 4.6B intake and the safe-character slice: one rule, both sources
  const en = result.graph.rules.find((r) => r.id === 'rule:char:圓>円')!;
  assert.deepEqual(en.sourceRefs, ['deterministic/safe-character-first-slice', 'intake/phase46b-character-form']);
  const ledgerTargets = result.graph.dispositions.filter((d) => d.targetIds.includes(en.id)).map((d) => d.sourceRecordId).sort();
  assert.deepEqual(ledgerTargets, ['deterministic/safe-character-first-slice#円', 'intake/phase46b-character-form#phase46b-character-en']);
  // 学校 がくかう is attested by the standalone KKH slice and the 4.6E identity slice
  const gakkou = factByKey('literal_reading', '学校', 'がくかう')!;
  assert.deepEqual(gakkou.sourceRefs, ['historical/sino/kkh-jion-first-slice', 'historical/sino/phase46e-sino-kana#identitySlice']);
});

test('profile-only choices and derived artifacts are dispositioned, not admitted as generic facts', () => {
  const byRecord = new Map(result.graph.dispositions.map((d) => [d.sourceRecordId, d]));
  assert.equal(byRecord.get('profiles/kinotch/token-style-overlay#こと')!.disposition, 'profile_policy');
  assert.equal(byRecord.get('profiles/kinotch/homophone-kanji#default:ドイツ')!.disposition, 'profile_policy');
  assert.equal(byRecord.get('historical/sino/phase46e-sino-kana#componentRelations:法:ほう:仏教用語')!.disposition, 'derived_only');
  assert.equal(byRecord.get('historical/phase48f-lexical-authority-join#phase46c-homophone-sotei')!.disposition, 'derived_only');
});

test('accounting report is deterministic and the generator leaves every source file untouched', async () => {
  const report = buildSourceAccountingReport(result);
  assert.equal(normalizeCheckoutText(await readFile(SOURCE_ACCOUNTING_REPORT, 'utf8')), `${JSON.stringify(report, null, 2)}\n`);
  const again = await normalizeAcceptedOrthographySources(process.cwd());
  assert.equal(JSON.stringify(buildSourceAccountingReport(again)), JSON.stringify(report));
  const after = await hashTree('data');
  assert.deepEqual([...after], [...before]);
});
