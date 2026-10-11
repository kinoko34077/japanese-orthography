import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** #323: TAR候補グループの原典member→output branch対応。production未接続。 */
type Member={id:string;sourceCaseId:string;candidateGroupId:string|null;
  candidateKind:string;runtimeDisposition:string;expectedOutputs:string[];from:string};
type Group={id:string;input:string;outputs:string[];memberRecordIds:string[];sourceCaseIds:string[]};
export type BranchOrigin={output:string;memberRecordId:string;sourceCaseId:string};
export type GroupOrigin={groupId:string;input:string;branches:BranchOrigin[]};
function ensure(value:unknown,message:string):asserts value{
  if(!value)throw new Error('TAR branch provenance: '+message);
}
export function mapCandidateBranchOrigins(doc:{records:Member[];groups:Group[]}):GroupOrigin[]{
  const memberById=new Map(doc.records.map(x=>[x.id,x]));
  ensure(memberById.size===doc.records.length,'duplicate candidate record');
  const used=new Set<string>();
  const out:GroupOrigin[]=[];
  for(const group of doc.groups){
    ensure(group.outputs.length===2 && group.memberRecordIds.length===2
      && group.sourceCaseIds.length===2,'unexpected branch cardinality '+group.id);
    ensure(new Set(group.outputs).size===2,'group outputs not distinct '+group.id);
    const branches:BranchOrigin[]=[];
    for(const memberId of group.memberRecordIds){
      ensure(!used.has(memberId),'member reused between groups');
      used.add(memberId);
      const member=memberById.get(memberId);
      ensure(member && member.candidateGroupId===group.id
        && member.candidateKind==='same-input-conflict'
        && member.runtimeDisposition==='candidate-set'
        && member.from===group.input,'missing/wrong member '+memberId);
      ensure(member.expectedOutputs.length===1
        && group.outputs.includes(member.expectedOutputs[0]!),'member output not uniquely in group');
      ensure(group.sourceCaseIds.includes(member.sourceCaseId),'member sourceCase not in group');
      branches.push({output:member.expectedOutputs[0]!,memberRecordId:member.id,sourceCaseId:member.sourceCaseId});
    }
    ensure(new Set(branches.map(b=>b.output)).size===2,'output collision within group');
    ensure(new Set(branches.map(b=>b.sourceCaseId)).size===2,'sourceCase collision within group');
    branches.sort((a,b)=>group.outputs.indexOf(a.output)-group.outputs.indexOf(b.output));
    out.push({groupId:group.id,input:group.input,branches});
  }
  ensure(out.length===60 && used.size===120,'candidate groups not fully mapped');
  return out.sort((a,b)=>a.groupId<b.groupId?-1:a.groupId>b.groupId?1:0);
}

/**
 * 将来の論理entry maskを与えた場合の孤立PoC。
 * sourceCaseIdはあくまでfixture joinキーであり永続的なユーザー設定キーではない。
 * OFFでも候補選別前の他branchを破棄しない。
 */
export function visibleGroupOutputs(group:GroupOrigin,isActive:(sourceCaseId:string)=>boolean):string[]{
  return group.branches.filter(b=>isActive(b.sourceCaseId)).map(b=>b.output);
}

export async function auditCandidateBranchOrigins(root:string){
  const doc=JSON.parse(await readFile(resolve(root,
    'data/migrations/tar/198f8560613d23417cb0f87172ae8662e722ca30/candidate-rules.json'),'utf8')) as {
      records:Member[];groups:Group[]
    };
  const groups=mapCandidateBranchOrigins(doc);
  return {kind:'tar-candidate-branch-provenance-audit',groups:groups.length,
    sourceCases:groups.reduce((n,g)=>n+g.branches.length,0),
    eachOutputHasUniqueSourceMember:groups.every(g=>new Set(g.branches.map(b=>b.sourceCaseId)).size===2),
    samples:groups.slice(0,5),
    status:'source-case-branch-link-proven; program-output-runtime-join-not-yet-wired',
    caveat:'sourceCaseId cannot be a durable toggle key. Mapping from origin sourceRefs and output to runtime Program branch must be separately proved, then masked before arbitration.'
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.stdout.write(JSON.stringify(await auditCandidateBranchOrigins(process.cwd()),null,2)+'\n');
}
