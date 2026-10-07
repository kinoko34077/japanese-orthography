import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { TAR_PARITY_COMMIT, TAR_PARITY_FIXTURE, type TarParityCase } from './tar-parity.ts';

export const TAR_CONTEXT_CORPUS =
  'data/migrations/tar/' + TAR_PARITY_COMMIT + '/context-rules.json';

type SourceRef = TarParityCase['sourceRefs'][number];

export type TarContextExecutionDisposition = 'executable' | 'interpreter-unreachable';

export interface TarContextRecord {
  id: string;
  origin: 'tar';
  sourceCaseId: string;
  executionDisposition: TarContextExecutionDisposition;
  dispositionReason: string | null;
  from: string;
  to: string;
  priority: number;
  ruleType: string | null;
  conditions: unknown;
  sequence: unknown;
  matchOptions: unknown;
  matchTarget: unknown;
  sourceRefs: SourceRef[];
  nodePath: string[];
  nodeKind: string | null;
}

const readJson = async (rootDir: string, path: string) =>
  JSON.parse(await readFile(resolve(rootDir, path), 'utf8')) as any;

const hasPayload = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return String(value).trim().length > 0;
};

export const isTarContextCase = (record: TarParityCase): boolean =>
  record.origin === 'tar'
  && record.sourceEnabled !== false
  && !record.regex
  && !record.wildcard
  && record.expectedOutputs.length === 1
  && (
    Boolean(record.ruleType)
    || hasPayload(record.conditions)
    || hasPayload(record.sequence)
    || hasPayload(record.matchOptions)
    || hasPayload(record.matchTarget)
  );

const matcherParts = (value: unknown): { positive: string[]; negative: string[] } => {
  const raw = (Array.isArray(value) ? value : [value])
    .flatMap((entry) => typeof entry === 'string' ? entry.split(',') : [entry])
    .filter((entry) => entry !== undefined && entry !== null)
    .map((entry) => String(entry).trim())
    .filter(Boolean);
  const positive: string[] = [];
  const negative: string[] = [];
  for (const entry of raw) {
    if (entry.startsWith('-') && !entry.startsWith('\\-')) negative.push(entry.slice(1).trim());
    else positive.push(entry.startsWith('\\-') ? entry.slice(1) : entry);
  }
  return { positive, negative };
};

const wildcardMatches = (actual: string, expected: string): boolean => {
  if (!expected.includes('*')) return actual === expected;
  const parts = expected.split('*');
  let cursor = 0;
  if (!expected.startsWith('*')) {
    if (!actual.startsWith(parts[0]!)) return false;
    cursor = parts[0]!.length;
  }
  const middle = expected.startsWith('*') ? parts.slice(0, -1) : parts.slice(1, -1);
  for (const part of middle) {
    if (!part) continue;
    const at = actual.indexOf(part, cursor);
    if (at < 0) return false;
    cursor = at + part.length;
  }
  const last = parts.at(-1) ?? '';
  return expected.endsWith('*') || actual.endsWith(last);
};

const conditionAllowsBasic = (condition: unknown, from: string): boolean => {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return true;
  const row = condition as Record<string, unknown>;
  const expected = row.basic_form ?? row.basic;
  if (expected === undefined || expected === null) return true;
  const { positive, negative } = matcherParts(expected);
  if (negative.some((value) => wildcardMatches(from, value))) return false;
  return positive.length === 0 || positive.some((value) => wildcardMatches(from, value));
};

export const tarContextExecutionDisposition = (record: TarParityCase): {
  disposition: TarContextExecutionDisposition;
  reason: string | null;
} => {
  if (Array.isArray(record.sequence) && record.sequence.length > 0) return { disposition: 'executable', reason: null };
  const current = record.conditions && typeof record.conditions === 'object'
    ? (record.conditions as Record<string, unknown>).current
    : undefined;
  const branches = Array.isArray(current) ? current : current ? [current] : [];
  const branchHasBasic = branches.some((branch) => branch && typeof branch === 'object' && !Array.isArray(branch)
    && (((branch as Record<string, unknown>).basic_form ?? (branch as Record<string, unknown>).basic) !== undefined));
  const strict = record.matchTarget === 'basic_form' || record.ruleType === 'verb' || record.ruleType === 'adjective' || branchHasBasic;
  if (!strict || branches.length === 0 || branches.some((branch) => conditionAllowsBasic(branch, record.from))) {
    return { disposition: 'executable', reason: null };
  }
  return {
    disposition: 'interpreter-unreachable',
    reason: 'pinned TAR strict-basic matcher requires token.basic_form to equal from, while every current condition branch requires a different basic form'
  };
};

const stableId = (record: TarParityCase): string =>
  'tar:context:' + createHash('sha256').update(JSON.stringify({
    sourceCaseId: record.id,
    from: record.from,
    to: record.expectedOutputs[0],
    priority: record.priority,
    ruleType: record.ruleType,
    conditions: record.conditions,
    sequence: record.sequence,
    matchOptions: record.matchOptions,
    matchTarget: record.matchTarget
  })).digest('hex').slice(0, 16);

const asRecord = (record: TarParityCase): TarContextRecord => {
  const execution = tarContextExecutionDisposition(record);
  return {
  id: stableId(record),
  origin: 'tar',
  sourceCaseId: record.id,
  executionDisposition: execution.disposition,
  dispositionReason: execution.reason,
  from: record.from,
  to: record.expectedOutputs[0]!,
  priority: record.priority,
  ruleType: record.ruleType,
  conditions: record.conditions,
  sequence: record.sequence,
  matchOptions: record.matchOptions,
  matchTarget: record.matchTarget,
  sourceRefs: structuredClone(record.sourceRefs),
  nodePath: [...record.nodePath],
  nodeKind: record.nodeKind
  };
};

export async function buildTarContextCorpus(rootDir: string) {
  const fixture = await readJson(rootDir, TAR_PARITY_FIXTURE);
  if (fixture.accounting?.fixtureRecords !== 4036 || fixture.records?.length !== 4036) {
    throw new Error('TAR context corpus requires the accepted 4,036-case parity fixture');
  }
  const selected = (fixture.records as TarParityCase[]).filter(isTarContextCase);
  if (selected.length !== 670) {
    throw new Error('expected 670 TAR context cases, got ' + selected.length);
  }
  const records = selected.map(asRecord).sort((a, b) =>
    a.from.localeCompare(b.from, 'ja')
    || a.to.localeCompare(b.to, 'ja')
    || a.id.localeCompare(b.id)
  );
  const caseIds = new Set(records.map((record) => record.sourceCaseId));
  const ruleIds = new Set(records.map((record) => record.id));
  if (caseIds.size !== 670 || ruleIds.size !== 670) {
    throw new Error('TAR context corpus must preserve one unique rule record per source case');
  }

  const axisCounts = {
    conditions: selected.filter((r) => hasPayload(r.conditions)).length,
    matchOptions: selected.filter((r) => hasPayload(r.matchOptions)).length,
    matchTarget: selected.filter((r) => hasPayload(r.matchTarget)).length,
    sequence: selected.filter((r) => hasPayload(r.sequence)).length,
    ruleType: selected.filter((r) => Boolean(r.ruleType)).length
  };
  return {
    schemaVersion: '1',
    kind: 'tar-context-rules',
    owner: 'japanese-orthography#289',
    originVocabulary: ['kinotch', 'tar'],
    selection: {
      sourceCommit: TAR_PARITY_COMMIT,
      parityFixture: TAR_PARITY_FIXTURE,
      criterion: 'enabled non-pattern single-output rule requiring typed context/match semantics'
    },
    accounting: {
      sourceCases: selected.length,
      records: records.length,
      executableRecords: records.filter((record) => record.executionDisposition === 'executable').length,
      interpreterUnreachableRecords: records.filter((record) => record.executionDisposition === 'interpreter-unreachable').length,
      dropped: selected.length - records.length,
      axisCounts
    },
    recordsDigest: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
    records
  };
}

export async function validateTarContextCorpus(rootDir: string) {
  const [expected, committed] = await Promise.all([
    buildTarContextCorpus(rootDir),
    readJson(rootDir, TAR_CONTEXT_CORPUS)
  ]);
  if (committed.kind !== 'tar-context-rules' || committed.owner !== 'japanese-orthography#289') {
    throw new Error('invalid TAR context corpus identity');
  }
  if (committed.selection?.sourceCommit !== TAR_PARITY_COMMIT) {
    throw new Error('TAR context source commit drift');
  }
  if (committed.accounting?.sourceCases !== 670
    || committed.accounting?.records !== 670
    || committed.accounting?.executableRecords !== 667
    || committed.accounting?.interpreterUnreachableRecords !== 3
    || committed.accounting?.dropped !== 0) {
    throw new Error('TAR context accounting drift');
  }
  if (JSON.stringify(committed.records) !== JSON.stringify(expected.records)) {
    throw new Error('TAR context corpus drift; run npm run bootstrap:tar-context');
  }
  if (committed.recordsDigest !== expected.recordsDigest) {
    throw new Error('TAR context recordsDigest drift');
  }
  for (const record of committed.records as TarContextRecord[]) {
    if (record.origin !== 'tar' || !record.sourceCaseId || !record.sourceRefs.length) {
      throw new Error(record.id + ': missing TAR provenance');
    }
  }
  return committed;
}

async function main() {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  if (process.argv.includes('--bootstrap')) {
    const doc = await buildTarContextCorpus(rootDir);
    await mkdir(dirname(resolve(rootDir, TAR_CONTEXT_CORPUS)), { recursive: true });
    await writeFile(resolve(rootDir, TAR_CONTEXT_CORPUS), JSON.stringify(doc, null, 2) + '\n');
    console.log('TAR context bootstrap wrote ' + doc.records.length + ' rules; digest ' + doc.recordsDigest);
    return;
  }
  const doc = await validateTarContextCorpus(rootDir);
  console.log('TAR context OK: ' + doc.records.length + ' records / dropped ' + doc.accounting.dropped);
}

if (process.argv[1]?.endsWith('tar-context.ts')) await main();
