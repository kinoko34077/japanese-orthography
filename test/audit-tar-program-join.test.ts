import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { planTarRuleJoin } from '../tools/audit-tar-program-join.ts';

const pin='198f8560613d23417cb0f87172ae8662e722ca30';
const names=['simple-exact','context','candidate','pattern'];
const corpora=await Promise.all(names.map(async(name)=>
  JSON.parse(await readFile(new URL('../data/migrations/tar/'+pin+'/'+name+'-rules.json',import.meta.url),'utf8'))));

test('#323 real four TAR corpora map all accepted cases without mistaking sourceCase for editable Rule',()=>{
  const rows=planTarRuleJoin(corpora);
  assert.equal(rows.length,4008);
  assert.equal(new Set(rows.map(x=>x.sourceCaseId)).size,4008);
  assert.equal(rows.filter(x=>x.disposition==='excluded').length,1);
  assert.equal(rows.filter(x=>x.corpus==='simple-exact').length,3166);
  assert.equal(rows.filter(x=>x.corpus==='context').length,670);
  assert.equal(rows.filter(x=>x.corpus==='candidate').length,165);
  assert.equal(rows.filter(x=>x.corpus==='pattern').length,7);
  const group=rows.filter(x=>x.canonicalRuleId?.startsWith('rule:tar:candidate-group:'));
  assert.equal(group.length,120);
  assert.equal(new Set(group.map(x=>x.canonicalRuleId)).size,60);
  assert.ok(rows.some(x=>x.corpus==='pattern' && x.canonicalRuleId?.startsWith('rule:tar:pattern:')));
  assert.ok(rows.every(x=>x.canonicalRuleId===null || x.canonicalRuleId.startsWith('rule:tar:')));
});

test('#323 fails closed on absent candidate conflict group',()=>{
  const bad=structuredClone(corpora);
  const candidate=bad[2].records.find((r: any)=>r.candidateKind==='same-input-conflict');
  candidate.candidateGroupId='tar:candidate-group:missing';
  assert.throws(()=>planTarRuleJoin(bad),/candidate conflict group missing/);
});

test('#323 rejects incorrect source corpus count',()=>{
  assert.throws(()=>planTarRuleJoin(corpora.slice(0,3)),/requires 4 corpora/);
});
