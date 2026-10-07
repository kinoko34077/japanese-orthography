import assert from 'node:assert/strict';
import test from 'node:test';
import { orderRules, RULE_STAGES, type IRRule, type RuleStage } from '../tools/rule-ir.ts';

const rule = (ruleId: string, stage: RuleStage, dependsOn: string[] = []): IRRule => ({
  ruleId,
  kind: stage === 'profile' ? 'profile-style' : 'exact',
  stage,
  direction: 'to-historical',
  channel: 'surface',
  scope: 'anywhere',
  input: ruleId,
  branches: [{ output: ruleId + ':out', candidate: false, canonicalId: ruleId }],
  lexicalScope: [],
  predicate: null,
  origin: stage === 'profile' ? 'tar' : 'historically_attested',
  enabledBy: stage === 'profile' ? ['kinotch-fixed'] : null,
  dependsOn,
  canonicalIds: [ruleId],
  evidenceType: 'test'
});

const referenceOrder = (rules: readonly IRRule[]) => {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const byId = new Map(rules.map((r) => [r.ruleId, r]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const r of rules) {
    indegree.set(r.ruleId, indegree.get(r.ruleId) ?? 0);
    for (const dep of r.dependsOn) {
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
      if (indegree.get(next) === 0) {
        ready.push(next);
        changed = true;
      }
    }
    if (changed) sortReady();
  }
  const final = [...order.keys()].sort((a, b) => key(a)[0] - key(b)[0] || order.get(a)! - order.get(b)!);
  return final;
};

test('heap-based Rule IR ordering preserves the accepted sort-ready semantics', () => {
  const rules = [
    rule('lex:z', 'lexical'),
    rule('lex:a', 'lexical'),
    rule('lex:m', 'lexical', ['lex:z']),
    rule('semantic:z', 'semantic'),
    rule('semantic:a', 'semantic', ['lex:m']),
    rule('orthographic:b', 'orthographic'),
    rule('profile:z', 'profile'),
    rule('profile:a', 'profile', ['orthographic:b']),
    rule('render:a', 'render', ['profile:a'])
  ];
  assert.deepEqual([...orderRules(rules).keys()], referenceOrder(rules));
});
