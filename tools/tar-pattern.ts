import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TAR_PARITY_COMMIT, TAR_PARITY_FIXTURE, type TarParityCase } from './tar-parity.ts';

export const TAR_PATTERN_CORPUS = 'data/migrations/tar/' + TAR_PARITY_COMMIT + '/pattern-rules.json';
const SOURCE_SETTINGS = 'data/sources/txt-auto-replace/' + TAR_PARITY_COMMIT + '/transform-settings (8).json';

export interface TarPatternRecord {
  sourceCaseId: string;
  sourceRuleId: string;
  locator: string;
  from: string;
  rawTo: string;
  expectedPatterns: string[];
  regex: boolean;
  wildcard: boolean;
  priority: number;
  sourceEnabled: boolean;
  conditions: unknown;
  ruleType: string | null;
  matchOptions: unknown;
  matchTarget: unknown;
  sequence: unknown;
}

const read = async (root: string, path: string) =>
  JSON.parse(await readFile(resolve(root, path), 'utf8'));

const expandOutputPatterns = (raw: string, regex: boolean): string[] => {
  if (regex) return [raw];
  const opening = raw.indexOf('['), closing = raw.indexOf(']', opening + 1);
  if (opening < 0 || closing < 0) return [raw];
  const alternatives = raw.slice(opening + 1, closing).split(',');
  if (alternatives.some((alternative) => !alternative)) throw new Error('empty TAR bracket alternative');
  return alternatives.map((alternative) => raw.slice(0, opening) + alternative + raw.slice(closing + 1));
};

export async function buildTarPatternCorpus(root: string) {
  const settings = await read(root, SOURCE_SETTINGS);
  const fixture = await read(root, TAR_PARITY_FIXTURE);
  const sourceCases = (fixture.records as TarParityCase[]).filter((record) =>
    record.sourceEnabled !== false && (record.regex || record.wildcard));
  if (sourceCases.length !== 7) throw new Error('TAR pattern lane must have exactly seven source cases');
  const casesById = new Map(sourceCases.map((record) => [record.id, record]));
  const records: TarPatternRecord[] = [];

  const visit = (nodes: any[], prefix: string, active = true) => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i], locator = prefix + '[' + i + ']';
      const enabled = active && node.enabled !== false;
      for (const bucket of ['entries', 'rules']) {
        for (const [j, rule] of (node[bucket] ?? []).entries()) {
          const regex = rule.regex === true || rule.is_regex === true;
          const wildcard = !regex && typeof rule.from === 'string' && /(?<!\\)\*/u.test(rule.from);
          if (!regex && !wildcard) continue;
          const id = 'tar:structured:' + rule.id + ':from[0]';
          const source = casesById.get(id);
          if (!source || source.from !== rule.from || source.rawTo !== rule.to) {
            throw new Error('pattern source/fixture mismatch: ' + id);
          }
          const expectedPatterns = expandOutputPatterns(String(rule.to), regex);
          if (JSON.stringify(expectedPatterns) !== JSON.stringify(source.expectedOutputs)) {
            throw new Error('pattern alternative expansion differs from accepted fixture: ' + id);
          }
          records.push({
            sourceCaseId: id,
            sourceRuleId: rule.id,
            locator: locator + '.' + bucket + '[' + j + ']',
            from: rule.from,
            rawTo: rule.to,
            expectedPatterns,
            regex,
            wildcard,
            priority: rule.priority,
            sourceEnabled: enabled && rule.enabled !== false,
            conditions: rule.conditions ?? null,
            ruleType: rule.type ?? null,
            matchOptions: rule.match_options ?? null,
            matchTarget: rule.match_target ?? null,
            sequence: rule.sequence ?? null
          });
        }
      }
      visit(node.children ?? [], locator + '.children', enabled);
    }
  };
  visit(settings.roots ?? [], 'roots');
  records.sort((a, b) => a.sourceCaseId.localeCompare(b.sourceCaseId, 'en'));
  if (records.length !== 7 || new Set(records.map((record) => record.sourceCaseId)).size !== 7) {
    throw new Error('TAR pattern source accounting drift');
  }
  if (records.some((record) => !record.sourceEnabled)
    || records.filter((record) => record.wildcard).length !== 6
    || records.filter((record) => record.regex).length !== 1) {
    throw new Error('TAR pattern enabled/type accounting drift');
  }
  return {
    schemaVersion: '1',
    kind: 'tar-pattern-rules',
    owner: 'japanese-orthography#291',
    sourceCommit: TAR_PARITY_COMMIT,
    sourcePath: 'transform-settings (8).json',
    origin: 'tar',
    profileId: 'kinotch-fixed',
    accounting: { sourceCases: 7, wildcard: 6, regex: 1, dropped: 0 },
    records
  };
}

export async function validateTarPatternCorpus(root: string) {
  const [derived, committed] = await Promise.all([
    buildTarPatternCorpus(root), read(root, TAR_PATTERN_CORPUS)
  ]);
  if (JSON.stringify(committed) !== JSON.stringify(derived)) {
    throw new Error('TAR pattern corpus drift against pinned source/fixture');
  }
  return committed as typeof derived;
}

if (process.argv[1]?.endsWith('tar-pattern.ts')) {
  const root = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const corpus = await validateTarPatternCorpus(root);
  console.log('TAR pattern corpus OK:', corpus.records.length, 'wildcard 6 / regex 1 / dropped 0');
}
