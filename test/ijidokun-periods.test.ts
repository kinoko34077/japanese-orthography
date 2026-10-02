import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { IJIDOKUN_DIFF, loadIjidokun, parse1972, parse2014, periodDiff } from '../tools/ijidokun-intake.ts';
import { periodRuleIR, readingOf } from '../tools/period-rules.ts';
import { compilePrograms, createVM } from '../tools/rule-program-compiler.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from '../tools/symbol-registry.ts';

// #211 H — period-aware 異字同訓 (#208 §5, acceptance E).
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1');
const { manifest, parsed } = await loadIjidokun(root);
const r72 = parsed['1972']!;
const r14 = parsed['2014']!;
const registry = JSON.parse(await readFile(new URL(`../${SYMBOL_REGISTRY}`, import.meta.url), 'utf8')) as SymbolRegistry;

test('two official versions are pinned snapshots with a source contract (digest, licence, issuer, date)', () => {
  assert.deepEqual(manifest.sources.map((s: any) => s.period), ['1972', '2014']);
  for (const s of manifest.sources) {
    assert.match(s.sha256, /^[0-9a-f]{64}$/u);
    assert.match(s.url, /^https:\/\/www\.bunka\.go\.jp\//u);
    assert.ok(s.issuer && s.issued && s.extraction.sha256);
  }
  assert.match(manifest.license.url, /mext\.go\.jp/u);
});

test('each version parses into its own record set (1972: 114 families / 268 records; 2014: 133 items / 309 records)', () => {
  assert.equal(new Set(r72.map((r) => r.readingFamily)).size, 114);
  assert.equal(r72.length, 268);
  assert.equal(new Set(r14.map((r) => r.locator)).size, 133);
  assert.equal(r14.length, 309);
  for (const r of [...r72, ...r14]) {
    assert.ok(r.forms.length && r.forms.every((f) => !/[*＊\s]/u.test(f)), r.recordId);
    assert.ok(r.examples.length || r.recordId === 'ijidokun:2014:おそれ・おそれる:虞', r.recordId);
  }
  assert.ok(r72.every((r) => r.sense === null) && r14.every((r) => r.sense), '1972 lists usages only; 2014 states a sense per form group');
});

test('versions coexist: the same family yields separate, period-scoped records', () => {
  const au72 = r72.filter((r) => r.readingFamily === 'あう').map((r) => r.recordId).sort();
  const au14 = r14.filter((r) => r.readingFamily === 'あう').map((r) => r.recordId).sort();
  assert.deepEqual(au72, ['ijidokun:1972:あう:会う', 'ijidokun:1972:あう:合う', 'ijidokun:1972:あう:遭う']);
  assert.deepEqual(au14, ['ijidokun:2014:あう:会う', 'ijidokun:2014:あう:合う', 'ijidokun:2014:あう:遭う']);
  assert.equal(r14.find((r) => r.recordId === 'ijidokun:2014:あう:遭う')!.sense, '思わぬことや好ましくない出来事に出くわす。');
});

test('allowed alternatives and usage dispositions are extracted per version', () => {
  const ateru = r72.find((r) => r.recordId === 'ijidokun:1972:あたる・あてる:充てる')!;
  assert.ok(ateru.alternatives.some((a) => a.preferred === '充てる' && a.alternative === '当てる'));
  const ageru = r14.find((r) => r.recordId === 'ijidokun:2014:あがる・あげる:揚がる・揚げる')!;
  assert.ok(ageru.alternatives.some((a) => a.preferred === '揚がる' && a.alternative === '上がる'));
  const osore = r14.find((r) => r.recordId === 'ijidokun:2014:おそれ・おそれる:虞')!;
  assert.ok(osore.dispositions.includes('marked'), '虞: the version notes that 恐れ / おそれ is the general current practice');
  assert.ok(osore.notes.some((n) => n.includes('一般的')));
});

test('the period diff records changes without inferring continuity', async () => {
  const diff = periodDiff(r72, r14);
  const ageru = diff.changes.find((c) => c.family === 'あがる・あげる') as any;
  assert.deepEqual(ageru.addedForms, ['挙がる']);
  assert.ok(diff.changes.some((c) => c.change === 'family-added'));
  assert.ok(diff.changes.some((c) => c.change === 'family-absent'));
  assert.match(diff.note, /never one continued record/u);
  const committed = JSON.parse(await readFile(new URL(`../${IJIDOKUN_DIFF}`, import.meta.url), 'utf8'));
  assert.equal(committed.changes.length, diff.changes.length);
});

test('readings align by okurigana; ambiguous alignment is reported, not guessed', () => {
  assert.equal(readingOf('上がる', 'あがる・あげる'), 'あがる');
  assert.equal(readingOf('上げる', 'あがる・あげる'), 'あげる');
  assert.equal(readingOf('始め', 'はじまる・はじめ・はじめて・はじめる'), 'はじめ');
  assert.equal(readingOf('脚', 'あし'), 'あし');
  const { unaligned } = periodRuleIR([...r72, ...r14]);
  for (const u of unaligned) assert.ok(u.form, u.recordId);
});

test('period-predicated Programs: selecting a period selects its rules and never deletes the other', () => {
  const { rules } = periodRuleIR([...r72, ...r14]);
  const ir = { rules, order: rules.map((r) => r.ruleId), digest: 'period-rules' };
  const programs = compilePrograms(ir, registry, () => null);
  const vm = createVM(programs, registry);
  vm.verify();
  const forReading = (reading: string) => programs.index.get(`semantic|reconstruct|reading|${programs.pool.idOf.get(reading)}`) ?? [];
  const run = (context: Record<string, unknown>) => forReading('あう')
    .map((p) => vm.run(p, { profileId: 'historical', context }))
    .flatMap((r) => r.edges.map((e: any) => `${e.output}@${programs.evidence[e.programs[0]]!.canonicalIds[0]!.split(':')[1]}`)).sort();
  assert.deepEqual(run({ period: '2014' }), ['会う@2014', '合う@2014', '遭う@2014']);
  assert.deepEqual(run({ period: '1972' }), ['会う@1972', '合う@1972', '遭う@1972']);
  // a stated sense selects within 2014; without sense evidence every form stays a candidate
  assert.deepEqual(run({ period: '2014', sense: '思わぬことや好ましくない出来事に出くわす。' }), ['遭う@2014']);
  assert.deepEqual(run({}), [], 'no period chosen: period-scoped rules do not fire');
  assert.ok(programs.evidence.some((e) => e.evidenceType === 'ijidokun/2014/default+marked'));
});
