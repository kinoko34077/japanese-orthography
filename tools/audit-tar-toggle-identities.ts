import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateTarPatternCorpus } from './tar-pattern.ts';

/**
 * #319: TAR source-case → 原典entryの全件照合。read-only / 本番未接続。
 * sourceCase(検証行) ≠ canonical relation(集約済) ≠ editable source entry ≠ ProgramId。
 */
export const TAR_PIN = '198f8560613d23417cb0f87172ae8662e722ca30';
export const TAR_CORPORA = ['simple-exact', 'context', 'candidate', 'pattern'] as const;
export const EXPECTED_RECORDS = [3163, 670, 165, 7] as const;
export const EXPECTED_CASES = [3166, 670, 165, 7] as const;
type SourceRef = { kind?: string; path?: string; locator?: string; sourceId?: string };
type SourceRecord = {
  id?: string;
  sourceCaseId?: string;
  sourceCaseIds?: string[];
  sourceRuleId?: string;
  sourceRefs?: SourceRef[];
  locator?: string;
  from?: string;
  to?: string;
  expectedOutputs?: string[];
};
type SourceDocument = { records: SourceRecord[] };
type HomeEntry = { sourceCaseId: string; corpusPath: string; recordIndex: number; recordId: string };
type HomeIndex = { sourceCommit: string; profileId: string; entries: HomeEntry[]; disabledSourceCaseIds: string[] };

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const valid = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
function ensure(ok: unknown, message: string): asserts ok { if (!ok) throw new Error('TAR identity census: ' + message); }
const corpusPath = (name: string) => 'data/migrations/tar/' + TAR_PIN + '/' + name + '-rules.json';

type AuditCase = { caseId: string; corpus: string; recordId: string; keys: string[]; strongKeys: string[] };
export function auditTarToggleIdentities(docs: readonly SourceDocument[], home: HomeIndex) {
  ensure(docs.length === 4, 'requires 4 canonical corpora');
  ensure(home.sourceCommit === TAR_PIN && home.profileId === 'kinotch-fixed', 'wrong source snapshot or profile');
  ensure(Array.isArray(home.entries) && Array.isArray(home.disabledSourceCaseIds), 'invalid profile index');
  const rows: AuditCase[] = [];
  const byCase = new Map<string, AuditCase>();
  const recordCounts: number[] = [], caseCounts: number[] = [];
  const byKey = new Map<string, Set<string>>();
  const sourceCasesByRecord = new Map<string, Set<string>>();
  const caseOutputKeys = new Map<string, Set<string>>();
  let noStrongIdentity = 0, multiProvenance = 0, recordsWithSharedCases = 0;
  for (const [i, doc] of docs.entries()) {
    const corpus = TAR_CORPORA[i]!;
    const path = corpusPath(corpus);
    ensure(Array.isArray(doc?.records) && doc.records.length === EXPECTED_RECORDS[i], 'record count for ' + corpus);
    recordCounts.push(doc.records.length);
    let cases = 0;
    for (const [recordIndex, rec] of doc.records.entries()) {
      const ids = i === 0 ? rec.sourceCaseIds : [rec.sourceCaseId];
      const recordId = i === 3 ? rec.sourceRuleId : rec.id;
      ensure(valid(recordId) && Array.isArray(ids) && ids.length > 0, 'record/case identity at ' + path + '/' + recordIndex);
      if (ids.length > 1) recordsWithSharedCases++;
      const refs: SourceRef[] = i === 3 ? [
        { kind: 'structured', path: 'transform-settings (8).json', sourceId: rec.sourceRuleId, locator: rec.locator }
      ] : rec.sourceRefs ?? [];
      ensure(Array.isArray(refs) && refs.length > 0, 'missing origin references for ' + recordId);
      const keys = new Set<string>(), strongKeys = new Set<string>();
      for (const ref of refs) {
        ensure((ref.kind === 'structured' || ref.kind === 'flat') && valid(ref.path), 'unqualified origin for ' + recordId);
        if (ref.kind === 'structured' && valid(ref.sourceId)) {
          // 固定snapshot内のeditable entry。複数from_optionsは同一entryを共有する。
          const k = JSON.stringify([TAR_PIN, ref.kind, ref.path, ref.sourceId]);
          keys.add(k); strongKeys.add(k);
        } else if (valid(ref.locator)) {
          // flatは独立した長期editable IDを持たない場合がある。locatorはsnapshot依存の暫定キー。
          keys.add(JSON.stringify([TAR_PIN, ref.kind, ref.path, 'locator', ref.locator]));
        } else {
          ensure(false, 'origin with neither sourceId nor locator: ' + recordId);
        }
      }
      if (keys.size > 1) multiProvenance++;
      for (const caseId of ids) {
        ensure(valid(caseId) && !byCase.has(caseId), 'duplicate sourceCaseId ' + caseId);
        const row = { caseId, corpus, recordId, keys: [...keys].sort(cmp), strongKeys: [...strongKeys].sort(cmp) };
        rows.push(row); byCase.set(caseId, row); cases++;
        if (!row.strongKeys.length) noStrongIdentity++;
        for (const k of keys) {
          if (!byKey.has(k)) byKey.set(k, new Set());
          byKey.get(k)!.add(caseId);
        }
        const own = JSON.stringify([corpus, recordId]);
        if (!sourceCasesByRecord.has(own)) sourceCasesByRecord.set(own, new Set());
        sourceCasesByRecord.get(own)!.add(caseId);
        if (valid(rec.from)) {
          if (!caseOutputKeys.has(rec.from)) caseOutputKeys.set(rec.from, new Set());
          const outputKey = i === 2 ? JSON.stringify(rec.expectedOutputs) : (rec.to ?? JSON.stringify(rec.expectedOutputs));
          if (outputKey !== undefined) caseOutputKeys.get(rec.from)!.add(outputKey);
        }
      }
    }
    ensure(cases === EXPECTED_CASES[i], 'source-case count for ' + corpus);
    caseCounts.push(cases);
  }
  ensure(rows.length === 4008, 'active count is not 4008');
  const homeByCase = new Map<string, HomeEntry>();
  for (const e of home.entries) {
    ensure(valid(e.sourceCaseId) && !homeByCase.has(e.sourceCaseId), 'duplicate case in profile index');
    homeByCase.set(e.sourceCaseId, e);
  }
  ensure(homeByCase.size === 4008, 'profile index active count mismatch');
  for (const row of rows) {
    const e = homeByCase.get(row.caseId);
    ensure(e !== undefined && e.corpusPath === corpusPath(row.corpus) && e.recordId === row.recordId,
      'profile index relation mismatch ' + row.caseId);
    // Indexed record positionを全件照合（同一corpus内のsource orderを保持）。
    const doc = docs[TAR_CORPORA.indexOf(row.corpus as typeof TAR_CORPORA[number])]!;
    const indexed = doc.records[e.recordIndex];
    ensure(indexed !== undefined &&
      (row.corpus === 'pattern' ? indexed.sourceRuleId : indexed.id) === row.recordId,
      'profile index record offset mismatch ' + row.caseId);
  }
  ensure(home.disabledSourceCaseIds.length === 28 &&
    new Set(home.disabledSourceCaseIds).size === 28, 'disabled source-case accounting drift');
  for (const id of home.disabledSourceCaseIds) ensure(!byCase.has(id), 'disabled source case activated ' + id);
  const sharedSourceKeys = [...byKey.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([sourceKey, ids]) => ({ sourceKey, cases: ids.size }))
    .sort((a, b) => b.cases - a.cases || cmp(a.sourceKey, b.sourceKey));
  const divergentInput = [...caseOutputKeys.entries()].filter(([, outputs]) => outputs.size > 1);
  return {
    schemaVersion: '1', kind: 'tar-toggle-identity-census',
    sourceCommit: TAR_PIN, profileId: home.profileId,
    corpusRecords: Object.fromEntries(TAR_CORPORA.map((name, i) => [name, recordCounts[i]])),
    corpusCases: Object.fromEntries(TAR_CORPORA.map((name, i) => [name, caseCounts[i]])),
    canonicalRecordCount: recordCounts.reduce((a,b)=>a+b,0),
    activeSourceCases: rows.length, disabledSourceCases: home.disabledSourceCaseIds.length,
    aggregateRelationsWithMultipleCases: recordsWithSharedCases,
    casesWithoutStrongStructuredEntryId: noStrongIdentity,
    casesWithMultipleDistinctSourceReferences: rows.filter(x=>x.keys.length>1).length,
    recordsWithMultipleDistinctSourceReferences: multiProvenance,
    sourceIdentityKeys: byKey.size,
    sourceKeysSharedAcrossCases: sharedSourceKeys.length,
    maxCasesPerSourceKey: sharedSourceKeys[0]?.cases ?? 1,
    sharedSourceKeyExamples: sharedSourceKeys.slice(0, 8),
    sameSurfaceMultipleOutputsIgnoringContext: divergentInput.length,
    sameSurfaceMultipleOutputExamples: divergentInput.slice(0, 8).map(([from, outputs])=>({from, distinctOutputs: outputs.size})),
    sameSurfaceCaveat: 'Raw from text only; profile, sequence and token context are NOT distinguished. Not an ambiguity estimate.',
    programMapping: { status: 'not-established', reason: 'Compiled ProgramId is a build-local index; source provenance alone cannot prove one-to-one or many-to-one runtime mapping. Runtime/evidence join required.' },
    logicalIdPolicy: {
      strong: 'source commit + structured source path + sourceId (editable entry, within pinned source snapshot only)',
      provisional: 'source commit + flat path + locator (not guaranteed stable across source edits)',
      forbidden: 'Never use sourceCaseId, compiled ProgramId, canonical relation ID as interchangeable persistent entry identity.'
    }
  };
}

export async function runTarToggleIdentityCensus(root: string) {
  // #291 の既存固定原典照合を再利用し、patternのsourceRuleIdを捏造せず毎回verifyする。
  await validateTarPatternCorpus(root);
  const docs = await Promise.all(TAR_CORPORA.map(async name =>
    JSON.parse(await readFile(resolve(root, corpusPath(name)), 'utf8')) as SourceDocument));
  const home = JSON.parse(await readFile(resolve(root,
    'data/profiles/kinotch/tar-operational-rules/source-case-index.json'), 'utf8')) as HomeIndex;
  return auditTarToggleIdentities(docs, home);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runTarToggleIdentityCensus(resolve(process.cwd()));
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
