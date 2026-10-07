import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildAcceptedBrowserPackV3 } from './generate-browser-pack.ts';
import { KINOTCH_PROFILE } from './orthography-policy.ts';
import { TAR_PARITY_FIXTURE, type TarParityCase } from './tar-parity.ts';
import { normalizeCheckoutText } from './verification-text.ts';

const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');

export const TAR_RUNTIME_PARITY_REPORT = 'data/reports/tar-runtime-parity.json';
export const TAR_RUNTIME_PARITY_SUMMARY = 'data/reports/tar-runtime-parity-summary.json';

export type RuntimeParityStatus =
  | 'PASS'
  | 'FAIL'
  | 'CONTEXT_REQUIRED'
  | 'CANDIDATE_REQUIRED'
  | 'PATTERN_REQUIRED'
  | 'DISABLED';

interface FixtureDocument {
  schemaVersion: string;
  kind: string;
  originVocabulary: string[];
  accounting: { fixtureRecords: number };
  records: TarParityCase[];
}

interface RuntimeParityRecord {
  caseId: string;
  origin: 'kinotch' | 'tar';
  status: RuntimeParityStatus;
  family: string;
  input: string;
  expectedOutputs: string[];
  actualOutput: string | null;
  actualCandidates: string[] | null;
  sourceKind: TarParityCase['sourceKind'];
  sourceEnabled: boolean | null;
  sourceRefs: TarParityCase['sourceRefs'];
  reason: string | null;
}

const hasPayload = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return String(value).trim().length > 0;
};

const familyOf = (record: TarParityCase): string => {
  if (record.nodePath.length > 0) return record.nodePath.join(' > ');
  const flat = record.sourceRefs.find((ref) => ref.kind === 'flat');
  return flat?.groupLabel || flat?.sourceCategory || 'flat-only';
};

const requiresContext = (record: TarParityCase): boolean =>
  Boolean(record.ruleType)
  || hasPayload(record.conditions)
  || hasPayload(record.sequence)
  || hasPayload(record.matchOptions)
  || hasPayload(record.matchTarget);

const preStatus = (record: TarParityCase): RuntimeParityStatus | null => {
  if (record.sourceEnabled === false) return 'DISABLED';
  if (record.regex || record.wildcard) return 'PATTERN_REQUIRED';
  if (record.expectedOutputs.length !== 1) return 'CANDIDATE_REQUIRED';
  if (requiresContext(record)) return 'CONTEXT_REQUIRED';
  return null;
};

const counts = <T extends string>(values: readonly T[]): Record<T, number> => {
  const out = {} as Record<T, number>;
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
};

type WitnessToken = {
  surface_form: string;
  basic_form: string;
  pos: string;
  pos_detail_1: string;
  pos_detail_2: string;
  pos_detail_3: string;
  conjugated_type: string;
  conjugated_form: string;
  reading: string;
  pronunciation: string;
  word_type: string;
};

const firstPositive = (value: unknown): string | undefined => {
  const values = Array.isArray(value)
    ? value.flatMap((entry) => typeof entry === 'string' ? entry.split(',') : [entry])
    : typeof value === 'string' ? value.split(',') : [value];
  for (const entry of values) {
    if (entry === undefined || entry === null) continue;
    const text = String(entry).trim();
    if (!text || (text.startsWith('-') && !text.startsWith('\\-'))) continue;
    return text.startsWith('\\-') ? text.slice(1) : text;
  }
  return undefined;
};

const firstCondition = (value: unknown): Record<string, unknown> | null => {
  if (Array.isArray(value)) {
    const found = value.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
    return found ? found as Record<string, unknown> : null;
  }
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
};

const tokenFromCondition = (condition: Record<string, unknown> | null, fallbackSurface: string): WitnessToken => ({
  surface_form: firstPositive(condition?.surface_form ?? condition?.surface) ?? fallbackSurface,
  basic_form: firstPositive(condition?.basic_form ?? condition?.basic) ?? fallbackSurface,
  pos: firstPositive(condition?.pos) ?? '',
  pos_detail_1: firstPositive(condition?.pos_detail_1 ?? condition?.pos1) ?? '',
  pos_detail_2: firstPositive(condition?.pos_detail_2 ?? condition?.pos2) ?? '',
  pos_detail_3: firstPositive(condition?.pos_detail_3 ?? condition?.pos3) ?? '',
  conjugated_type: firstPositive(condition?.conjugated_type ?? condition?.ctype) ?? '',
  conjugated_form: firstPositive(condition?.conjugated_form ?? condition?.cform) ?? '',
  reading: firstPositive(condition?.reading) ?? '',
  pronunciation: firstPositive(condition?.pronunciation) ?? '',
  word_type: firstPositive(condition?.word_type) ?? ''
});

const matcherValues = (value: unknown): string[] => {
  const raw = Array.isArray(value)
    ? value.flatMap((entry) => typeof entry === 'string' ? entry.split(',') : [entry])
    : typeof value === 'string' ? value.split(',') : [value];
  return raw.filter((entry) => entry !== undefined && entry !== null)
    .map((entry) => String(entry).trim()).filter(Boolean);
};

const matcherAllows = (actual: string, expected: unknown): boolean => {
  if (expected === undefined || expected === null) return true;
  const values = matcherValues(expected);
  const negative = values
    .filter((value) => value.startsWith('-') && !value.startsWith('\\-'))
    .map((value) => value.slice(1));
  if (negative.includes(actual)) return false;
  const positive = values
    .filter((value) => !value.startsWith('-') || value.startsWith('\\-'))
    .map((value) => value.startsWith('\\-') ? value.slice(1) : value);
  return positive.length === 0 || positive.includes(actual);
};

const conditionBranches = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)) as Record<string, unknown>[];
  }
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
};

const sourceStrictBasicUnreachable = (record: TarParityCase): boolean => {
  const conditions = record.conditions && typeof record.conditions === 'object'
    ? record.conditions as Record<string, unknown> : {};
  const current = conditionBranches(conditions.current);
  const strict = record.matchTarget === 'basic_form'
    || record.ruleType === 'verb'
    || record.ruleType === 'adjective'
    || current.some((condition) => condition.basic !== undefined || condition.basic_form !== undefined);
  if (!strict || current.length === 0) return false;
  return current.every((condition) => !matcherAllows(
    record.from,
    condition.basic_form ?? condition.basic
  ));
};

const contextApplicabilityKey = (record: TarParityCase): string => JSON.stringify({
  from: record.from,
  ruleType: record.ruleType,
  conditions: record.conditions,
  sequence: record.sequence,
  matchOptions: record.matchOptions,
  matchTarget: record.matchTarget
});

export const tokenWindowWitness = (record: TarParityCase) => {
  const conditions = record.conditions && typeof record.conditions === 'object'
    ? record.conditions as Record<string, unknown> : {};
  const sequence = Array.isArray(record.sequence) ? record.sequence as Record<string, unknown>[] : null;
  let tokens: WitnessToken[];
  let index = 0;
  if (sequence?.length) {
    const current = firstCondition(conditions.current);
    tokens = sequence.map((condition, sequenceIndex) => {
      const merged = sequenceIndex === 0 && current ? { ...current, ...condition } : condition;
      return tokenFromCondition(merged, firstPositive(condition.surface_form ?? condition.surface) ?? '');
    });
  } else {
    const current = firstCondition(conditions.current);
    const token = tokenFromCondition(current, record.from);
    if ((record.matchTarget === 'basic_form' || record.ruleType === 'verb' || record.ruleType === 'adjective') && !token.basic_form) {
      token.basic_form = record.from;
    }
    if (record.matchTarget === 'basic_form' || record.ruleType === 'verb' || record.ruleType === 'adjective') token.basic_form = record.from;
    if (record.ruleType === 'verb' && !token.pos) token.pos = '動詞';
    if (record.ruleType === 'adjective' && !token.pos) token.pos = '形容詞';
    tokens = [token];
  }
  const prev = firstCondition(conditions.prev);
  if (prev) {
    tokens.unshift(tokenFromCondition(prev, '__prev__'));
    index += 1;
  }
  const next = firstCondition(conditions.next);
  if (next) tokens.push(tokenFromCondition(next, '__next__'));
  return { tokens, index };
};


export const candidateOutputsOfProgramTrace = (result: any, input: string): string[] => {
  const outputs: string[] = [];
  for (const run of result?.programTrace?.runs ?? []) {
    if (run?.start !== 0 || run?.end !== input.length) continue;
    if (run?.stage !== 'profile' || run?.direction !== 'to-modern' || run?.channel !== 'surface') continue;
    for (const edge of run?.edges ?? []) {
      if (edge?.candidate === true && typeof edge.output === 'string') outputs.push(edge.output);
    }
  }
  return [...new Set(outputs)].sort((a, b) => a.localeCompare(b, 'ja'));
};

const sameCandidateSet = (actual: readonly string[], expected: readonly string[]): boolean => {
  const left = [...new Set(actual)].sort((a, b) => a.localeCompare(b, 'ja'));
  const right = [...new Set(expected)].sort((a, b) => a.localeCompare(b, 'ja'));
  return left.length === right.length && left.every((value, index) => value === right[index]);
};

export async function buildTarRuntimeParityArtifacts(rootDir: string) {
  const fixture = JSON.parse(await readFile(resolve(rootDir, TAR_PARITY_FIXTURE), 'utf8')) as FixtureDocument;
  if (fixture.accounting.fixtureRecords !== fixture.records.length) throw new Error('TAR runtime parity fixture count mismatch');
  if (fixture.records.some((record) => record.origin !== 'kinotch' && record.origin !== 'tar')) {
    throw new Error('TAR runtime parity encountered unknown origin');
  }

  const tentative = new Map<string, RuntimeParityStatus | null>();
  for (const record of fixture.records) tentative.set(record.id, preStatus(record));

  // If several otherwise-simple active TAR intents share one naked input but disagree on output,
  // a bare input cannot prove which old rule wins. Keep the case for the precedence/candidate gate.
  const simpleByInput = new Map<string, TarParityCase[]>();
  for (const record of fixture.records) {
    if (tentative.get(record.id) !== null) continue;
    const rows = simpleByInput.get(record.from) ?? [];
    rows.push(record);
    simpleByInput.set(record.from, rows);
  }
  const conflictInputs = new Set<string>();
  for (const [input, rows] of simpleByInput) {
    const outputs = new Set(rows.flatMap((record) => record.expectedOutputs));
    if (outputs.size > 1) conflictInputs.add(input);
  }

  const executable = fixture.records.filter((record) =>
    tentative.get(record.id) === null && !conflictInputs.has(record.from)
  );
  const uniqueInputs = [...new Set(executable.map((record) => record.from))].sort((a, b) => a.localeCompare(b, 'ja'));

  const build = await buildAcceptedBrowserPackV3(rootDir);
  const service = createTransformService({
    executionMode: 'vm-authoritative',
    openPack: async () => openBrowserPack(build.manifest, async (section: { path: string }) => {
      const body = build.files.get(section.path);
      if (!body) throw new Error('missing in-memory BrowserPack section ' + section.path);
      return body;
    })
  });

  const actualByInput = new Map<string, string>();
  const actualByContextCase = new Map<string, string>();
  const actualByCandidateCase = new Map<string, { renderedText: string; candidates: string[] }>();
  let requestId = 0;
  for (const input of uniqueInputs) {
    const reply = await service.handle({
      type: 'transform',
      requestId: ++requestId,
      text: input,
      profileId: KINOTCH_PROFILE.profileId,
      renderMode: 'plain',
      executionMode: 'vm-authoritative'
    });
    if (reply?.type !== 'result') throw new Error('runtime parity execution failed for ' + JSON.stringify(input) + ': ' + (reply?.message ?? 'unknown error'));
    actualByInput.set(input, String(reply.result?.renderedText ?? ''));
    if (requestId % 250 === 0) console.log('TAR runtime parity executed ' + requestId + '/' + uniqueInputs.length + ' unique simple inputs');
  }
  const contextRecords = fixture.records.filter((record) => tentative.get(record.id) === 'CONTEXT_REQUIRED');
  const contextByApplicability = new Map<string, TarParityCase[]>();
  for (const record of contextRecords) {
    const key = contextApplicabilityKey(record);
    contextByApplicability.set(key, [...(contextByApplicability.get(key) ?? []), record]
      .sort((left, right) => (Number(right.priority) || 0) - (Number(left.priority) || 0) || left.id.localeCompare(right.id)));
  }
  const higherPriorityShadow = new Map<string, TarParityCase>();
  for (const record of contextRecords) {
    const higher = (contextByApplicability.get(contextApplicabilityKey(record)) ?? [])
      .find((candidate) => (Number(candidate.priority) || 0) > (Number(record.priority) || 0));
    if (higher) higherPriorityShadow.set(record.id, higher);
  }
  for (const record of contextRecords) {
    const reply = await service.handle({
      type: 'transform',
      requestId: ++requestId,
      text: record.from,
      profileId: KINOTCH_PROFILE.profileId,
      renderMode: 'plain',
      executionMode: 'vm-authoritative',
      tokenWindow: tokenWindowWitness(record)
    });
    if (reply?.type !== 'result') throw new Error('context runtime parity execution failed for ' + record.id + ': ' + (reply?.message ?? 'unknown error'));
    actualByContextCase.set(record.id, String(reply.result?.renderedText ?? ''));
    if (actualByContextCase.size % 100 === 0) console.log('TAR context parity executed ' + actualByContextCase.size + '/' + contextRecords.length);
  }

  const executeCandidate = async (record: TarParityCase, tokenWindow?: ReturnType<typeof tokenWindowWitness>) => {
    const reply = await service.handle({
      type: 'transform',
      requestId: ++requestId,
      text: record.from,
      profileId: KINOTCH_PROFILE.profileId,
      renderMode: 'plain',
      executionMode: 'vm-authoritative',
      ...(tokenWindow ? { tokenWindow } : {})
    });
    if (reply?.type !== 'result') throw new Error('candidate runtime parity execution failed for ' + record.id + ': ' + (reply?.message ?? 'unknown error'));
    return {
      renderedText: String(reply.result?.renderedText ?? ''),
      candidates: candidateOutputsOfProgramTrace(reply.result, record.from)
    };
  };

  // Otherwise-simple same-input conflicts are one candidate group per naked input.
  for (const input of [...conflictInputs].sort((a, b) => a.localeCompare(b, 'ja'))) {
    const members = simpleByInput.get(input) ?? [];
    if (!members.length) throw new Error('missing conflict members for ' + input);
    const observed = await executeCandidate(members[0]!);
    for (const member of members) actualByCandidateCase.set(member.id, observed);
  }

  // Explicit source alternatives retain their own typed applicability witness.
  const explicitCandidates = fixture.records.filter((record) => tentative.get(record.id) === 'CANDIDATE_REQUIRED');
  for (const record of explicitCandidates) {
    const observed = await executeCandidate(record, requiresContext(record) ? tokenWindowWitness(record) : undefined);
    actualByCandidateCase.set(record.id, observed);
  }
  if (actualByCandidateCase.size !== 165) {
    throw new Error('expected 165 candidate cases to execute, got ' + actualByCandidateCase.size);
  }
  if (service.opens() !== 1) throw new Error('TAR runtime parity must reuse one BrowserPack instance');

  const records: RuntimeParityRecord[] = fixture.records.map((record) => {
    let status: RuntimeParityStatus | null = tentative.get(record.id) ?? null;
    let actualOutput: string | null = null;
    let actualCandidates: string[] | null = null;
    let reason: string | null = null;

    if (status === null && conflictInputs.has(record.from)) {
      const observed = actualByCandidateCase.get(record.id);
      if (!observed) throw new Error('missing candidate runtime result for ' + record.id);
      const expected = [...new Set((simpleByInput.get(record.from) ?? []).flatMap((member) => member.expectedOutputs))];
      actualOutput = observed.renderedText;
      actualCandidates = observed.candidates;
      status = sameCandidateSet(actualCandidates, expected) ? 'PASS' : 'FAIL';
      reason = status === 'PASS'
        ? 'same-input TAR intent group preserved as an unresolved candidate set'
        : 'runtime candidate set differs from same-input TAR intent group';
    } else if (status === null) {
      actualOutput = actualByInput.get(record.from) ?? null;
      if (actualOutput === null) throw new Error('missing runtime result for ' + record.id);
      status = record.expectedOutputs.includes(actualOutput) ? 'PASS' : 'FAIL';
      if (status === 'FAIL') reason = 'vm-authoritative plain output differs from TAR expected output';
    } else if (status === 'CONTEXT_REQUIRED') {
      actualOutput = actualByContextCase.get(record.id) ?? null;
      if (actualOutput === null) throw new Error('missing context runtime result for ' + record.id);
      const unreachable = sourceStrictBasicUnreachable(record);
      const shadow = higherPriorityShadow.get(record.id);
      if (record.expectedOutputs.includes(actualOutput)) {
        status = 'PASS';
      } else if (unreachable) {
        status = 'PASS';
        reason = 'legacy source rule is unreachable: strict basic-form match conflicts with its current basic-form condition; fail-closed no-op preserved';
      } else if (shadow && shadow.expectedOutputs.includes(actualOutput)) {
        status = 'PASS';
        reason = 'legacy source rule is shadowed by higher-priority context rule ' + shadow.id;
      } else {
        status = 'FAIL';
        reason = 'vm-authoritative output under the source-derived token witness differs from TAR expected output';
      }
    } else if (status === 'CANDIDATE_REQUIRED') {
      const observed = actualByCandidateCase.get(record.id);
      if (!observed) throw new Error('missing explicit candidate runtime result for ' + record.id);
      actualOutput = observed.renderedText;
      actualCandidates = observed.candidates;
      if (record.expectedOutputs.length === 0) {
        status = actualCandidates.length === 0 && actualOutput.length > 0 ? 'PASS' : 'FAIL';
        reason = status === 'PASS'
          ? 'review-needed empty replacement intent remains fail-closed: no runtime deletion rule or candidate was admitted'
          : 'review-needed empty replacement intent unexpectedly became a runtime deletion or candidate';
      } else {
        status = sameCandidateSet(actualCandidates, record.expectedOutputs) ? 'PASS' : 'FAIL';
        reason = status === 'PASS'
          ? 'source alternative set preserved by vm-authoritative candidate semantics'
          : 'vm-authoritative candidate set differs from TAR source alternatives';
      }
    } else if (status === 'PATTERN_REQUIRED') {
      reason = 'TAR rule requires regex/wildcard pattern semantics';
    } else if (status === 'DISABLED') {
      reason = 'TAR source rule is disabled';
    }

    if (status === null) throw new Error('TAR runtime parity status remained unresolved for ' + record.id);

    return {
      caseId: record.id,
      origin: record.origin,
      status,
      family: familyOf(record),
      input: record.from,
      expectedOutputs: record.expectedOutputs,
      actualOutput,
      actualCandidates,
      sourceKind: record.sourceKind,
      sourceEnabled: record.sourceEnabled,
      sourceRefs: record.sourceRefs,
      reason
    };
  });

  const statusCounts = counts(records.map((record) => record.status));
  const familyFail: Record<string, number> = {};
  for (const record of records) if (record.status === 'FAIL') familyFail[record.family] = (familyFail[record.family] ?? 0) + 1;
  const familyFailSorted = Object.fromEntries(Object.entries(familyFail).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')));

  const report = {
    schemaVersion: '1',
    kind: 'tar-runtime-parity',
    owner: 'japanese-orthography#285',
    finalExecutionParity: false,
    sourceFixture: TAR_PARITY_FIXTURE,
    baseline: {
      profileId: KINOTCH_PROFILE.profileId,
      executionMode: 'vm-authoritative',
      browserPackCompilerVersion: build.manifest.compilerVersion,
      browserPackDigest: build.manifest.packDigest
    },
    accounting: {
      fixtureRecords: fixture.records.length,
      reportRecords: records.length,
      dropped: fixture.records.length - records.length,
      uniqueSimpleInputsExecuted: uniqueInputs.length,
      contextCasesExecuted: contextRecords.length,
      contextSourceUnreachable: records.filter((record) => record.reason?.startsWith('legacy source rule is unreachable:')).length,
      contextShadowedByHigherPriority: records.filter((record) => record.reason?.startsWith('legacy source rule is shadowed by higher-priority')).length,
      candidateCasesExecuted: actualByCandidateCase.size,
      candidateConflictGroupsExecuted: conflictInputs.size,
      candidateReviewRequired: records.filter((record) => record.reason?.startsWith('review-needed empty replacement intent')).length,
      executableCasesTested: records.filter((record) => record.status === 'PASS' || record.status === 'FAIL').length,
      conflictingSimpleInputsDeferred: 0
    },
    statuses: statusCounts,
    familyFail: familyFailSorted,
    records
  };

  const summary = {
    schemaVersion: '1',
    kind: 'tar-runtime-parity-summary',
    owner: 'japanese-orthography#285',
    finalExecutionParity: false,
    requiredNextGates: [
      ...(statusCounts.CONTEXT_REQUIRED ? ['context-parity'] : []),
      ...(statusCounts.CANDIDATE_REQUIRED ? ['candidate-parity'] : []),
      ...(statusCounts.PATTERN_REQUIRED ? ['pattern-parity'] : []),
      ...(statusCounts.FAIL ? ['runtime-fail-repair'] : [])
    ],
    sourceFixtureDigest: createHash('sha256').update(JSON.stringify(fixture.records)).digest('hex'),
    reportDigest: createHash('sha256').update(JSON.stringify(records)).digest('hex'),
    baseline: report.baseline,
    accounting: report.accounting,
    statuses: report.statuses,
    familyFail: report.familyFail,
    origins: counts(records.map((record) => record.origin))
  };

  return {
    report,
    summary,
    texts: {
      [TAR_RUNTIME_PARITY_REPORT]: JSON.stringify(report, null, 2) + '\n',
      [TAR_RUNTIME_PARITY_SUMMARY]: JSON.stringify(summary, null, 2) + '\n'
    }
  };
}

async function main(): Promise<void> {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const artifacts = await buildTarRuntimeParityArtifacts(rootDir);
  if (artifacts.report.accounting.fixtureRecords !== 4036) throw new Error('expected 4036 TAR parity fixture records');
  if (artifacts.report.accounting.dropped !== 0) throw new Error('TAR runtime parity dropped fixture records');

  if (process.argv.includes('--check')) {
    for (const [path, text] of Object.entries(artifacts.texts)) {
      const committed = normalizeCheckoutText(await readFile(resolve(rootDir, path), 'utf8'));
      if (committed !== text) throw new Error('stale ' + path + '; run npm run generate:tar-runtime-parity');
    }
    console.log('TAR runtime parity OK: ' + artifacts.report.accounting.reportRecords + ' cases; statuses ' + JSON.stringify(artifacts.summary.statuses));
    return;
  }

  for (const [path, text] of Object.entries(artifacts.texts)) {
    await mkdir(dirname(resolve(rootDir, path)), { recursive: true });
    await writeFile(resolve(rootDir, path), text);
  }
  console.log(JSON.stringify(artifacts.summary, null, 2));
}

if (process.argv[1]?.endsWith('tar-runtime-parity.ts')) await main();
