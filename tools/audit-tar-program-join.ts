import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAcceptedOrthographySources, assertNoSilentSourceDrop } from './orthography-source-normalization.ts';
import { withProfileRules } from './orthography-policy.ts';
import { compileRuleIR } from './rule-ir.ts';

const PIN='198f8560613d23417cb0f87172ae8662e722ca30';
const BASE='data/migrations/tar/'+PIN+'/';
const c=(a:string,b:string)=>a<b?-1:a>b?1:0;
function ensure(v:unknown,message:string):asserts v {if(!v)throw new Error('TAR Program join: '+message);}
type RuleRow={id?:string;sourceCaseId?:string;sourceCaseIds?:string[];sourceRuleId?:string;
  candidateKind?:string;candidateGroupId?:string|null;runtimeDisposition?:string};
type Corpus={records:RuleRow[];groups?:Array<{id:string;memberRecordIds:string[]}>};
type Mapped={sourceCaseId:string;corpus:string;canonicalRuleId:string|null;disposition:'rule'|'excluded'};

export function planTarRuleJoin(corpora:readonly Corpus[]):Mapped[]{
  ensure(corpora.length===4,'requires 4 corpora');
  const rows:Mapped[]=[];
  const groupIds=new Set((corpora[2]?.groups??[]).map(g=>g.id));
  const append=(caseId:string,corpus:string,canonicalRuleId:string|null)=>{
    ensure(caseId.length>0,'empty case');
    rows.push({sourceCaseId:caseId,corpus,canonicalRuleId,
      disposition:canonicalRuleId===null?'excluded':'rule'});
  };
  for(const row of corpora[0]!.records){
    ensure(typeof row.id==='string' && Array.isArray(row.sourceCaseIds),'simple exact source');
    const ruleId='rule:tar:simple-exact:'+row.id.replace(/^tar:exact:/,'');
    for(const id of row.sourceCaseIds)append(id,'simple-exact',ruleId);
  }
  for(const row of corpora[1]!.records){
    ensure(typeof row.id==='string' && typeof row.sourceCaseId==='string','context source');
    append(row.sourceCaseId,'context','rule:tar:context:'+row.id.replace(/^tar:context:/,''));
  }
  for(const row of corpora[2]!.records){
    ensure(typeof row.id==='string' && typeof row.sourceCaseId==='string','candidate source');
    if(row.runtimeDisposition==='review-required'){
      append(row.sourceCaseId,'candidate',null);
    }else if(row.candidateKind==='same-input-conflict'){
      ensure(typeof row.candidateGroupId==='string' && groupIds.has(row.candidateGroupId),
        'candidate conflict group missing');
      append(row.sourceCaseId,'candidate',
        'rule:tar:candidate-group:'+row.candidateGroupId.replace(/^tar:candidate-group:/,''));
    }else{
      ensure(row.candidateKind==='explicit-alternatives','unexpected candidate kind');
      append(row.sourceCaseId,'candidate','rule:tar:candidate:'+row.id.replace(/^tar:candidate:/,''));
    }
  }
  for(const row of corpora[3]!.records){
    ensure(typeof row.sourceCaseId==='string' && typeof row.sourceRuleId==='string','pattern source');
    append(row.sourceCaseId,'pattern','rule:tar:pattern:'+row.sourceRuleId);
  }
  ensure(rows.length===4008 && new Set(rows.map(x=>x.sourceCaseId)).size===4008,'sourceCase count/uniqueness drift');
  return rows.sort((a,b)=>c(a.sourceCaseId,b.sourceCaseId));
}

export async function auditTarRuleProgramJoin(root:string){
  const [simple,context,candidate,pattern]=await Promise.all(
    ['simple-exact','context','candidate','pattern'].map(async k=>
      JSON.parse(await readFile(resolve(root,BASE+k+'-rules.json'),'utf8')) as Corpus)
  );
  const [irExpected,programExpected,home]=await Promise.all([
    readFile(resolve(root,'data/reports/rule-ir-summary.json'),'utf8').then(JSON.parse) as Promise<{digest:string;rules:number}>,
    readFile(resolve(root,'data/reports/rule-program-summary.json'),'utf8').then(JSON.parse) as Promise<{irDigest:string;programs:number}>,
    readFile(resolve(root,'data/profiles/kinotch/tar-operational-rules/source-case-index.json'),'utf8').then(JSON.parse) as Promise<{entries:Array<{sourceCaseId:string}>;disabledSourceCaseIds:string[]}>
  ]);
  const rows=planTarRuleJoin([simple,context,candidate,pattern]);
  ensure(home.entries.length===4008 && home.disabledSourceCaseIds.length===28,'profile home count drift');
  const caseIds=new Set(rows.map(r=>r.sourceCaseId));
  for(const ref of home.entries)ensure(caseIds.has(ref.sourceCaseId),'profile home case absent');
  for(const id of home.disabledSourceCaseIds)ensure(!caseIds.has(id),'disabled entry became active');
  const normalized=await normalizeAcceptedOrthographySources(root);
  assertNoSilentSourceDrop(normalized);
  const ir=compileRuleIR(withProfileRules(normalized.graph));
  ensure(ir.digest===irExpected.digest && ir.digest===programExpected.irDigest,
    'Rule IR digest differs from accepted generated Program');
  ensure(ir.rules.length===irExpected.rules && ir.rules.length===programExpected.programs,
    'Rule IR/Program count drift');
  // 現行compilerではProgramId=この順序付きIR.rulesのindex。
  const canonicalToPrograms=new Map<string,number[]>();
  for(const [programId,rule]of ir.rules.entries()){
    for(const id of rule.canonicalIds){
      const list=canonicalToPrograms.get(id)??[];
      list.push(programId);
      canonicalToPrograms.set(id,list);
    }
  }
  const missing:string[]=[];
  const excluded:string[]=[];
  const multipleProgramCases:string[]=[];
  const programSources=new Map<number,string[]>();
  const canonicalSources=new Map<string,string[]>();
  for(const row of rows){
    if(row.canonicalRuleId===null){excluded.push(row.sourceCaseId);continue;}
    const programs=canonicalToPrograms.get(row.canonicalRuleId)??[];
    if(!programs.length){missing.push(row.sourceCaseId);continue;}
    if(programs.length>1)multipleProgramCases.push(row.sourceCaseId);
    const other=canonicalSources.get(row.canonicalRuleId)??[];
    other.push(row.sourceCaseId);canonicalSources.set(row.canonicalRuleId,other);
    for(const pid of programs){
      const cases=programSources.get(pid)??[];
      cases.push(row.sourceCaseId);programSources.set(pid,cases);
    }
  }
  const multiCasePrograms=[...programSources.entries()].filter(([,cases])=>cases.length>1);
  const groupRows=rows.filter(x=>x.canonicalRuleId?.startsWith('rule:tar:candidate-group:'));
  const groupRules=new Set(groupRows.map(x=>x.canonicalRuleId));
  return {
    kind:'tar-source-case-to-program-evidence-audit',
    sourceCommit:PIN,irDigest:ir.digest,programCount:ir.rules.length,
    activeSourceCases:rows.length,excludedCases:excluded.length,
    excludedSamples:excluded.slice(0,4),
    missingCases:missing.length,missingSamples:missing.slice(0,10),
    multipleProgramCases:multipleProgramCases.length,
    canonicalRulesInSource:new Set(rows.map(x=>x.canonicalRuleId).filter(Boolean)).size,
    tracedPrograms:programSources.size,
    programsSharedByCases:multiCasePrograms.length,
    maxCasesPerProgram:[...programSources.values()].reduce((n,v)=>Math.max(n,v.length),0),
    sharedProgramSamples:multiCasePrograms.slice(0,8).map(([programId,cases])=>({
      programId,caseCount:cases.length,canonicalIds:ir.rules[programId]?.canonicalIds.slice(0,5)??[]
    })),
    candidateConflictGroupCases:groupRows.length,candidateConflictGroupRules:groupRules.size,
    ambiguousToggleSemantics:multiCasePrograms.length>0 || groupRules.size>0,
    status: missing.length>0?'unresolved-source-program-gap':'rule-level-join-only',
    note:'ProgramId corresponds to the accepted compiler IR array index under exact irDigest. Canonical Rule provenance is NOT branch/occurrence identity. A shared Program cannot be toggled independently per editable source without additional provenance. This report does not implement a toggle and does not claim full entry-origin mapping.'
  };
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.stdout.write(JSON.stringify(await auditTarRuleProgramJoin(process.cwd()),null,2)+'\n');
}
