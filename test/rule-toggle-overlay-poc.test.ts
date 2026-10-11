import assert from 'node:assert/strict';
import test from 'node:test';
import { createToggleOverlay, type ToggleNode, type ToggleRule } from '../tools/rule-toggle-overlay-poc.ts';

// #313: production VMと無関係な契約テスト。RuleIdとProgramIdは明示的に別空間。
const nodes: ToggleNode[] = [
  { id: 'bundle', kind: 'bundle', enabledByDefault: true },
  { id: 'group', kind: 'group', parentId: 'bundle', enabledByDefault: true },
  { id: 'disabled-group', kind: 'group', parentId: 'bundle', enabledByDefault: false }
];
const rule = (logicalRuleId: string, programId: number, priority: number, sourceOrder: number, more: Partial<ToggleRule> = {}): ToggleRule => ({
  logicalRuleId, nodeId: 'group', programId, sourceCaseId: 'case:' + logicalRuleId,
  enabledByDefault: true, allowedProfiles: ['kinotch-fixed'],
  stageOrder: 1, priority, sourceOrder, ...more
});
const rules: ToggleRule[] = [
  rule('tar:high', 7, 100, 0),
  rule('tar:low', 8, 10, 1),
  rule('tar:shared-a', 9, 20, 2),
  rule('tar:shared-b', 9, 15, 3),
  rule('tar:disabled', 10, 200, 4, { sourceLockedOff: true }),
  rule('tar:opt-in', 11, 50, 5, { nodeId: 'disabled-group' })
];
const all = ['tar:high', 'tar:low'].map(logicalRuleId => ({ logicalRuleId, occurrenceId: 'same-span' }));

test('#313 overlay keeps higher-priority rule while enabled and reconsiders lower candidate after OFF', () => {
  const baseline = createToggleOverlay(nodes, rules);
  assert.deepEqual(baseline.select(all, 'kinotch-fixed').map(x => x.logicalRuleId), ['tar:high', 'tar:low']);
  const changed = baseline.withSettings({ rules: { 'tar:high': false } });
  assert.deepEqual(changed.select(all, 'kinotch-fixed').map(x => x.logicalRuleId), ['tar:low']);
  assert.deepEqual(baseline.select(all, 'kinotch-fixed').map(x => x.logicalRuleId), ['tar:high', 'tar:low']);
});

test('#313 parent OFF dominates enabled child and descendant entry', () => {
  const overlay = createToggleOverlay(nodes, rules, { nodes: { bundle: false }, rules: { 'tar:high': true } });
  assert.equal(overlay.enabled('tar:high', 'kinotch-fixed'), false);
  assert.equal(overlay.withSettings({ nodes: { bundle: true } }).enabled('tar:high', 'kinotch-fixed'), true);
  assert.equal(overlay.withSettings({ nodes: { bundle: true, group: false } }).enabled('tar:high', 'kinotch-fixed'), false);
});

test('#313 group default OFF may be opted in while immutable source-disabled entry cannot', () => {
  const overlay = createToggleOverlay(nodes, rules);
  assert.equal(overlay.enabled('tar:opt-in', 'kinotch-fixed'), false);
  assert.equal(overlay.withSettings({ nodes: { 'disabled-group': true } }).enabled('tar:opt-in', 'kinotch-fixed'), true);
  assert.equal(overlay.withSettings({ rules: { 'tar:disabled': true } }).enabled('tar:disabled', 'kinotch-fixed'), false);
});

test('#313 profile policy and global OFF cannot be overridden by an entry toggle', () => {
  const overlay = createToggleOverlay(nodes, rules, { globalEnabled: false, rules: { 'tar:high': true } });
  assert.equal(overlay.enabled('tar:high', 'kinotch-fixed'), false);
  assert.equal(overlay.withSettings({ globalEnabled: true }).enabled('tar:high', 'historical'), false);
  assert.equal(overlay.withSettings({ globalEnabled: true }).enabled('tar:high', 'kinotch-fixed'), true);
});

test('#313 distinct logical rule IDs remain independently switchable despite shared ProgramId', () => {
  const overlay = createToggleOverlay(nodes, rules, { rules: { 'tar:shared-a': false } });
  const candidates = ['tar:shared-a', 'tar:shared-b'].map(logicalRuleId => ({ logicalRuleId, occurrenceId: 'same-span' }));
  assert.deepEqual(overlay.select(candidates, 'kinotch-fixed').map(x => [x.logicalRuleId, x.programId]), [['tar:shared-b', 9]]);
});

test('#313 stable rule identity persists across compiled ProgramId renumbering', () => {
  const reordered = rules.map(r => ({ ...r, programId: r.programId + 1000 }));
  const old = createToggleOverlay(nodes, rules, { rules: { 'tar:high': false } });
  const newer = createToggleOverlay(nodes, reordered, { rules: { 'tar:high': false } });
  assert.equal(old.enabled('tar:high', 'kinotch-fixed'), newer.enabled('tar:high', 'kinotch-fixed'));
  assert.equal(newer.select(all, 'kinotch-fixed')[0]?.programId, 1008);
});

test('#313 setting update advances revision/cache partition and reset restores source default', () => {
  const overlay = createToggleOverlay(nodes, rules);
  const off = overlay.withSettings({ rules: { 'tar:low': false } });
  assert.notEqual(off.cacheKey('digest', 'kinotch-fixed'), overlay.cacheKey('digest', 'kinotch-fixed'));
  assert.notEqual(off.cacheKey('digest', 'modern'), off.cacheKey('digest', 'kinotch-fixed'));
  const back = off.withSettings({ rules: { 'tar:low': null } });
  assert.equal(back.enabled('tar:low', 'kinotch-fixed'), true);
  assert.equal(back.revision, 2);
});

test('#313 rejects unknown rule settings/candidates, duplicate IDs and missing/cyclic parents', () => {
  assert.throws(() => createToggleOverlay(nodes, rules, { rules: { 'tar:unknown': true } }), /unknown toggle/);
  assert.throws(() => createToggleOverlay(nodes, rules).withSettings({ nodes: { wrong: true } }), /unknown toggle/);
  assert.throws(() => createToggleOverlay(nodes, rules).select([{ logicalRuleId: 'alien', occurrenceId: 'x' }], 'kinotch-fixed'), /unknown logical/);
  assert.throws(() => createToggleOverlay(nodes, [...rules, rules[0]!]), /duplicate/);
  assert.throws(() => createToggleOverlay([...nodes, { id: 'orphan', kind: 'group', enabledByDefault: true, parentId: 'missing' }], rules), /missing/);
  assert.throws(() => createToggleOverlay([{ id: 'a', kind: 'group', enabledByDefault: true, parentId: 'b' }, { id: 'b', kind: 'group', enabledByDefault: true, parentId: 'a' }], []), /cycle/);
});

test('#313 eligible candidates preserve stage order, then priority and stable source tie-break', () => {
  const stageRules = [...rules, rule('tar:early-stage', 12, 0, 6, { stageOrder: 0 }), rule('tar:tie', 13, 100, 7)];
  const o = createToggleOverlay(nodes, stageRules);
  const ids = ['tar:low', 'tar:tie', 'tar:high', 'tar:early-stage'];
  assert.deepEqual(o.select(ids.map(logicalRuleId => ({ logicalRuleId, occurrenceId: 'x' })), 'kinotch-fixed')
    .map(x => x.logicalRuleId), ['tar:early-stage', 'tar:high', 'tar:tie', 'tar:low']);
});
