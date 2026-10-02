import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { KnowledgeOrigin, OrthographyKnowledgeGraph } from './orthography-knowledge-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE, resolveProjectionPolicy, withProfileRules, type OrthographyProfilePolicy } from './orthography-policy.ts';
import { normalizeAcceptedOrthographySources } from './orthography-source-normalization.ts';

// #208 §3–§4 / #211 D — Executable Rule IR.
//
// Every executable transformation of the accepted knowledge becomes one typed Rule. Canonical evidence
// keeps its distinctions (literal fact vs productive rule vs project style ...), but execution sees one
// shape: input -> applicability (scope / channel / predicate / profile) -> output branches -> next stage.
//
//   literal facts      -> exact one-step rules (variants = output branches; nothing is generalised)
//   productive rules   -> reusable rule nodes (+ binding-scoped instances, e.g. 字音 はふ -> ほう @ 法)
//   contextual facts   -> exact rules with a lexical-binding / context predicate
//   preserve facts     -> preserve rules (identity; block rewriting)
//   profile rules      -> profile-stage rules enabled only by the profiles that enable them
//   render rules       -> render-stage rules
//
// The compiler orders rules by stage, then by declared dependencies inside a stage, and fails closed
// on a dangling dependency or a cycle. Every rule carries the canonical ids it was compiled from, so
// a runtime Program can always be traced back to evidence (#208 §10).

export const RULE_STAGES = ['lexical', 'semantic', 'diachronic', 'orthographic', 'profile', 'render'] as const;
export type RuleStage = typeof RULE_STAGES[number];
export const RULE_KINDS = ['exact', 'productive', 'contextual', 'preserve', 'deterministic-char', 'profile-style', 'render'] as const;
export type RuleKind = typeof RULE_KINDS[number];
export const RULE_DIRECTIONS = ['to-historical', 'to-modern', 'reconstruct'] as const;
export type RuleDirection = typeof RULE_DIRECTIONS[number];
export const RULE_SCOPES = ['exact-surface', 'exact-reading', 'whole-token', 'symbol', 'anywhere'] as const;
export type RuleScope = typeof RULE_SCOPES[number];

/** `lexicalRefs`: the lexemes this output belongs to (provenance / inspection), never an applicability test. */
export interface IRBranch { output: string; candidate: boolean; canonicalId: string; lexicalRefs?: string[] }

export interface IRRule {
  /** stable IR id (derived from the canonical ids it was compiled from) */
  ruleId: string;
  kind: RuleKind;
  stage: RuleStage;
  direction: RuleDirection;
  channel: 'surface' | 'reading';
  scope: RuleScope;
  input: string;
  /** one branch per alternative; several branches = candidates, never a silent winner */
  branches: IRBranch[];
  /** applicability scope: the rule applies only where these lexemes / symbols are in play */
  lexicalScope: string[];
  predicate: { context?: string; usage?: string; period?: string; constraint?: string } | null;
  origin: KnowledgeOrigin;
  /** profiles whose policy leaves this rule enabled (graph rules only; facts are always available) */
  enabledBy: string[] | null;
  dependsOn: string[];
  /** canonical fact / rule / binding ids (evidence handles) */
  canonicalIds: string[];
  /** human-readable evidence type (debug/evidence side; never needed by the executor) */
  evidenceType: string;
}

export interface RuleIR { rules: IRRule[]; order: string[]; digest: string }

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const KANA = /^[ぁ-ゟ゠-ヿ]+$/u;

export function compileRuleIR(graph: OrthographyKnowledgeGraph, profiles: readonly OrthographyProfilePolicy[] = [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE]): RuleIR {
  const grouped = new Map<string, IRRule>();
  const add = (key: string, make: () => Omit<IRRule, 'branches' | 'canonicalIds'>, branch: IRBranch) => {
    let rule = grouped.get(key);
    if (!rule) { rule = { ...make(), branches: [], canonicalIds: [] }; grouped.set(key, rule); }
    if (!rule.branches.some((b) => b.output === branch.output && b.canonicalId === branch.canonicalId)) rule.branches.push(branch);
    if (!rule.canonicalIds.includes(branch.canonicalId)) rule.canonicalIds.push(branch.canonicalId);
  };

  for (const f of graph.facts) {
    const tags = f.tags ?? [];
    const origin = f.origin ?? 'historically_attested';
    const candidate = tags.includes('candidate');
    const constraint = tags.find((t) => t.startsWith('context:'))?.slice('context:'.length);
    if (f.kind === 'form_relation' && f.surface !== undefined && f.target !== undefined) {
      if (tags.some((t) => t.startsWith('safety:'))) {
        add(`preserve|${f.surface}`, () => ({
          ruleId: '', kind: 'preserve', stage: 'semantic', direction: 'to-historical', channel: 'surface', scope: 'whole-token', input: f.surface!,
          lexicalScope: [...f.lexicalRefs], predicate: constraint ? { constraint } : null, origin, enabledBy: null, dependsOn: [], evidenceType: tags.find((t) => t.startsWith('safety:'))!
        }), { output: f.surface, candidate: false, canonicalId: f.id });
        continue;
      }
      if (f.surface === f.target) continue;
      const kana = KANA.test(f.surface) && KANA.test(f.target);
      const kind: RuleKind = constraint ? 'contextual' : 'exact';
      const scope: RuleScope = kana ? 'exact-reading' : 'exact-surface';
      const stage: RuleStage = kana ? 'diachronic' : constraint ? 'semantic' : 'orthographic';
      const evidenceType = tags.find((t) => !t.startsWith('context:') && t !== 'candidate') ?? 'form_relation';
      // one relation, two directed exact rules: modern -> historical, historical -> modern
      // only a context constraint binds a relation to its lexemes (accepted adapter semantics, #196 D);
      // otherwise the lexemes are provenance of the output branch
      const scoped = constraint ? [...f.lexicalRefs] : [];
      for (const [direction, input, output] of [['to-historical', f.target, f.surface], ['to-modern', f.surface, f.target]] as const) {
        add(`${kind}|${direction}|${scope}|${input}|${constraint ?? ''}|${scoped.join(',')}`, () => ({
          ruleId: '', kind, stage, direction, channel: kana ? 'reading' : 'surface', scope, input,
          lexicalScope: scoped, predicate: constraint ? { constraint } : null, origin, enabledBy: null, dependsOn: [], evidenceType
        }), { output, candidate, canonicalId: f.id, lexicalRefs: [...f.lexicalRefs] });
      }
    } else if (f.kind === 'literal_reading' && f.reading !== undefined) {
      const historical = f.periodRefs?.includes('period:historical-kana') ?? false;
      if (historical && f.surface !== undefined) {
        // the historical reading of a written form: one-step exact rule, Ruby output
        add(`exact|to-historical|reading|${f.surface}|${f.lexicalRefs.join(',')}`, () => ({
          ruleId: '', kind: 'exact', stage: 'diachronic', direction: 'to-historical', channel: 'reading', scope: 'exact-surface', input: f.surface!,
          lexicalScope: [...f.lexicalRefs], predicate: null, origin, enabledBy: null, dependsOn: [], evidenceType: tags[0] ?? 'historical_reading'
        }), { output: f.reading, candidate, canonicalId: f.id });
      } else if (!historical && f.surface !== undefined) {
        // dictionary mapping as an exact rule: a modern reading reconstructs its written forms (ドイツ -> 独逸 / 独乙)
        add(`exact|reconstruct|${f.reading}`, () => ({
          ruleId: '', kind: 'exact', stage: 'lexical', direction: 'reconstruct', channel: 'reading', scope: 'exact-reading', input: f.reading!,
          lexicalScope: [], predicate: null, origin, enabledBy: null, dependsOn: [], evidenceType: 'lexical_reading'
        }), { output: f.surface, candidate: false, canonicalId: f.id, lexicalRefs: [...f.lexicalRefs] });
      }
    }
  }

  // ---- graph rules + bindings ----------------------------------------------------------------------
  const disabledBy = new Map<string, Set<string>>();
  for (const p of profiles) for (const id of resolveProjectionPolicy(p, graph).disabledRuleIds ?? []) {
    const set = disabledBy.get(id) ?? new Set<string>();
    set.add(p.profileId);
    disabledBy.set(id, set);
  }
  const enabledBy = (id: string) => profiles.map((p) => p.profileId).filter((p) => !disabledBy.get(id)?.has(p));
  const ruleIr = new Map<string, IRRule>();
  for (const r of graph.rules) {
    const p = (r.predicate ?? {}) as Record<string, unknown>;
    const channel = p.channel === 'reading' ? 'reading' : 'surface';
    let kind: RuleKind;
    let stage: RuleStage;
    let scope: RuleScope;
    if (r.origin === 'project_defined' || r.origin === 'kinotch_derived') { kind = 'profile-style'; stage = 'profile'; scope = p.exactToken ? 'whole-token' : 'anywhere'; }
    else if (r.class === 'render') { kind = 'render'; stage = 'render'; scope = 'anywhere'; }
    else if (r.class === 'orthographic' && channel === 'surface' && r.from.length === 1 && r.to.length === 1 && !p.mechanism) { kind = 'deterministic-char'; stage = 'orthographic'; scope = 'anywhere'; }
    // reading-channel productive rules (字音 / kana conventions / sino mechanisms) form one diachronic derivation
    else { kind = 'productive'; stage = channel === 'reading' ? 'diachronic' : 'orthographic'; scope = p.scope === 'sino-component' ? 'symbol' : 'anywhere'; }
    const dependsOn = [...r.dependencies, ...(typeof p.modernStem === 'string' ? [p.modernStem] : [])];
    const ir: IRRule = {
      ruleId: r.id, kind, stage, direction: r.directionality === 'forward_only' ? 'to-modern' : 'to-historical', channel, scope,
      input: r.to.join('|'), branches: r.from.map((output) => ({ output, candidate: r.from.length > 1 && r.lossiness !== 'lossless', canonicalId: r.id })),
      lexicalScope: [], predicate: typeof p.period === 'string' ? { period: p.period } : null, origin: r.origin ?? 'historically_attested',
      enabledBy: enabledBy(r.id), dependsOn, canonicalIds: [r.id], evidenceType: `${r.class}/${r.directionality}/${r.lossiness}`
    };
    // project/style and render rules read from -> to (forward); attested reverse-traversable rules project to historical
    if (kind === 'profile-style' || r.directionality === 'forward_only') {
      ir.input = r.from.join('|');
      ir.branches = r.to.map((output) => ({ output, candidate: r.to.length > 1, canonicalId: r.id }));
    }
    ruleIr.set(r.id, ir);
  }
  for (const b of graph.bindings) {
    const base = ruleIr.get(b.ruleId);
    if (!base) throw new Error(`binding ${b.id}: unknown rule ${b.ruleId}`);
    const usage = (b.contextRefs ?? []).find((c) => c.startsWith('context:usage:'))?.slice('context:usage:'.length);
    ruleIr.set(b.id, {
      ...base, ruleId: b.id, scope: 'symbol', lexicalScope: [...b.lexicalRefs], predicate: usage ? { usage } : null,
      dependsOn: [b.ruleId], canonicalIds: [b.id, b.ruleId], evidenceType: `binding/${base.evidenceType}`,
      branches: base.branches.map((x) => ({ ...x, canonicalId: b.id }))
    });
  }

  // ---- ids, ordering, verification -------------------------------------------------------------------
  const facts = [...grouped.values()].map((r) => {
    r.branches.sort((a, b) => cmp(a.output, b.output) || cmp(a.canonicalId, b.canonicalId));
    r.canonicalIds.sort(cmp);
    r.lexicalScope.sort(cmp);
    r.ruleId = `ir:${r.kind}:${r.direction}:${createHash('sha256').update(JSON.stringify([r.scope, r.channel, r.input, r.predicate, r.lexicalScope])).digest('hex').slice(0, 16)}`;
    return r;
  });
  const rules = [...facts, ...ruleIr.values()];
  const ids = new Set<string>();
  for (const r of rules) {
    if (ids.has(r.ruleId)) throw new Error(`duplicate IR rule id ${r.ruleId}`);
    ids.add(r.ruleId);
    if (!r.branches.length) throw new Error(`IR rule ${r.ruleId} has no output branch`);
    if (!r.canonicalIds.length) throw new Error(`IR rule ${r.ruleId} is not traceable to canonical evidence`);
  }
  const order = orderRules(rules);
  rules.sort((a, b) => order.get(a.ruleId)! - order.get(b.ruleId)!);
  const digest = createHash('sha256').update(JSON.stringify(rules)).digest('hex');
  return { rules, order: rules.map((r) => r.ruleId), digest };
}

/** Stage order, then dependencies inside the stage (Kahn, ties by id); fails closed. */
export function orderRules(rules: readonly IRRule[]): Map<string, number> {
  const byId = new Map(rules.map((r) => [r.ruleId, r]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const r of rules) {
    indegree.set(r.ruleId, indegree.get(r.ruleId) ?? 0);
    for (const dep of r.dependsOn) {
      const target = byId.get(dep);
      if (!target) throw new Error(`IR rule ${r.ruleId} depends on unknown rule ${dep}`);
      if (RULE_STAGES.indexOf(target.stage) > RULE_STAGES.indexOf(r.stage)) throw new Error(`IR rule ${r.ruleId} (${r.stage}) depends on later-stage rule ${dep} (${target.stage})`);
      indegree.set(r.ruleId, (indegree.get(r.ruleId) ?? 0) + 1);
      dependents.set(dep, [...(dependents.get(dep) ?? []), r.ruleId]);
    }
  }
  const ready = rules.filter((r) => indegree.get(r.ruleId) === 0).map((r) => r.ruleId);
  const key = (id: string) => [RULE_STAGES.indexOf(byId.get(id)!.stage), id] as const;
  const sortReady = () => ready.sort((a, b) => key(a)[0] - key(b)[0] || cmp(a, b));
  sortReady();
  const order = new Map<string, number>();
  while (ready.length) {
    const id = ready.shift()!;
    order.set(id, order.size);
    let changed = false;
    for (const next of dependents.get(id) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) { ready.push(next); changed = true; }
    }
    if (changed) sortReady();
  }
  if (order.size !== rules.length) throw new Error(`IR rule dependency cycle among: ${rules.filter((r) => !order.has(r.ruleId)).map((r) => r.ruleId).slice(0, 5).join(', ')}`);
  // stage order is total: a dependency-free later-stage rule never precedes an earlier stage
  const final = [...order.keys()].sort((a, b) => key(a)[0] - key(b)[0] || order.get(a)! - order.get(b)!);
  return new Map(final.map((id, i) => [id, i]));
}

export const RULE_IR_SUMMARY = 'data/reports/rule-ir-summary.json';

export function summarizeRuleIR(ir: RuleIR) {
  const count = (f: (r: IRRule) => string) => { const m: Record<string, number> = {}; for (const r of ir.rules) m[f(r)] = (m[f(r)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort(([a], [b]) => cmp(a, b))); };
  return {
    schemaVersion: '1', kind: 'rule-ir-summary', owner: 'japanese-orthography#211 D (spec #208 §3-4)',
    digest: ir.digest, rules: ir.rules.length,
    branches: ir.rules.reduce((n, r) => n + r.branches.length, 0),
    multiBranchRules: ir.rules.filter((r) => r.branches.length > 1).length,
    byKind: count((r) => r.kind), byStage: count((r) => r.stage), byDirection: count((r) => r.direction), byEvidenceType: count((r) => r.evidenceType)
  };
}

if (process.argv[1]?.endsWith('rule-ir.ts')) {
  const root = resolve(process.cwd());
  const { graph } = await normalizeAcceptedOrthographySources(root);
  const summary = summarizeRuleIR(compileRuleIR(withProfileRules(graph)));
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const committed = (await readFile(resolve(root, RULE_IR_SUMMARY), 'utf8')).replace(/\r\n/g, '\n');
    if (committed !== text) throw new Error(`stale ${RULE_IR_SUMMARY}; run npm run generate:rule-ir`);
    console.log(`rule IR OK: ${summary.rules} rules, digest ${summary.digest}`);
  } else {
    await writeFile(resolve(root, RULE_IR_SUMMARY), text);
    console.log(JSON.stringify(summary, null, 1));
  }
}
