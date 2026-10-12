import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { auditTarCompiledEmissions } from '../tools/tar-compiled-emission-audit-s3e2.ts';
import { auditTarOriginSidecar } from '../tools/tar-origin-sidecar-s3e0.ts';
import { normalizeAcceptedOrthographySources, assertNoSilentSourceDrop } from '../tools/orthography-source-normalization.ts';
import { withProfileRules } from '../tools/orthography-policy.ts';
import { compileRuleIR, type RuleIR } from '../tools/rule-ir.ts';
import { compilePrograms, type CompiledPrograms } from '../tools/rule-program-compiler.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from '../tools/symbol-registry.ts';

const require = createRequire(import.meta.url);
const { OP } = require('../runtime/rule-program-vm.js');
const PIN = '198f8560613d23417cb0f87172ae8662e722ca30';
const sample=()=>{
  const rule = (id:string,output:string,candidate:boolean) => ({
    ruleId:id,canonicalIds:[id],input:'あ',stage:'profile',
    direction:'to-modern',channel:'surface',origin:'tar',scope:'anywhere',
    branches:[{output,candidate,canonicalId:id}]
  });
  const group=rule('rule:tar:sample','甲',true);
  group.branches.push({output:'乙',candidate:true,canonicalId:group.ruleId});
  const shared=rule('rule:tar:shared','丙',false);
  const idOf=new Map([['あ',0],['甲',1],['乙',2],['丙',3]]);
  const p={
    count:2,direct:[true,false],outputs:[[1,2],[]],flags:[[1,1],[]],
    code:[[],[OP.TEST_PROFILE,7,OP.EMIT,3,0,OP.END]],
    stage:[4,4],direction:[1,1],channel:[0,0],inputs:[[0],[0]],
    evidence:[{ruleId:group.ruleId,canonicalIds:[group.ruleId]},
              {ruleId:shared.ruleId,canonicalIds:[shared.ruleId]}],
    index:new Map([['profile|to-modern|surface|0',[0,1]]]),
    pool:{idOf}
  };
  const rows=[['甲',0,group.ruleId],['乙',0,group.ruleId],['丙',1,shared.ruleId]]
    .map(([output,programId,canonicalRuleId])=>({
      output,programId,canonicalRuleId,input:'あ',kind:programId===1?'shared-output':'candidate',
      editableEntryKeys:['sample'],evidenceOnlyKeys:[],sourceCaseIds:['sample'],provenancePriority:1
    }));
  return {
    sidecar:{sourceCommit:PIN,irDigest:'a'.repeat(64),rows},
    ir:{digest:'a'.repeat(64),rules:[group,shared]} as RuleIR,
    p:p as unknown as CompiledPrograms
  };
};

test('#349 E2-P0 直載せとbytecode両方のEMITを枝ごとに検証する',()=>{
  const fixture=sample();
  const result=auditTarCompiledEmissions(fixture.sidecar as never,fixture.ir,fixture.p);
  assert.equal(result.checkedBranches,3);
  assert.equal(result.checkedPrograms,2);
  assert.equal(result.directBranches,2);
  assert.equal(result.bytecodeBranches,1);
  assert.equal(result.runtimeOriginTagPresent,false);
});

test('#349 E2-P0 Program/出力/フラグ/依存CALL/方向の不一致はすべて拒否',()=>{
  const v=sample();
  assert.throws(()=>auditTarCompiledEmissions({...v.sidecar,sourceCommit:'unknown'} as never,v.ir,v.p),/identity/);
  assert.throws(()=>auditTarCompiledEmissions(v.sidecar as never,v.ir,{
    ...v.p,outputs:[[1,3],[]]
  }),/compiled output\/flags drift/);
  assert.throws(()=>auditTarCompiledEmissions(v.sidecar as never,v.ir,{
    ...v.p,code:[[],[OP.CALL,0,OP.END]]
  }),/unsupported/);
  assert.throws(()=>auditTarCompiledEmissions(v.sidecar as never,v.ir,{
    ...v.p,direction:[0,1]
  }),/direction\/channel drift/);
  assert.throws(()=>auditTarCompiledEmissions(v.sidecar as never,v.ir,{
    ...v.p,index:new Map()
  }),/posting/);
});

test('#349 E2-P0 固定TAR 123枝と正本compilerの実出力列を全件照合', async()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const sidecar=await auditTarOriginSidecar(root);
  const normalized=await normalizeAcceptedOrthographySources(root);
  assertNoSilentSourceDrop(normalized);
  const full=withProfileRules(normalized.graph);
  const ir=compileRuleIR(full);
  const expected=JSON.parse(await readFile(resolve(root,'data/reports/rule-program-summary.json'),'utf8'));
  assert.equal(ir.digest,sidecar.irDigest);
  assert.equal(ir.digest,expected.irDigest);
  const registry=JSON.parse(await readFile(resolve(root,SYMBOL_REGISTRY),'utf8')) as SymbolRegistry;
  const refs=[...new Set(full.facts
    .filter(f=>f.kind==='literal_form'||f.kind==='literal_reading')
    .flatMap(f=>f.lexicalRefs))].sort();
  const byLexeme=new Map(refs.map((s,i)=>[s,i]));
  const program=compilePrograms(ir,registry,ref=>byLexeme.get(ref)??null);
  assert.equal(program.count,expected.programs);
  const report=auditTarCompiledEmissions(sidecar,ir,program);
  assert.equal(report.checkedBranches,123);
  assert.equal(report.checkedPrograms,63);
  assert.equal(report.directBranches+report.bytecodeBranches,123);
  assert.ok(report.results.every(r=>r.stage==='profile'
    && r.direction==='to-modern'&&r.channel==='surface'));
});
