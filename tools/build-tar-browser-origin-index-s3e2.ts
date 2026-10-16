/**
 * JO #349 S3-E2-P10b3c-1：既受入固定TAR枝だけのブラウザ用読取インデックスを生成。
 * 生成物のdigestは検証ログで確定する。別pin前にruntime OFFの許可に使わない。
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { auditTarOriginSidecar } from './tar-origin-sidecar-s3e0.ts';
import { normalizeAcceptedOrthographySources, assertNoSilentSourceDrop } from './orthography-source-normalization.ts';
import { withProfileRules } from './orthography-policy.ts';
import { compileRuleIR } from './rule-ir.ts';
import { compilePrograms } from './rule-program-compiler.ts';
import { SYMBOL_REGISTRY, type SymbolRegistry } from './symbol-registry.ts';
import { auditTarOriginPackIdentity } from './tar-pack-identity-admission-s3e2.ts';
import { createAuditedTarEmissionJoin } from './tar-audited-emission-join-s3e2.ts';
import type { BrowserPackManifestV1 } from './browser-pack-model.ts';

export async function buildFixedTarBrowserOriginIndex(root:string, manifest:BrowserPackManifestV1) {
  const lock=JSON.parse(await readFile(resolve(root,'data/reports/browser-pack-v3-compiled.json'),'utf8')) as {packDigest:string};
  const sidecar=await auditTarOriginSidecar(root);
  const normalized=await normalizeAcceptedOrthographySources(root);
  assertNoSilentSourceDrop(normalized);
  const graph=withProfileRules(normalized.graph);
  const ir=compileRuleIR(graph);
  if (ir.digest!==sidecar.irDigest) throw new Error('TAR browser index: IR identity drift');
  const registry=JSON.parse(await readFile(resolve(root,SYMBOL_REGISTRY),'utf8')) as SymbolRegistry;
  const refs=[...new Set(graph.facts.filter(f=>f.kind==='literal_form'||f.kind==='literal_reading')
    .flatMap(f=>f.lexicalRefs))].sort();
  const byLexeme=new Map(refs.map((ref,index)=>[ref,index]));
  const programs=compilePrograms(ir,registry,ref=>byLexeme.get(ref)??null);
  const admission=auditTarOriginPackIdentity({
    sourceCommit:sidecar.sourceCommit,sidecarIrDigest:sidecar.irDigest,
    ir,programs,manifest,expectedPackDigest:lock.packDigest
  });
  const join=createAuditedTarEmissionJoin(sidecar,ir,programs);
  if(join.verifiedBranches!==123||join.verifiedPrograms!==63) {
    throw new Error('TAR browser index: audited branch scope drift');
  }
  const rows=sidecar.rows.map(row=>{
    const rule=ir.rules[row.programId];
    if(!rule) throw new Error('TAR browser index: missing rule');
    const ordinals=rule.branches.flatMap((branch,i)=>
      branch.canonicalId===row.canonicalRuleId&&branch.output===row.output?[i]:[]);
    if(ordinals.length!==1) throw new Error('TAR browser index: ambiguous emission');
    const branchOrdinal=ordinals[0]!;
    const matched=join.match({
      edge:{output:row.output,programs:[row.programId],
        emission:{programId:row.programId,branchOrdinal}},
      input:row.input,stage:'profile',direction:'to-modern',
      channel:'surface',profileId:'kinotch-fixed'
    });
    if(matched.status!=='matched'||matched.entry.programId!==row.programId
      ||matched.entry.branchOrdinal!==branchOrdinal) {
      throw new Error('TAR browser index: canonical join mismatch');
    }
    return {
      programId:row.programId,branchOrdinal,
      input:row.input,output:row.output,kind:row.kind,
      editableEntryKeys:[...matched.entry.editableEntryKeys]
    };
  }).sort((a,b)=>a.programId-b.programId||a.branchOrdinal-b.branchOrdinal);
  const keys=new Set(rows.map(row=>`${row.programId}:${row.branchOrdinal}`));
  const origins=new Set(rows.flatMap(row=>row.editableEntryKeys));
  if(keys.size!==123||rows.length!==123||origins.size!==126
    ||rows.filter(r=>r.kind==='candidate').length!==120
    ||rows.filter(r=>r.kind==='shared-output').length!==3) {
    throw new Error('TAR browser index: accepted fixed origin coverage drift');
  }
  const index=Object.freeze({
    schemaVersion:'1',kind:'fixed-tar-browser-origin-index-s3e2',
    sourceCommit:admission.sourceCommit,irDigest:admission.irDigest,
    packDigest:admission.packDigest,programDigest:admission.programDigest,
    branchCount:123,editableOriginCount:126,rows
  });
  const bytes=Buffer.from(JSON.stringify(index)+'\n','utf8');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  return Object.freeze({index,bytes,sha256});
}
