import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAcceptedOrthographySources, assertNoSilentSourceDrop } from './orthography-source-normalization.ts';
import { withProfileRules } from './orthography-policy.ts';
import { compileRuleIR } from './rule-ir.ts';

const PIN = '198f8560613d23417cb0f87172ae8662e722ca30';
const BASE = 'data/migrations/tar/' + PIN + '/';
type SourceRef = { kind: string; path: string; sourceId?: string; locator?: string };
type Candidate = {
  id: string; sourceCaseId: string; candidateKind: string;
  candidateGroupId: string | null; from: string; expectedOutputs: string[];
  sourceRefs: SourceRef[]; priority: number;
};
type Group = {
  id: string; input: string; outputs: string[]; sourceCaseIds: string[];
  memberRecordIds: string[]; priorities: number[];
};
type Simple = { id: string; from: string; to: string; sourceCaseIds: string[]; sourceRefs: SourceRef[] };
export type BranchRule = { ruleId: string; input: string; branches: Array<{ output: string; canonicalId: string }> };
export type BranchOrigin = {
  canonicalRuleId: string; programId: number; input: string;
  output: string; sourceCaseId: string; entryKey: string;
  originKind: string; priority: number;
};
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function check(ok: unknown, info: string): asserts ok {
  if (!ok) throw new Error('TAR branch provenance: ' + info);
}
const allUnique = (xs: readonly string[]) => new Set(xs).size === xs.length;
/**
 * Fixed-source-snapshot key. Does not imply migration-safe long-term identity.
 * flat refs must not be promoted to cross-snapshot durable Rule IDs.
 */
export const sourceEntryKey = (ref: SourceRef): string => {
  check(ref && (ref.kind === 'flat' || ref.kind === 'structured')
    && typeof ref.path === 'string' && ref.path.length > 0, 'invalid origin reference');
  if (ref.kind === 'structured') {
    check(typeof ref.sourceId === 'string' && ref.sourceId.length > 0, 'structured sourceId missing');
    return JSON.stringify([PIN, 'structured', ref.path, ref.sourceId]);
  }
  check(typeof ref.locator === 'string' && ref.locator.length > 0, 'flat locator missing');
  return JSON.stringify([PIN, 'flat', ref.path, 'locator', ref.locator]);
};

/** Candidate group consensus: any matched provenance ambiguity is rejected. */
export function resolveCandidateGroupOrigins(
  groups: readonly Group[],
  records: readonly Candidate[],
  irRules: readonly BranchRule[]
): BranchOrigin[] {
  const byRecord = new Map<string, Candidate>();
  const rulesById = new Map(irRules.map((r, programId) => [r.ruleId, {r,programId}] as const));
  for(const r of records) {
    check(typeof r.id === 'string' && r.id.length > 0 && !byRecord.has(r.id), 'duplicate/missing record');
    byRecord.set(r.id,r);
  }
  const assigned = new Set<string>();
  const out: BranchOrigin[] = [];
  for(const group of groups) {
    check(group.memberRecordIds.length === 2 && group.sourceCaseIds.length === 2
      && group.outputs.length === 2 && group.priorities.length === 2, 'group cardinality');
    check(allUnique(group.memberRecordIds) && allUnique(group.sourceCaseIds) && allUnique(group.outputs),
      'ambiguous member or output');
    const canonicalId = 'rule:tar:candidate-group:' + group.id.replace(/^tar:candidate-group:/u, '');
    const target = rulesById.get(canonicalId);
    check(target !== undefined && target.r.input === group.input, 'canonical IR group missing or wrong input');
    const actualOutputs = target.r.branches.map(b=>b.output);
    check(actualOutputs.length === 2 && allUnique(actualOutputs)
      && actualOutputs.every(x=>group.outputs.includes(x)), 'IR branch outputs changed');
    for(let i=0;i<group.memberRecordIds.length;i++) {
      const id=group.memberRecordIds[i]!;
      const r=byRecord.get(id);
      check(r && !assigned.has(r.id) && r.candidateKind === 'same-input-conflict'
        && r.candidateGroupId === group.id && r.sourceCaseId === group.sourceCaseIds[i]
        && r.from === group.input && r.priority === group.priorities[i], 'group member drift');
      assigned.add(r.id);
      check(r.expectedOutputs.length === 1 && group.outputs.includes(r.expectedOutputs[0]!)
        && target.r.branches.filter(b=>b.output===r.expectedOutputs[0]).length===1,
        'candidate output branch not unique');
      check(r.sourceRefs.length===1,'one sourceCase has multiple editable origins');
      const entry=r.sourceRefs[0]!;
      out.push({
        canonicalRuleId:canonicalId,programId:target.programId,
        input:r.from,output:r.expectedOutputs[0]!,sourceCaseId:r.sourceCaseId,
        entryKey:sourceEntryKey(entry),originKind:entry.kind,priority:r.priority
      });
    }
  }
  const candidateConflict=records.filter(x=>x.candidateKind==='same-input-conflict');
  check(assigned.size===candidateConflict.length,'unmapped candidate source record');
  const pairs=out.map(o=>JSON.stringify([o.programId,o.output]));
  check(allUnique(pairs),'branch shared by multiple candidate entries: cannot mask individually without OR origin support');
  return out.sort((a,b)=>a.programId-b.programId || cmp(a.output,b.output));
}

/** Pure experimental projection; no Program-level OFF or runtime connector. */
export function enabledCandidateBranches(
  provenance:readonly BranchOrigin[],
  enabledByEntry:Readonly<Record<string, boolean>>
) {
  const known=new Set(provenance.map(r=>r.entryKey));
  for(const key of Object.keys(enabledByEntry))check(known.has(key),'unknown source entry key');
  return provenance.filter(r=>enabledByEntry[r.entryKey]!==false)
    .map(r=>({programId:r.programId,output:r.output,priority:r.priority,entryKey:r.entryKey}))
    .sort((a,b)=>a.programId-b.programId || b.priority-a.priority || cmp(a.output,b.output));
}

export async function auditTarBranchProvenance(root: string) {
  const [candidate, simple, irSummary, programSummary] = await Promise.all([
    readFile(resolve(root,BASE+'candidate-rules.json'),'utf8').then(JSON.parse) as Promise<{records:Candidate[];groups:Group[]}>,
    readFile(resolve(root,BASE+'simple-exact-rules.json'),'utf8').then(JSON.parse) as Promise<{records:Simple[]}>,
    readFile(resolve(root,'data/reports/rule-ir-summary.json'),'utf8').then(JSON.parse) as Promise<{digest:string;rules:number}>,
    readFile(resolve(root,'data/reports/rule-program-summary.json'),'utf8').then(JSON.parse) as Promise<{irDigest:string;programs:number}>
  ]);
  check(candidate.groups.length===60 && candidate.records.length===165 && simple.records.length===3163, 'canonical source cardinality');
  const normalized=await normalizeAcceptedOrthographySources(root);
  assertNoSilentSourceDrop(normalized);
  const ir=compileRuleIR(withProfileRules(normalized.graph));
  check(ir.digest===irSummary.digest && ir.digest===programSummary.irDigest
    && ir.rules.length===irSummary.rules && ir.rules.length===programSummary.programs,
    'accepted IR/Program digest drift');
  const candidates=resolveCandidateGroupOrigins(candidate.groups,candidate.records,ir.rules);
  check(candidates.length===120 && new Set(candidates.map(c=>c.programId)).size===60,
    'candidate Program branch coverage incomplete');
  const shared= simple.records.filter(r=>r.sourceCaseIds.length>1);
  check(shared.length===3 && shared.every(r=>r.sourceCaseIds.length===2),
    'simple-exact aggregation count drift');
  const irRuleById=new Map(ir.rules.map((rule,programId)=>[rule.ruleId,{rule,programId}] as const));
  const simpleShared=shared.map(r=>{
    const id='rule:tar:simple-exact:'+r.id.replace(/^tar:exact:/u,'');
    const matched=irRuleById.get(id);
    check(matched!==undefined && matched.rule.input===r.from
      && matched.rule.branches.length===1 && matched.rule.branches[0]?.output===r.to,
      'simple-exact shared Program drift');
    return {
      programId:matched.programId,canonicalRuleId:id,
      sourceCaseIds:r.sourceCaseIds,
      input:r.from,output:r.to,
      sourceKeys:[...new Set(r.sourceRefs.map(sourceEntryKey))].sort(cmp),
      status:'shared-output-origin-requires-OR-semantics' as const
    };
  });
  const uniqueEntryKeys=new Set(candidates.map(x=>x.entryKey));
  check(uniqueEntryKeys.size===120,'candidate entry identity conflict: fail closed');
  return {
    kind:'tar-shared-program-branch-provenance-census',
    sourceCommit:PIN,irDigest:ir.digest,programs:ir.rules.length,
    candidateGroups:candidate.groups.length,candidateBranchOrigins:candidates.length,
    uniqueCandidateEntryKeys:uniqueEntryKeys.size,
    candidateProgramCount:new Set(candidates.map(x=>x.programId)).size,
    flatCandidateEntries:candidates.filter(x=>x.originKind==='flat').length,
    structuredCandidateEntries:candidates.filter(x=>x.originKind==='structured').length,
    candidateExamples:candidates.slice(0,6),
    /** #349 read-only sidecar用：正本IR照合済みの120枝。永続設定キーへの昇格禁止。 */
    candidateOrigins:candidates,
    simpleSharedRelations:simpleShared.length,
    simpleShared,
    excludedCandidateCases:candidate.records.filter(x=>x.candidateKind==='review-empty-output').length,
    status:'branch-provenance-proven-for-60-candidate-groups; simple-exact-shared-output-origin-OR-pending',
    note:'Read-only: IR branch outputs matched to 120 distinct editable source entries under a fixed snapshot. Runtime program output-edge provenance is not present in compiled Program payload; no live rule toggles. Flat locator IDs are not migration-stable.'
  };
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.stdout.write(JSON.stringify(await auditTarBranchProvenance(process.cwd()),null,2)+'\n');
}
