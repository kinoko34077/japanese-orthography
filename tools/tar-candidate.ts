import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { TAR_PARITY_COMMIT, TAR_PARITY_FIXTURE, type TarParityCase } from './tar-parity.ts';

export const TAR_CANDIDATE_CORPUS =
  'data/migrations/tar/' + TAR_PARITY_COMMIT + '/candidate-rules.json';

type SourceRef = TarParityCase['sourceRefs'][number];
export type TarCandidateKind = 'explicit-alternatives' | 'same-input-conflict' | 'review-empty-output';
export type TarCandidateRuntimeDisposition = 'candidate-set' | 'review-required';

export interface TarCandidateRecord {
  id: string;
  origin: 'tar';
  sourceCaseId: string;
  sourceOrder: number;
  candidateKind: TarCandidateKind;
  runtimeDisposition: TarCandidateRuntimeDisposition;
  candidateGroupId: string | null;
  from: string;
  expectedOutputs: string[];
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

export interface TarCandidateConflictGroup {
  id: string;
  input: string;
  outputs: string[];
  sourceCaseIds: string[];
  priorities: number[];
  memberRecordIds: string[];
}

const readJson = async (rootDir: string, path: string) =>
  JSON.parse(await readFile(resolve(rootDir, path), 'utf8')) as any;

const hasPayload = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return String(value).trim().length > 0;
};

const requiresContext = (record: TarParityCase): boolean =>
  Boolean(record.ruleType)
  || hasPayload(record.conditions)
  || hasPayload(record.sequence)
  || hasPayload(record.matchOptions)
  || hasPayload(record.matchTarget);

const activeNonPattern = (record: TarParityCase): boolean =>
  record.sourceEnabled !== false && !record.regex && !record.wildcard;

const otherwiseSimple = (record: TarParityCase): boolean =>
  activeNonPattern(record) && record.expectedOutputs.length === 1 && !requiresContext(record);

const explicitCandidate = (record: TarParityCase): boolean =>
  activeNonPattern(record) && record.expectedOutputs.length !== 1;

const hash = (value: unknown, length = 16) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);

const recordId = (record: TarParityCase) => 'tar:candidate:' + hash({
  sourceCaseId: record.id,
  from: record.from,
  expectedOutputs: record.expectedOutputs,
  priority: record.priority,
  ruleType: record.ruleType,
  conditions: record.conditions,
  sequence: record.sequence,
  matchOptions: record.matchOptions,
  matchTarget: record.matchTarget
});

const groupId = (input: string, members: TarParityCase[]) =>
  'tar:candidate-group:' + hash({ input, sourceCaseIds: members.map((r) => r.id) });

export async function buildTarCandidateCorpus(rootDir: string) {
  const fixture = await readJson(rootDir, TAR_PARITY_FIXTURE);
  if (fixture.accounting?.fixtureRecords !== 4036 || fixture.records?.length !== 4036) {
    throw new Error('TAR candidate corpus requires the accepted 4,036-case parity fixture');
  }
  const source = fixture.records as TarParityCase[];
  const sourceOrder = new Map(source.map((record, index) => [record.id, index]));

  const simpleByInput = new Map<string, TarParityCase[]>();
  for (const record of source.filter(otherwiseSimple)) {
    simpleByInput.set(record.from, [...(simpleByInput.get(record.from) ?? []), record]);
  }
  const conflictMembers = new Map<string, TarParityCase[]>();
  for (const [input, members] of simpleByInput) {
    if (new Set(members.flatMap((record) => record.expectedOutputs)).size > 1) {
      conflictMembers.set(input, [...members].sort((a, b) => (sourceOrder.get(a.id)! - sourceOrder.get(b.id)!)));
    }
  }

  const selected = source.filter((record) => explicitCandidate(record) || conflictMembers.has(record.from) && otherwiseSimple(record));
  if (selected.length !== 165) throw new Error('expected 165 TAR candidate cases, got ' + selected.length);
  if (selected.some((record) => record.origin !== 'tar')) throw new Error('TAR candidate lane contains non-TAR origin');

  const groupByInput = new Map<string, string>();
  const groups: TarCandidateConflictGroup[] = [...conflictMembers.entries()]
    .map(([input, members]) => {
      const id = groupId(input, members);
      groupByInput.set(input, id);
      const outputs: string[] = [];
      for (const record of members) for (const output of record.expectedOutputs) if (!outputs.includes(output)) outputs.push(output);
      return {
        id,
        input,
        outputs,
        sourceCaseIds: members.map((record) => record.id),
        priorities: members.map((record) => record.priority),
        memberRecordIds: members.map(recordId)
      };
    })
    .sort((a, b) => a.input.localeCompare(b.input, 'ja') || a.id.localeCompare(b.id));

  const records: TarCandidateRecord[] = selected.map((record): TarCandidateRecord => {
    const isConflict = conflictMembers.has(record.from) && otherwiseSimple(record);
    const empty = record.expectedOutputs.length === 0;
    return {
      id: recordId(record),
      origin: 'tar',
      sourceCaseId: record.id,
      sourceOrder: sourceOrder.get(record.id)!,
      candidateKind: empty ? 'review-empty-output' : isConflict ? 'same-input-conflict' : 'explicit-alternatives',
      runtimeDisposition: empty ? 'review-required' : 'candidate-set',
      candidateGroupId: isConflict ? groupByInput.get(record.from)! : null,
      from: record.from,
      expectedOutputs: [...record.expectedOutputs],
      priority: record.priority,
      ruleType: record.ruleType,
      conditions: structuredClone(record.conditions),
      sequence: structuredClone(record.sequence),
      matchOptions: structuredClone(record.matchOptions),
      matchTarget: structuredClone(record.matchTarget),
      sourceRefs: structuredClone(record.sourceRefs),
      nodePath: [...record.nodePath],
      nodeKind: record.nodeKind
    };
  }).sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id));

  if (new Set(records.map((record) => record.sourceCaseId)).size !== 165) {
    throw new Error('TAR candidate corpus must preserve every candidate source case exactly once');
  }
  if (groups.length !== 60 || groups.some((group) => group.sourceCaseIds.length !== 2 || group.outputs.length !== 2)) {
    throw new Error('TAR candidate conflict-group accounting drift');
  }

  const explicit = records.filter((record) => record.candidateKind === 'explicit-alternatives');
  const conflict = records.filter((record) => record.candidateKind === 'same-input-conflict');
  const review = records.filter((record) => record.candidateKind === 'review-empty-output');
  return {
    schemaVersion: '1',
    kind: 'tar-candidate-rules',
    owner: 'japanese-orthography#290',
    originVocabulary: ['kinotch', 'tar'],
    selection: {
      sourceCommit: TAR_PARITY_COMMIT,
      parityFixture: TAR_PARITY_FIXTURE,
      criterion: 'active non-pattern explicit alternatives plus otherwise-simple same-input output conflicts'
    },
    accounting: {
      sourceCases: records.length,
      explicitAlternativeCases: explicit.length,
      conflictSourceCases: conflict.length,
      conflictGroups: groups.length,
      executableCandidateCases: records.filter((record) => record.runtimeDisposition === 'candidate-set').length,
      reviewRequiredCases: review.length,
      dropped: selected.length - records.length
    },
    recordsDigest: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
    groupsDigest: createHash('sha256').update(JSON.stringify(groups)).digest('hex'),
    groups,
    records
  };
}

export async function validateTarCandidateCorpus(rootDir: string) {
  const [expected, committed] = await Promise.all([
    buildTarCandidateCorpus(rootDir),
    readJson(rootDir, TAR_CANDIDATE_CORPUS)
  ]);
  if (committed.kind !== 'tar-candidate-rules' || committed.owner !== 'japanese-orthography#290') {
    throw new Error('invalid TAR candidate corpus identity');
  }
  if (committed.selection?.sourceCommit !== TAR_PARITY_COMMIT) throw new Error('TAR candidate source commit drift');
  const a = committed.accounting;
  if (a?.sourceCases !== 165 || a?.explicitAlternativeCases !== 44 || a?.conflictSourceCases !== 120
    || a?.conflictGroups !== 60 || a?.executableCandidateCases !== 164 || a?.reviewRequiredCases !== 1 || a?.dropped !== 0) {
    throw new Error('TAR candidate accounting drift');
  }
  if (JSON.stringify(committed.records) !== JSON.stringify(expected.records)
    || JSON.stringify(committed.groups) !== JSON.stringify(expected.groups)) {
    throw new Error('TAR candidate corpus drift; run npm run bootstrap:tar-candidate');
  }
  if (committed.recordsDigest !== expected.recordsDigest || committed.groupsDigest !== expected.groupsDigest) {
    throw new Error('TAR candidate digest drift');
  }
  for (const record of committed.records as TarCandidateRecord[]) {
    if (record.origin !== 'tar' || !record.sourceCaseId || !record.sourceRefs.length) {
      throw new Error(record.id + ': missing TAR provenance');
    }
  }
  return committed;
}

async function main() {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  if (process.argv.includes('--bootstrap')) {
    const doc = await buildTarCandidateCorpus(rootDir);
    await mkdir(dirname(resolve(rootDir, TAR_CANDIDATE_CORPUS)), { recursive: true });
    await writeFile(resolve(rootDir, TAR_CANDIDATE_CORPUS), JSON.stringify(doc, null, 2) + '\n');
    console.log('TAR candidate bootstrap wrote ' + doc.records.length + ' cases / ' + doc.groups.length + ' conflict groups; digest ' + doc.recordsDigest);
    return;
  }
  const doc = await validateTarCandidateCorpus(rootDir);
  console.log('TAR candidate OK: ' + doc.records.length + ' cases / ' + doc.groups.length + ' conflict groups / dropped ' + doc.accounting.dropped);
}

if (process.argv[1]?.endsWith('tar-candidate.ts')) await main();

