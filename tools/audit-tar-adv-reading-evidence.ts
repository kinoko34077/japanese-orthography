import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadJmdictIntake, type JmdictEntry } from './jmdict-intake.ts';

const SOURCE = 'data/migrations/tar/198f8560613d23417cb0f87172ae8662e722ca30/context-rules.json';
const noPayload=(v:unknown):boolean=>v===undefined||v===null||
  (Array.isArray(v)&&v.length===0)||(typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===0);
type ContextRecord={ sourceCaseId:string;from:string;to:string;conditions?:Record<string,unknown>;
  sequence?:unknown;ruleType?:unknown;matchOptions?:unknown;matchTarget?:unknown };
export type LexicalGate='single-adv-lexical-evidence'|'ambiguous-reading-or-pos'|'no-jmdict-reading-evidence';

export function isPureAdverbPosRule(r:ContextRecord):boolean{
  const c=r.conditions;
  if(!c||Object.keys(c).length!==1||c.current===null||typeof c.current!=='object'
    ||Array.isArray(c.current)) return false;
  const current=c.current as Record<string,unknown>;
  return Object.keys(current).length===1&&current.pos==='副詞'
    &&[r.sequence,r.ruleType,r.matchOptions,r.matchTarget].every(noPayload);
}

export function classifyJmdictReadingAdverb(reading:string,entries:readonly JmdictEntry[]):{
  gate:LexicalGate; entries:number; pos:string[]; sourceSeq:number[];
}{
  const matches=entries.filter(e=>e.r.some(r=>r.t===reading));
  if(matches.length===0) return {gate:'no-jmdict-reading-evidence',entries:0,pos:[],sourceSeq:[]};
  const pos=new Set<string>();
  let restricted=false;
  for(const entry of matches) {
    const senses=entry.s.filter(s=>!s.stagr?.length||s.stagr.includes(reading));
    if(!senses.length) restricted=true;
    for(const s of senses) {
      if(s.stagk?.length) restricted=true;
      for(const p of s.pos??[])pos.add(p);
    }
  }
  const resolved=[...pos].sort();
  return {
    gate:matches.length===1&&!restricted&&resolved.length===1&&resolved[0]==='adv'
      ?'single-adv-lexical-evidence':'ambiguous-reading-or-pos',
    entries:matches.length,pos:resolved,sourceSeq:matches.map(e=>e.seq).sort((a,b)=>a-b)
  };
}

/**
 * Dictionary-only census. Reading evidence != token boundary/POS-in-context proof.
 * No converter modifications. Records and JMdict are pinned accepted inputs.
 */
export async function auditTarAdverbReadingEvidence(root:string){
  const [doc,jmdict]=await Promise.all([
    readFile(resolve(root,SOURCE),'utf8').then(JSON.parse) as Promise<{records:ContextRecord[]}>,
    loadJmdictIntake(root)
  ]);
  if(doc.records.length!==670)throw new Error('TAR context corpus changed');
  const selected=doc.records.filter(isPureAdverbPosRule);
  if(selected.length!==224)throw new Error('TAR pure-adv count changed');
  const bySurface=new Map<string,ContextRecord[]>();
  for(const r of selected){
    if(typeof r.from!=='string'||!r.from||typeof r.to!=='string'||!r.sourceCaseId)
      throw new Error('invalid selected TAR context record');
    const array=bySurface.get(r.from)??[];
    array.push(r);bySurface.set(r.from,array);
  }
  const wanted=new Set(bySurface.keys());
  const index=new Map<string,JmdictEntry[]>();
  for(const entry of jmdict.extract){
    const matched=new Set(entry.r.filter(x=>wanted.has(x.t)).map(x=>x.t));
    for(const reading of matched){
      const list=index.get(reading)??[];
      list.push(entry);index.set(reading,list);
    }
  }
  const results=[...bySurface.entries()].map(([from,rules])=>{
    const result=classifyJmdictReadingAdverb(from,index.get(from)??[]);
    const outputs=[...new Set(rules.map(r=>r.to))].sort();
    const conflict=outputs.length>1;
    return {from,sourceCaseIds:rules.map(r=>r.sourceCaseId).sort(),outputs,
      hasCompetingTarOutputs:conflict,
      lexicalGate:result.gate,jmdictMatches:result.entries,pos:result.pos,seq:result.sourceSeq};
  }).sort((a,b)=>a.from<b.from?-1:a.from>b.from?1:0);
  const count=(pred:(r:typeof results[number])=>boolean)=>results.filter(pred).length;
  return {
    kind:'tar-jmdict-adv-reading-evidence-census',source:SOURCE,
    jmdictCreated:jmdict.accounting.createdDate,
    totalContextRules:doc.records.length,selectedCases:selected.length,distinctInputs:results.length,
    sameInputMultipleTarRecords:count(r=>r.sourceCaseIds.length>1),
    sameInputDifferentTarOutputs:count(r=>r.hasCompetingTarOutputs),
    lexicalEvidenceUnique:count(r=>r.lexicalGate==='single-adv-lexical-evidence'&&!r.hasCompetingTarOutputs),
    lexicalAmbiguous:count(r=>r.lexicalGate==='ambiguous-reading-or-pos'),
    lexicalMissing:count(r=>r.lexicalGate==='no-jmdict-reading-evidence'),
    tarConflicts:results.filter(r=>r.hasCompetingTarOutputs),
    sampleUnique:results.filter(r=>r.lexicalGate==='single-adv-lexical-evidence'&&!r.hasCompetingTarOutputs).slice(0,12),
    sampleAmbiguous:results.filter(r=>r.lexicalGate==='ambiguous-reading-or-pos').slice(0,12),
    sampleMissing:results.filter(r=>r.lexicalGate==='no-jmdict-reading-evidence').slice(0,12),
    policy:'Read-only evidence: single reading/adv match is necessary but never sufficient for unrestricted real-text automatic applicability; segmentation, boundary, other lexical candidates, precedence and original TAR context remain unproven.'
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.stdout.write(JSON.stringify(await auditTarAdverbReadingEvidence(process.cwd()),null,2)+'\n');
}
