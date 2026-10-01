import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  JMDICT_FIELD_CONTRACT,
  JMDICT_INTAKE_DIR,
  extractJmdictIntake,
  jmdictSourceLocalRef,
  loadJmdictIntake,
  validateJmdictIntake
} from '../tools/jmdict-intake.ts';

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE JMdict [
<!ENTITY n "noun (common) (futsuumeishi)">
<!ENTITY vs "noun or participle which takes the aux. verb suru">
<!ENTITY ateji "ateji (phonetic) reading">
<!ENTITY uk "word usually written using kana alone">
]>
<JMdict>
<!-- JMdict created: 2026-10-01 -->
<entry>
<ent_seq>1000001</ent_seq>
<k_ele>
<keb>装丁</keb>
<ke_pri>news1</ke_pri>
</k_ele>
<k_ele>
<keb>装幀</keb>
<ke_inf>&ateji;</ke_inf>
</k_ele>
<r_ele>
<reb>そうてい</reb>
<re_pri>news1</re_pri>
</r_ele>
<r_ele>
<reb>そうちょう</reb>
<re_restr>装幀</re_restr>
</r_ele>
<r_ele>
<reb>ソーテー</reb>
<re_nokanji/>
</r_ele>
<sense>
<stagk>装丁</stagk>
<pos>&n;</pos>
<pos>&vs;</pos>
<xref>製本</xref>
<misc>&uk;</misc>
<gloss>binding</gloss>
<gloss xml:lang="ger">Einband</gloss>
<lsource xml:lang="eng" ls_wasei="y">x &amp; y</lsource>
</sense>
<sense>
<gloss g_type="expl">book design</gloss>
</sense>
</entry>
<entry>
<ent_seq>1000002</ent_seq>
<k_ele>
<keb>想定</keb>
</k_ele>
<r_ele>
<reb>そうてい</reb>
</r_ele>
<sense>
<pos>&n;</pos>
</sense>
</entry>
</JMdict>
`;

test('fixture extraction keeps every contracted field and accounts for every excluded field', () => {
  const { extract, accounting } = extractJmdictIntake(FIXTURE);
  assert.equal(extract.length, 2);
  const [soutei] = extract;
  assert.deepEqual(soutei, {
    seq: 1000001,
    k: [{ t: '装丁', pri: ['news1'] }, { t: '装幀', inf: ['ateji'] }],
    r: [{ t: 'そうてい', pri: ['news1'] }, { t: 'そうちょう', restr: ['装幀'] }, { t: 'ソーテー', nokanji: true }],
    s: [{ stagk: ['装丁'], pos: ['n', 'vs'], misc: ['uk'] }, {}]
  });
  assert.equal(accounting.createdDate, '2026-10-01');
  assert.equal(accounting.entries, 2);
  assert.equal(accounting.elements['entry/sense/gloss']!.seen, 3);
  assert.equal(accounting.elements['entry/sense/gloss']!.disposition, 'excluded');
  assert.equal(accounting.elements['entry/sense/xref']!.disposition, 'excluded');
  assert.equal(accounting.elements['entry/r_ele/re_restr']!.disposition, 'included');
  assert.equal(accounting.attributes['entry/sense/lsource@ls_wasei']!.seen, 1);
  assert.deepEqual(accounting.undispositioned, []);
  assert.deepEqual(validateJmdictIntake(extract, accounting), []);
});

test('unknown elements, attributes, entities and stray text fail closed instead of being dropped', () => {
  assert.throws(() => extractJmdictIntake(FIXTURE.replace('<ke_pri>news1</ke_pri>', '<ke_new>x</ke_new>')), /undispositioned element entry\/k_ele\/ke_new/);
  assert.throws(() => extractJmdictIntake(FIXTURE.replace('<re_restr>', '<re_restr kind="x">')), /undispositioned attribute entry\/r_ele\/re_restr@kind/);
  assert.throws(() => extractJmdictIntake(FIXTURE.replace('&ateji;', '&undeclared;')), /undeclared entity &undeclared;/);
  assert.throws(() => extractJmdictIntake(FIXTURE.replace('<k_ele>\n<keb>想定', '<k_ele>stray\n<keb>想定')), /unexpected text/);
  assert.throws(() => extractJmdictIntake(FIXTURE.replace('<ent_seq>1000002', '<ent_seq>1000001')), /duplicate ent_seq 1000001/);
  assert.throws(() => extractJmdictIntake(FIXTURE.replace('<re_restr>装幀', '<re_restr>装訂')), /re_restr 装訂 does not name a keb/);
});

test('validator rejects silent record loss and contract drift', () => {
  const { extract, accounting } = extractJmdictIntake(FIXTURE);
  const dropped = structuredClone(extract);
  dropped[0]!.r.pop();
  assert.match(validateJmdictIntake(dropped, accounting).join('\n'), /entry\/r_ele included 4 but extract holds 3/);
  assert.match(validateJmdictIntake(extract.slice(1), accounting).join('\n'), /entry count/);
  const drift = structuredClone(accounting);
  drift.elements['entry/sense/gloss']!.disposition = 'included';
  assert.match(validateJmdictIntake(extract, drift).join('\n'), /disposition drift entry\/sense\/gloss/);
});

test('source-local identity is namespaced provenance, never a bare project id', () => {
  assert.equal(jmdictSourceLocalRef('2026-10-01', 1000001), 'jmdict:2026-10-01:seq:1000001');
  assert.throws(() => jmdictSourceLocalRef('2026-10-01', 0), /invalid ent_seq/);
  assert.equal(JMDICT_FIELD_CONTRACT.identity.projectSemanticId, false);
  assert.equal(JMDICT_FIELD_CONTRACT.historicalAuthority, false);
});

test('pinned snapshot is reproducible, complete and contains the representative lexical cases', async () => {
  const manifest = JSON.parse(await readFile(`${JMDICT_INTAKE_DIR}/manifest.json`, 'utf8'));
  const { extract, accounting } = await loadJmdictIntake(process.cwd());
  assert.deepEqual(validateJmdictIntake(extract, accounting), []);
  assert.equal(manifest.license.id, 'CC-BY-SA-4.0');
  assert.equal(manifest.historicalAuthority, false);
  assert.equal(extract.length, manifest.accounting.entries);

  const byKeb = (keb: string) => extract.filter((entry) => entry.k?.some((k) => k.t === keb));
  const byReb = (reb: string) => extract.filter((entry) => entry.r.some((r) => r.t === reb));

  // one lexeme, multiple written forms: the そうてい binding family
  const binding = byKeb('装丁');
  assert.equal(binding.length, 1);
  for (const keb of ['装幀', '装釘', '装訂']) assert.deepEqual(byKeb(keb), binding);
  // unrelated homophones remain separate entries
  const soutei = byReb('そうてい');
  assert.ok(soutei.length >= 4);
  assert.equal(new Set(soutei.map((entry) => entry.seq)).size, soutei.length);
  assert.ok(byKeb('想定').every((entry) => !binding.includes(entry)));
  // multiple readings + reading restrictions are retained
  assert.ok(extract.some((entry) => entry.r.length > 1 && entry.r.some((r) => r.restr?.length)));
  assert.ok(extract.some((entry) => entry.r.some((r) => r.nokanji)));
  // 弁護 is a lexical entry usable by later span analysis
  assert.equal(byKeb('弁護').length, 1);
});
