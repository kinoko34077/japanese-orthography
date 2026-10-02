import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { BrowserPackBuild } from './browser-pack-compiler.ts';
import { buildAcceptedBrowserPack, buildAcceptedBrowserPackV2 } from './generate-browser-pack.ts';
import type { OrthographyFact, OrthographyKnowledgeGraph, OrthographyRule } from './orthography-knowledge-model.ts';
import { withProfileRules } from './orthography-policy.ts';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';

// #196 A — capability-utilization baseline of BrowserPack v1. Measures how much of the canonical v2
// knowledge the v1 Pages transform path actually executes, versus only stores (lookup/detail) or does
// not carry at all. This report is the comparison oracle for #196 J; it measures and never changes
// semantics (the planner's `trace` option is a read-only seam).
//
//   npm run measure:browser-capability            -> writes the report
//   npm run measure:browser-capability -- --check -> recomputes and requires the committed report

export const BROWSER_CAPABILITY_REPORT = 'data/reports/browser-capability-utilization-v1.json';
export const BROWSER_CAPABILITY_REPORT_V2 = 'data/reports/browser-capability-utilization-v2.json';

const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { planAndTransform } = require('../runtime/browser-span-planner.js');
const { createBrowserLexicalRuntime } = require('../runtime/browser-lexical-runtime.js');
const { transformWithResolver } = require('../runtime/browser-resolver-adapter.js');
const { summarize } = require('../runtime/browser-diagnostic-contract.js');

export interface CapabilityProbe { readonly id: string; readonly text: string; readonly covers: readonly string[] }

/** Representative probes required by #196 A (surface, reading, Ruby, candidate set, profile, unknown). */
export const CAPABILITY_PROBES: readonly CapabilityProbe[] = [
  { id: 'surface:学校', text: '学校', covers: ['surface', 'historical_kanji'] },
  { id: 'reading:がっこう', text: 'がっこう', covers: ['reading'] },
  { id: 'surface:今日', text: '今日', covers: ['surface', 'jukujikun'] },
  { id: 'reading:ドイツ', text: 'ドイツ', covers: ['reading', 'candidate_set'] },
  { id: 'reading:みる', text: 'みる', covers: ['reading', 'homophone'] },
  { id: 'surface:分かる', text: '分かる', covers: ['surface', 'profile_style'] },
  { id: 'surface:台風', text: '台風', covers: ['surface', 'contextual'] },
  { id: 'surface:装丁', text: '装丁', covers: ['surface', 'candidate_set'] },
  { id: 'ruby:学校', text: '｜学校《がっこう》', covers: ['ruby'] },
  { id: 'ruby:今日', text: '｜今日《きょう》', covers: ['ruby'] },
  { id: 'mixed:unknown', text: 'abc 😀 溶接 𠮷野家 zzz', covers: ['unknown', 'ascii', 'emoji', 'surrogate'] }
];

export const CAPABILITY_PROFILES = ['modern', 'historical', 'kinotch-fixed'] as const;

type FactRoute = 'transform_candidate' | 'context_required_only' | 'safety_constraint' | 'lookup_only' | 'not_in_pack';

/** Static v1 route of a canonical fact. Mirrors the v1 compiler key choice and planner promotion. */
export function factRoute(fact: OrthographyFact): FactRoute {
  const key = fact.surface ?? fact.reading;
  if (key === undefined) return 'not_in_pack';
  const tags = fact.tags ?? [];
  if (tags.some((t) => t.startsWith('safety:'))) return 'safety_constraint';
  if (fact.kind === 'form_relation' && fact.target !== undefined && fact.surface !== fact.target) {
    return tags.some((t) => t.startsWith('context:')) ? 'context_required_only' : 'transform_candidate';
  }
  return 'lookup_only';
}

/** Static v1 executability of a rule (character rules and exact-token profile rules only). */
export function ruleRoute(rule: OrthographyRule): 'char_rule' | 'exact_token_rule' | 'not_executed' {
  const p = (rule.predicate ?? {}) as Record<string, unknown>;
  if (p.channel === 'surface' && p.exactToken === true) return 'exact_token_rule';
  if (rule.class === 'orthographic' && p.channel === 'surface' && !p.exactToken && !p.mechanism && rule.from.length === 1 && rule.to.length === 1 && rule.directionality === 'reverse_traversable') return 'char_rule';
  return 'not_executed';
}

const inc = (table: Record<string, number>, key: string, by = 1) => { table[key] = (table[key] ?? 0) + by; };
const sortKeys = <T>(table: Record<string, T>) => Object.fromEntries(Object.entries(table).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export async function measureCapabilityUtilization(graph: OrthographyKnowledgeGraph, build: BrowserPackBuild, probes = CAPABILITY_PROBES, profiles: readonly string[] = CAPABILITY_PROFILES) {
  // ---- static coverage over the canonical graph -------------------------------------------------
  const factsByKind: Record<string, Record<string, number>> = {};
  const executableLexemes = new Set<string>();
  const storedLexemes = new Set<string>();
  const allLexemes = new Set<string>();
  for (const fact of graph.facts) {
    const route = factRoute(fact);
    const row = (factsByKind[fact.kind] ??= { total: 0 });
    inc(row, 'total'); inc(row, route);
    for (const ref of fact.lexicalRefs) {
      allLexemes.add(ref);
      if (route !== 'not_in_pack') storedLexemes.add(ref);
      if (route === 'transform_candidate' || route === 'safety_constraint') executableLexemes.add(ref);
    }
  }
  const lookupKeys = new Set(graph.facts.flatMap((f) => [f.surface ?? f.reading, f.kind === 'form_relation' ? f.target : undefined]).filter((k): k is string => k !== undefined));
  const readings = new Set(graph.facts.filter((f) => f.kind === 'literal_reading' && f.reading !== undefined).map((f) => f.reading!));
  const readingsAsKeys = [...readings].filter((r) => lookupKeys.has(r)).length;
  const rulesByClass: Record<string, Record<string, number>> = {};
  for (const rule of graph.rules) { const row = (rulesByClass[rule.class] ??= { total: 0 }); inc(row, 'total'); inc(row, ruleRoute(rule)); }

  // ---- dynamic probes through the real v1 transform path ----------------------------------------
  const eagerBytes = build.manifest.sections.filter((s) => s.loading === 'eager').reduce((n, s) => n + s.byteLength, 0);
  const probeRows = [];
  const totals = { reachedFacts: new Set<number>(), promotedFacts: new Set<number>(), acceptedFacts: new Set<number>() };
  for (const probe of probes) {
    for (const profileId of profiles) {
      let requests = 0;
      let bytes = 0;
      const pack = await openBrowserPack(build.manifest, async (s: { path: string }) => {
        const body = build.files.get(s.path)!;
        requests += 1; bytes += body.byteLength;
        return body;
      });
      const eager = { requests, bytes };
      const raw = await planAndTransform(pack, probe.text, profileId, { trace: true });
      const t = raw.trace;
      const reached = new Map<number, string>(t.matchedFacts.map((m: { factIndex: number; kind: string }) => [m.factIndex, m.kind]));
      const reachedByKind: Record<string, number> = {};
      for (const kind of reached.values()) inc(reachedByKind, kind);
      const acceptedKeys = new Set<string>(t.accepted);
      const candidatesByOrigin: Record<string, number> = {};
      for (const c of t.candidates) inc(candidatesByOrigin, c.origin);
      const blockedByReason: Record<string, number> = {};
      for (const b of t.blocked) inc(blockedByReason, b.reason);
      const promoted = new Set<number>(t.candidates.filter((c: { factIndex: number | null }) => c.factIndex !== null).map((c: { factIndex: number }) => c.factIndex));
      const winnerFacts = t.candidates.filter((c: { key: string; factIndex: number | null }) => acceptedKeys.has(c.key) && c.factIndex !== null).map((c: { factIndex: number }) => c.factIndex);
      for (const f of reached.keys()) totals.reachedFacts.add(f);
      for (const f of promoted) totals.promotedFacts.add(f);
      for (const f of winnerFacts) totals.acceptedFacts.add(f);
      probeRows.push({
        probeId: probe.id, profileId, text: probe.text, covers: probe.covers,
        renderedText: raw.renderedText,
        changed: raw.renderedText !== probe.text,
        lexicalMatches: raw.lexicalMatchCount,
        reachedFacts: reached.size,
        reachedFactsByKind: sortKeys(reachedByKind),
        promotedFacts: promoted.size,
        lookupOnlyReachedFacts: [...reached.keys()].filter((f) => !promoted.has(f) && !t.contextual.some((c: { factIndex: number }) => c.factIndex === f)).length,
        contextualFacts: t.contextual.length,
        candidates: t.candidates.length,
        candidatesByOrigin: sortKeys(candidatesByOrigin),
        enteredArbitration: t.candidates.length,
        accepted: t.accepted.length,
        blocked: t.blocked.length,
        blockedByReason: sortKeys(blockedByReason),
        unresolved: t.unresolved.length,
        spanStates: raw.spans.map((s: { sourceText: string; state: string; renderedText: string }) => `${s.sourceText}:${s.state}:${s.renderedText}`),
        sectionRequests: { eager: eager.requests, onDemand: requests - eager.requests, total: requests },
        transferredBytes: { eager: eager.bytes, onDemand: bytes - eager.bytes, total: bytes }
      });
    }
  }

  return {
    schemaVersion: '1',
    kind: 'browser-capability-utilization',
    owner: 'japanese-orthography#196 A',
    packDigest: build.manifest.packDigest,
    lexicalNamespaceId: graph.lexicalNamespaceId,
    canonical: {
      facts: graph.facts.length,
      rules: graph.rules.length,
      bindings: graph.bindings.length,
      factsByKindAndV1Route: sortKeys(factsByKind),
      rulesByClassAndV1Route: sortKeys(rulesByClass),
      lexicalIdentities: {
        total: allLexemes.size,
        storedInPack: storedLexemes.size,
        withExecutableFact: executableLexemes.size,
        storedButNotExecutable: storedLexemes.size - executableLexemes.size
      },
      readings: {
        distinctLiteralReadings: readings.size,
        reachableAsLookupKey: readingsAsKeys,
        readingIndexInV1: false,
        note: 'v1 keys facts by surface (else reading); there is no reading -> lexeme -> forms route, so a kana reading only reaches facts that happen to be keyed by that exact string.'
      }
    },
    probes: {
      eagerBytes,
      profiles: [...profiles],
      rows: probeRows,
      distinctFactsReached: totals.reachedFacts.size,
      distinctFactsPromoted: totals.promotedFacts.size,
      distinctFactsAccepted: totals.acceptedFacts.size
    },
    gaps: [
      'reading/kana input does not reach lexeme forms (no reading index / lexeme join)',
      'Ruby syntax is not parsed: base and ruby text are rewritten independently as plain characters (no Ruby evidence, no late render)',
      'literal_form / literal_reading facts are lookup/detail data only, never transform inputs',
      'morphology is not available to the browser planner',
      'KiNoTch profile executes exact-token rules only (no style overlay such as 分かる -> 分る)'
    ]
  };
}

export type CapabilityReport = Awaited<ReturnType<typeof measureCapabilityUtilization>>;

/**
 * #196 J — the same probes through the BrowserPack v2 resolver path, compared row by row with the
 * committed v1 oracle (#196 A): what each probe now recognizes, resolves and changes.
 */
export async function measureCapabilityUtilizationV2(build: BrowserPackBuild, v1: CapabilityReport, probes = CAPABILITY_PROBES, profiles: readonly string[] = CAPABILITY_PROFILES) {
  const rows = [];
  for (const probe of probes) {
    for (const profileId of profiles) {
      let requests = 0;
      let bytes = 0;
      const pack = await openBrowserPack(build.manifest, async (s: { path: string }) => { const body = build.files.get(s.path)!; requests += 1; bytes += body.byteLength; return body; });
      const eager = { requests, bytes };
      const lexical = createBrowserLexicalRuntime(pack);
      const raw = await transformWithResolver(pack, lexical, probe.text, profileId, { renderMode: 'plain' });
      const summary = summarize(raw);
      const units = raw.units ?? [];
      const identities = new Set<string>(units.flatMap((u: any) => [u.unit.lexicalIdentity, ...u.unit.lexicalCandidates.map((c: any) => c.lexicalIdentity)].filter(Boolean)));
      const before = v1.probes.rows.find((r) => r.probeId === probe.id && r.profileId === profileId)!;
      const whole = units.find((u: any) => u.start === 0 && u.end === probe.text.length)?.unit ?? null;
      rows.push({
        probeId: probe.id, profileId, text: probe.text, covers: probe.covers, engine: raw.engine,
        renderedText: raw.renderedText,
        changed: raw.renderedText !== probe.text,
        recognizedUnits: units.length,
        resolvedUnits: units.filter((u: any) => u.unit.kind === 'resolved').length,
        lexicalIdentitiesReached: identities.size,
        wholeInputUnit: whole && { kind: whole.kind, lexicalIdentity: whole.lexicalIdentity, reading: whole.reading, readingSource: whole.readingSource, candidates: whole.lexicalCandidates.length, historicalKana: whole.historical.kana, historicalRoute: whole.historical.route, disposition: whole.historical.disposition },
        spansByCertainty: summary.counts,
        inspectableUnchangedUnits: summary.units.length,
        sectionRequests: { eager: eager.requests, onDemand: requests - eager.requests },
        transferredBytes: { eager: eager.bytes, onDemand: bytes - eager.bytes },
        v1: { renderedText: before.renderedText, changed: before.changed, reachedFacts: before.reachedFacts, promotedFacts: before.promotedFacts, sectionRequests: before.sectionRequests.onDemand, transferredBytes: before.transferredBytes.onDemand }
      });
    }
  }
  // v1 exposed no lexical identity, reading evidence or morphology for any probe: a recognized whole
  // input unit (identity, candidates, Ruby/kana reading evidence) is capability v1 did not have
  const gained = rows.filter((r) => r.wholeInputUnit !== null).map((r) => `${r.probeId}/${r.profileId}`);
  return {
    schemaVersion: '1',
    kind: 'browser-capability-utilization-v2',
    owner: 'japanese-orthography#196 J',
    packDigest: build.manifest.packDigest,
    oracle: { report: BROWSER_CAPABILITY_REPORT, packDigest: v1.packDigest },
    rows,
    summary: {
      rows: rows.length,
      outputChangedVsV1: rows.filter((r) => r.renderedText !== r.v1.renderedText).length,
      rubyEvidenceRows: rows.filter((r) => r.wholeInputUnit?.readingSource === 'ruby-word').length,
      wholeInputRecognized: rows.filter((r) => r.wholeInputUnit).length,
      lexicalIdentitiesReached: rows.reduce((n, r) => n + r.lexicalIdentitiesReached, 0),
      capabilityGained: gained
    }
  };
}

async function main() {
  const root = resolve(import.meta.dirname, '..');
  const { graph } = await normalizeAcceptedOrthographySources(root);
  const build = await buildAcceptedBrowserPack(root);
  const report = await measureCapabilityUtilization(withProfileRules(graph), build);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  const path = resolve(root, BROWSER_CAPABILITY_REPORT);
  if (process.argv.includes('--check')) {
    const committed = (await readFile(path, 'utf8')).replace(/\r\n/g, '\n');
    if (committed !== text) { console.error(`${BROWSER_CAPABILITY_REPORT} is stale; run npm run measure:browser-capability`); process.exit(1); }
    console.log(`${BROWSER_CAPABILITY_REPORT} OK`);
    return;
  }
  await writeFile(path, text);
  console.log(`wrote ${BROWSER_CAPABILITY_REPORT}: ${report.probes.rows.length} probe rows, ${report.canonical.facts} facts`);
  if (process.argv.includes('--v2')) {
    const v2 = await measureCapabilityUtilizationV2(await buildAcceptedBrowserPackV2(root, graph), report);
    await writeFile(resolve(root, BROWSER_CAPABILITY_REPORT_V2), `${JSON.stringify(v2, null, 2)}\n`);
    console.log(`wrote ${BROWSER_CAPABILITY_REPORT_V2}: ${v2.summary.outputChangedVsV1} rows changed output vs v1, ${v2.summary.wholeInputRecognized} whole-input units recognized`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) await main();
