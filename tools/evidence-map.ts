import type { BrowserPackLayerContext } from './browser-pack-compiler.ts';
import { encodeSection } from './browser-pack-encoding.ts';
import type { BrowserPackShardDescriptor } from './browser-pack-model.ts';
import type { OrthographyKnowledgeGraph } from './orthography-knowledge-model.ts';
import { RULE_KINDS, RULE_STAGES, type RuleIR } from './rule-ir.ts';

// #208 §10–§11 / #211 G — evidence separated from the hot runtime.
//
// Hot sections keep only integer handles (factIndex / ProgramId). Everything a diagnostic needs to
// explain a result lives in two lazy, cold section families:
//
//   program-evidence  ProgramId -> IR rule id, human-readable evidence type, stage/kind, canonical ids
//   evidence-map      canonical id (fact / rule / binding) -> kind, source records + dispositions
//                     (the canonical source accounting ledger), source snapshots, period, ProgramIds
//
// Every Program traces to canonical ids, and every canonical id resolves to at least one source record
// (directly, through the bindings of a rule node, or — for project rules — through a registered source);
// anything else fails the build closed.

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface EvidenceEntry {
  canonicalId: string;
  kind: 'fact' | 'rule' | 'binding';
  sourceRecords: string[];
  dispositions: string[];
  sourceSnapshots: string[];
  periodRefs: string[];
  programs: number[];
}

export function buildEvidence(graph: OrthographyKnowledgeGraph, ir: RuleIR) {
  const ledger = new Map<string, Array<{ record: string; disposition: string }>>();
  for (const d of graph.dispositions) for (const t of d.targetIds) ledger.set(t, [...(ledger.get(t) ?? []), { record: d.sourceRecordId, disposition: d.disposition }]);
  const sources = new Set(graph.sources.map((s) => String(s.sourceId)));
  const snapshotOf = (record: string) => { const at = record.indexOf('#'); return at < 0 ? record : record.slice(0, at); };
  const programsOf = new Map<string, number[]>();
  ir.rules.forEach((r, id) => { for (const c of r.canonicalIds) programsOf.set(c, [...(programsOf.get(c) ?? []), id]); });
  const bindingsOfRule = new Map<string, string[]>();
  for (const b of graph.bindings) bindingsOfRule.set(b.ruleId, [...(bindingsOfRule.get(b.ruleId) ?? []), b.id]);

  const entries: EvidenceEntry[] = [];
  const add = (canonicalId: string, kind: EvidenceEntry['kind'], periodRefs: string[], sourceRefs: string[]) => {
    let rows = ledger.get(canonicalId) ?? [];
    // a rule node is accounted through the source records of the bindings that instantiate it
    if (!rows.length && kind === 'rule') rows = (bindingsOfRule.get(canonicalId) ?? []).flatMap((b) => ledger.get(b) ?? []);
    const registered = sourceRefs.filter((s) => sources.has(s));
    if (!rows.length && !registered.length) throw new Error(`evidence: ${canonicalId} has neither a source record nor a registered source`);
    const records = [...new Set(rows.map((r) => r.record))].sort(cmp);
    entries.push({
      canonicalId, kind,
      sourceRecords: records.length ? records : registered.map((s) => `${s}#project-rule`),
      dispositions: [...new Set(rows.map((r) => r.disposition))].sort(cmp),
      sourceSnapshots: [...new Set([...records.map(snapshotOf), ...registered])].sort(cmp),
      periodRefs: [...periodRefs].sort(cmp),
      programs: [...(programsOf.get(canonicalId) ?? [])].sort((a, b) => a - b)
    });
  };
  for (const f of graph.facts) add(f.id, 'fact', f.periodRefs ?? [], f.sourceRefs);
  for (const r of graph.rules) add(r.id, 'rule', typeof r.predicate?.period === 'string' ? [`period:${r.predicate.period}`] : [], r.sourceRefs);
  for (const b of graph.bindings) add(b.id, 'binding', [], b.sourceRefs);
  entries.sort((a, b) => cmp(a.canonicalId, b.canonicalId));

  const known = new Set(entries.map((e) => e.canonicalId));
  ir.rules.forEach((r, id) => {
    if (!r.canonicalIds.length) throw new Error(`evidence: Program ${id} (${r.ruleId}) has no canonical id`);
    for (const c of r.canonicalIds) if (!known.has(c)) throw new Error(`evidence: Program ${id} names unknown canonical id ${c}`);
  });
  const programs = ir.rules.map((r) => ({ ruleId: r.ruleId, evidenceType: r.evidenceType, stage: r.stage, kind: r.kind, canonicalIds: [...r.canonicalIds] }));
  return { entries, programs };
}

const pad = (n: number) => String(n).padStart(8, '0');

/** Pack layer emitting the lazy evidence sections (v3). */
export function evidenceLayer(ir: RuleIR, options: { entriesPerShard?: number; programsPerShard?: number } = {}) {
  return ({ graph, add }: BrowserPackLayerContext): void => {
    const { entries, programs } = buildEvidence(graph, ir);
    // evidence id = row of the canonical-id-sorted evidence map (shards are contiguous id ranges)
    const evidenceId = new Map(entries.map((e, i) => [e.canonicalId, i]));
    const strings = () => { const values = ['']; const ids = new Map<string, number>(); return { values, id: (s: string) => { let i = ids.get(s); if (i === undefined) { i = values.length; values.push(s); ids.set(s, i); } return i; } }; };
    const split = (record: string) => { const at = record.indexOf('#'); return at < 0 ? [record, ''] as const : [record.slice(0, at), record.slice(at + 1)] as const; };
    const perEntry = options.entriesPerShard ?? 4096;
    const entryShards = Math.max(1, Math.ceil(entries.length / perEntry));
    for (let i = 0; i < entryShards; i += 1) {
      const rows = entries.slice(i * perEntry, (i + 1) * perEntry);
      const s = strings();
      const shard: BrowserPackShardDescriptor = { key: 'canonical', index: i, count: entryShards, from: rows[0]!.canonicalId, to: rows[rows.length - 1]!.canonicalId };
      add('evidence-map', encodeSection([
        { name: 'canonicalId', kind: 'scalar', values: rows.map((r) => s.id(r.canonicalId)) },
        { name: 'kind', kind: 'scalar', values: rows.map((r) => ['fact', 'rule', 'binding'].indexOf(r.kind)) },
        // a source record is `snapshot#local`: the snapshot is a shared string, the local part per record
        { name: 'recordSnapshot', kind: 'list', values: rows.map((r) => r.sourceRecords.map((x) => s.id(split(x)[0]))) },
        { name: 'recordLocal', kind: 'list', values: rows.map((r) => r.sourceRecords.map((x) => s.id(split(x)[1]))) },
        { name: 'dispositions', kind: 'list', values: rows.map((r) => r.dispositions.map(s.id)) },
        { name: 'sourceSnapshots', kind: 'list', values: rows.map((r) => r.sourceSnapshots.map(s.id)) },
        { name: 'periodRefs', kind: 'list', values: rows.map((r) => r.periodRefs.map(s.id)) },
        { name: 'programs', kind: 'list', values: rows.map((r) => r.programs) },
        { name: 'strings', kind: 'strings', values: s.values }
      ]), { shard, rowCount: rows.length });
    }
    const perProgram = options.programsPerShard ?? 16384;
    const programShards = Math.max(1, Math.ceil(programs.length / perProgram));
    for (let i = 0; i < programShards; i += 1) {
      const first = i * perProgram;
      const rows = programs.slice(first, first + perProgram);
      const s = strings();
      const shard: BrowserPackShardDescriptor = { key: 'program', index: i, count: programShards, from: pad(first), to: pad(first + rows.length - 1) };
      add('program-evidence', encodeSection([
        { name: 'evidenceType', kind: 'scalar', values: rows.map((r) => s.id(r.evidenceType)) },
        { name: 'stage', kind: 'scalar', values: rows.map((r) => RULE_STAGES.indexOf(r.stage as typeof RULE_STAGES[number])) },
        { name: 'ruleKind', kind: 'scalar', values: rows.map((r) => RULE_KINDS.indexOf(r.kind as typeof RULE_KINDS[number])) },
        { name: 'evidence', kind: 'list', values: rows.map((r) => r.canonicalIds.map((c) => evidenceId.get(c)!)) },
        { name: 'strings', kind: 'strings', values: s.values }
      ]), { shard, rowCount: rows.length });
    }
  };
}
