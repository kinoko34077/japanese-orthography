import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadJmdictIntake, type JmdictEntry } from './jmdict-intake.ts';
import { lexemeKeys } from './jmdict-lexical-graph.ts';
import { createSinoDagRuntime, projectSinoDag } from './sino-dag-projection.ts';
import type { EntityGraph } from './lexical-entity-graph.ts';

// Phase 4.8F: join lexical identity to the accepted Phase-4.6/4.7 historical authority (#138).
//
// "Dictionary data identifies what lexical entity is present; Phase 4.6/4.7 evidence decides which
// historical form is justified." JMdict multi-form grouping is surfaced as lexical-equivalence
// evidence only and never becomes a historical candidate. Readings come from whole-word source
// authority when it exists, otherwise from reverse traversal of the shared 4.6E convergence DAG,
// keeping every admissible predecessor (context may prune; nothing is defaulted).

export const LEXICAL_JOIN_PATH = 'data/historical/phase48f-lexical-authority-join.json';
const INTAKE_FILES = [
  'phase46b-character-form', 'phase46c-homophone-rewrite', 'phase46d-native-kana',
  'phase46e-sino-kana', 'phase46-legacy-safety', 'phase46f-kinotch-profile'
] as const;

export interface IntakeRecord {
  id: string; responsibility: string; disposition: string; modernSurface?: string;
  historicalSurface?: string; alternatives?: string[]; modernReading?: string; historicalReading?: string;
  evidenceRefs?: string[]; sourceRef?: string;
}

type Scope = 'lexeme' | 'symbol' | 'profile';
const scopeOf = (r: IntakeRecord): Scope => {
  if (r.responsibility.startsWith('kinotch_') || r.id.startsWith('phase46f')) return 'profile';
  if (r.responsibility === 'lexical_historical_kanji' || r.responsibility === 'historical_kana_native') return 'lexeme';
  return 'symbol';
};

export interface JoinSources {
  createdDate: string;
  entries: JmdictEntry[];
  intake: Record<string, IntakeRecord[]>;
  sinoRelations: Parameters<typeof projectSinoDag>[0];
  wholeWordReadings: { surface: string; modernReading: string; historicalReading: string; id: string }[];
}

export async function loadJoinSources(rootDir: string): Promise<JoinSources> {
  const { extract, accounting } = await loadJmdictIntake(rootDir);
  const intake: Record<string, IntakeRecord[]> = {};
  for (const file of INTAKE_FILES) {
    intake[file] = JSON.parse(await readFile(resolve(rootDir, `data/intake/${file}.json`), 'utf8')).records;
  }
  const sino = JSON.parse(await readFile(resolve(rootDir, 'data/historical/sino/phase46e-sino-kana.json'), 'utf8'));
  const wholeWordReadings = (sino.identitySlice.sourceRecords as Record<string, any>[])
    .filter((r) => r.enabled && r.file === 'kana-jisyo' && r.modernReading)
    .map((r) => ({ surface: r.surface, modernReading: r.modernReading, historicalReading: r.historicalReading, id: `kkh:${r.id}` }));
  return { createdDate: accounting.createdDate, entries: extract, intake, sinoRelations: sino.componentRelations, wholeWordReadings };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const uniq = (values: Iterable<string>) => [...new Set(values)].sort(cmp);

function lexemeIndex(entries: readonly JmdictEntry[]) {
  const keys = lexemeKeys(entries);
  const byForm = new Map<string, string[]>();
  const formsOf = new Map<string, string[]>();
  const readingsOf = new Map<string, Map<string, string[]>>();
  for (const e of entries) {
    const lexeme = `lexeme:${keys.get(e.seq)!}`;
    const forms = (e.k ?? []).map((k) => k.t);
    formsOf.set(lexeme, forms);
    const readingMap = new Map<string, string[]>();
    for (const r of e.r) readingMap.set(r.t, r.nokanji ? [] : (r.restr ?? forms));
    readingsOf.set(lexeme, readingMap);
    for (const f of forms) byForm.set(f, [...(byForm.get(f) ?? []), lexeme]);
    if (!forms.length) for (const r of e.r) byForm.set(r.t, [...(byForm.get(r.t) ?? []), lexeme]);
  }
  for (const [k, v] of byForm) byForm.set(k, uniq(v));
  return { byForm, formsOf, readingsOf };
}

// Generated join artifact: every accepted intake record bound to its lexical scope.
export function buildLexicalAuthorityJoin(sources: JoinSources, sinoGraph: EntityGraph) {
  const { byForm } = lexemeIndex(sources.entries);
  const patternIds = new Set<string>(sinoGraph.convergencePatterns.map((p) => p.id));
  const records: (string | string[] | null)[][] = [];
  const summary: Record<string, Record<string, number>> = {};
  for (const file of INTAKE_FILES) {
    for (const r of sources.intake[file]!) {
      const scope = scopeOf(r);
      let status: string;
      let targets: string[] = [];
      if (scope === 'profile') status = 'profile_scope';
      else if (r.disposition === 'excluded_unresolved') status = 'excluded';
      else if (scope === 'lexeme') {
        targets = byForm.get(r.modernSurface ?? '') ?? [];
        status = targets.length === 0 ? 'unbound' : targets.length === 1 ? 'unique' : 'homograph';
      } else {
        targets = [`symbol:${r.modernSurface}`];
        if (r.responsibility === 'historical_kana_sino') {
          const pattern = `pattern:${r.historicalReading}>${r.modernReading}`;
          if (!patternIds.has(pattern)) throw new Error(`${r.id}: missing convergence pattern ${pattern}`);
          targets.push(pattern);
        }
        status = 'symbol';
      }
      records.push([r.id, scope, r.disposition, status, targets]);
      (summary[file] ??= {})[status] = (summary[file]![status] ?? 0) + 1;
    }
  }
  records.sort((a, b) => cmp(a[0] as string, b[0] as string));
  return {
    schemaVersion: '1',
    kind: 'phase48f-lexical-authority-join',
    owner: 'japanese-orthography#138',
    jmdictSnapshot: sources.createdDate,
    columns: ['intakeRecordId', 'scope', 'disposition', 'joinStatus', 'targets'],
    note: 'Bindings scope accepted Phase-4.6 authority to typed lexical entities; they add no historical authority. homograph = several JMdict lexemes share the form (no lexeme is chosen).',
    summary,
    records
  };
}

export interface HistoryQuery { form: string; reading: string; context?: string | null }

export function createLexicalHistoryResolver(sources: JoinSources) {
  const index = lexemeIndex(sources.entries);
  const sinoGraph = projectSinoDag(sources.sinoRelations, 'phase46e-sino-table');
  const dag = createSinoDagRuntime(sinoGraph);
  const patternIds = new Set<string>(sinoGraph.convergencePatterns.map((p) => p.id));
  const patternBase = new Map<string, string | null>(sinoGraph.convergencePatterns.map((p) => [p.id, p.base ?? null]));
  const written = new Map<string, IntakeRecord[]>();
  for (const file of ['phase46c-homophone-rewrite', 'phase46d-native-kana'] as const) {
    for (const r of sources.intake[file]!) if (r.modernSurface) written.set(r.modernSurface, [...(written.get(r.modernSurface) ?? []), r]);
  }

  const writtenFormAuthority = (form: string) => {
    const records = (written.get(form) ?? []).filter((r) => r.disposition !== 'excluded_unresolved');
    if (records.length === 0) return null;
    const candidates = uniq(records.flatMap((r) => (r.historicalSurface ? [r.historicalSurface] : r.alternatives ?? [])));
    const exact = records.every((r) => r.disposition === 'admitted') && candidates.length === 1;
    return {
      status: exact ? 'resolved' : 'candidates',
      basis: exact ? 'source_exact' : 'source_candidates',
      candidates,
      intakeRecords: uniq(records.map((r) => r.id)),
      evidenceRefs: uniq(records.flatMap((r) => r.evidenceRefs ?? []))
    };
  };

  // Component reuse: a lexeme whose form starts/ends with an authority-bearing lexical form
  // (reading-aligned through JMdict) inherits that component's written-form authority.
  const composedWrittenForm = (form: string, reading: string) => {
    const chars = Array.from(form);
    for (let k = chars.length - 1; k >= 1; k -= 1) {
      for (const [head, tail, headFirst] of [[chars.slice(0, k).join(''), chars.slice(k).join(''), true], [chars.slice(chars.length - k).join(''), chars.slice(0, chars.length - k).join(''), false]] as const) {
        const authority = writtenFormAuthority(head);
        if (!authority) continue;
        const headReadings = (index.byForm.get(head) ?? []).flatMap((l) => [...(index.readingsOf.get(l)?.entries() ?? [])].filter(([, f]) => f.includes(head)).map(([r]) => r));
        const tailReadings = (index.byForm.get(tail) ?? []).flatMap((l) => [...(index.readingsOf.get(l)?.entries() ?? [])].filter(([, f]) => f.includes(tail)).map(([r]) => r));
        const aligned = headReadings.some((hr) => tailReadings.some((tr) => (headFirst ? hr + tr : tr + hr) === reading));
        if (!aligned) continue;
        return {
          status: authority.status,
          basis: authority.status === 'resolved' ? 'generated_productive_span' : 'source_candidates',
          candidates: authority.candidates.map((c) => (headFirst ? c + tail : tail + c)),
          component: head,
          intakeRecords: authority.intakeRecords,
          evidenceRefs: authority.evidenceRefs
        };
      }
    }
    return null;
  };

  const readingHistory = (form: string, reading: string, context: string | null | undefined) => {
    const whole = sources.wholeWordReadings.filter((w) => w.surface === form && w.modernReading === reading);
    const query = context === undefined ? {} : { context };
    const reconstructed = dag.reconstructWord(form, reading, query);
    const crossCheck = reconstructed ? ('historicalReading' in reconstructed ? [reconstructed.historicalReading] : reconstructed.historicalReadings) : [];
    if (whole.length > 0) {
      const historical = uniq(whole.map((w) => w.historicalReading));
      return { route: 'whole-word-source', status: historical.length === 1 ? 'resolved' : 'candidates', basis: historical.length === 1 ? 'source_exact' : 'source_candidates', historical, sourceRecords: uniq(whole.map((w) => w.id)), dagCrossCheck: crossCheck };
    }
    if (!reconstructed) return { route: 'none', status: 'unresolved', basis: 'unresolved', historical: [] as string[] };
    if (reconstructed.status === 'candidates') {
      return { route: 'sino-dag', status: 'candidates', basis: 'source_candidates', historical: reconstructed.historicalReadings };
    }
    const components = reconstructed.components.map((c) => {
      const pattern = `pattern:${c.historicalReading}>${c.modernReading}`;
      return { ...c, pattern: patternIds.has(pattern) ? pattern : null, basePattern: patternIds.has(pattern) ? patternBase.get(pattern) ?? null : null };
    });
    return {
      route: 'sino-dag', status: 'resolved',
      // composed from component table authority: generated, not whole-word attested
      basis: 'generated_productive_span',
      historical: [reconstructed.historicalReading], components, evidenceRefs: reconstructed.evidenceRefs
    };
  };

  const resolveHistory = (query: HistoryQuery) => {
    const lexemes = (index.byForm.get(query.form) ?? []).filter((l) => index.readingsOf.get(l)?.get(query.reading)?.includes(query.form) || !index.formsOf.get(l)!.length);
    const equivalents = uniq(lexemes.flatMap((l) => index.formsOf.get(l) ?? []).filter((f) => f !== query.form));
    return {
      form: query.form,
      modernReading: query.reading,
      lexemes,
      // JMdict grouping: equivalence evidence only, never a historical candidate
      lexicalEquivalents: equivalents,
      writtenForm: writtenFormAuthority(query.form) ?? composedWrittenForm(query.form, query.reading),
      reading: readingHistory(query.form, query.reading, query.context)
    };
  };

  return { resolveHistory, sinoGraph };
}
