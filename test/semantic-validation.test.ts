import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePackLocal } from '../tools/semantic-validator.ts';
import type { CanonicalWorkspace, Located } from '../tools/model.ts';

function located<T>(value: T, pointer = '/'): Located<T> {
  return { value, location: { file: 'fixture.json', pointer } };
}

function baseWorkspace(): CanonicalWorkspace {
  return {
    sources: [located({ id: 'official', kind: 'primary_official', title: 'source', locator: 'table' })],
    evidence: [located({
      id: 'ev-main', sourceRef: 'official', locator: 'row-1', sourceClass: 'official',
      claim: { type: 'mapping', direction: 'historical_to_modern', rawFrom: '熔接', rawTo: '溶接' }
    })],
    lexicalEvidence: [],
    lexicalConstraintSets: [],
    restorationUnits: [located({ id: 'unit-main', family: 'homophone', modernKey: '溶接' })],
    positiveRelations: [located({
      id: 'rel-main', unitId: 'unit-main', kind: 'contextual_kanji', direction: 'modern_to_historical',
      channel: 'surface', match: '溶接', target: '熔接', evidenceRefs: ['ev-main'], admission: 'admitted'
    })],
    safetyConstraints: [], reviewHints: [], packMetadata: [located({ packId: 'contextual-kanji' })]
  };
}
function codes(workspace: CanonicalWorkspace): Set<string> {
  return new Set(validatePackLocal(workspace).map((d) => d.code));
}

test('semantic validator reports duplicate, dangling, and unresolved references', () => {
  const duplicate = baseWorkspace();
  duplicate.restorationUnits.push(located({ ...duplicate.restorationUnits[0]!.value }));
  assert.ok(codes(duplicate).has('E_DUPLICATE_ID'));

  const dangling = baseWorkspace();
  dangling.positiveRelations[0]!.value.unitId = 'missing-unit';
  assert.ok(codes(dangling).has('E_DANGLING_LOCAL_REF'));

  const unresolved = baseWorkspace();
  unresolved.positiveRelations[0]!.value.evidenceRefs = ['missing-evidence'];
  assert.ok(codes(unresolved).has('E_UNRESOLVED_EVIDENCE'));
});

test('duplicate executable authority fails but separate admitted candidates remain legal', () => {
  const duplicate = baseWorkspace();
  duplicate.positiveRelations.push(located({ ...duplicate.positiveRelations[0]!.value, id: 'rel-dup' }));
  assert.ok(codes(duplicate).has('E_DUPLICATE_EXECUTABLE_AUTHORITY'));

  const candidates = baseWorkspace();
  candidates.positiveRelations[0]!.value.match = '装丁';
  candidates.positiveRelations[0]!.value.target = '装釘';
  candidates.positiveRelations.push(located({ ...candidates.positiveRelations[0]!.value, id: 'rel-alt', target: '装幀' }));
  assert.equal(codes(candidates).has('E_DUPLICATE_EXECUTABLE_AUTHORITY'), false);
});
test('opaque multi-target collapse and orphan restoration units are hard errors', () => {
  const collapsed = baseWorkspace();
  (collapsed.positiveRelations[0]!.value as unknown as { target: unknown }).target = ['熔接', '鎔接'];
  assert.ok(codes(collapsed).has('E_SILENT_MULTI_TARGET_COLLAPSE'));

  const orphan = baseWorkspace();
  orphan.restorationUnits.push(located({ id: 'orphan', family: 'test', modernKey: '孤立' }));
  assert.ok(codes(orphan).has('E_ORPHAN_RESTORATION_UNIT'));
});

test('required lexical binding fails closed when the constraint cannot resolve', () => {
  const workspace = baseWorkspace();
  workspace.lexicalConstraintSets.push(located({ id: 'lex-required', lexicalEvidenceRefs: ['missing-lex'] }));
  workspace.positiveRelations[0]!.value.lexicalConstraintSetId = 'lex-required';
  assert.ok(codes(workspace).has('E_REQUIRED_LEXICAL_BINDING_MISSING'));
});

test('projection requires an audit trail', () => {
  const workspace = baseWorkspace();
  workspace.evidence[0]!.value.claim = {
    type: 'mapping', direction: 'modern_to_historical', rawFrom: '間欠', rawTo: '閒歇', projectedTo: '間歇'
  };
  workspace.positiveRelations[0]!.value.match = '間欠';
  workspace.positiveRelations[0]!.value.target = '間歇';
  assert.ok(codes(workspace).has('E_PROJECTION_AUDIT_MISSING'));
});
test('oracle-only evidence cannot become admitted hot authority', () => {
  const workspace = baseWorkspace();
  workspace.sources[0]!.value.kind = 'candidate_oracle';
  assert.ok(codes(workspace).has('E_REVIEW_ONLY_AUTHORITY'));
});

test('single-character relations distinguish pure-character contamination from unsafe reverse', () => {
  const direct = baseWorkspace();
  direct.restorationUnits[0]!.value.modernKey = '学';
  direct.positiveRelations[0]!.value.match = '学';
  direct.positiveRelations[0]!.value.target = '學';
  direct.evidence[0]!.value.claim = {
    type: 'mapping', direction: 'modern_to_historical', rawFrom: '学', rawTo: '學'
  };
  assert.ok(codes(direct).has('E_PURE_CHARACTER_CONTAMINATION'));

  const reverse = baseWorkspace();
  reverse.restorationUnits[0]!.value.modernKey = '州';
  reverse.positiveRelations[0]!.value.match = '州';
  reverse.positiveRelations[0]!.value.target = '洲';
  reverse.evidence[0]!.value.claim = {
    type: 'mapping', direction: 'historical_to_modern', rawFrom: '洲', rawTo: '州'
  };
  assert.ok(codes(reverse).has('E_UNSAFE_SINGLE_CHAR_REVERSE'));
});
test('single-character relation with explicit lexical safety basis is not rejected by length alone', () => {
  const workspace = baseWorkspace();
  workspace.restorationUnits[0]!.value.modernKey = '州';
  workspace.positiveRelations[0]!.value.match = '州';
  workspace.positiveRelations[0]!.value.target = '洲';
  workspace.evidence[0]!.value.claim = {
    type: 'mapping', direction: 'historical_to_modern', rawFrom: '洲', rawTo: '州'
  };
  workspace.lexicalEvidence.push(located({
    id: 'lex-州', sourceRef: 'official', sourceIdentity: '州:noun', evidenceRefs: ['ev-main']
  }));
  workspace.lexicalConstraintSets.push(located({ id: 'lex-safe', lexicalEvidenceRefs: ['lex-州'] }));
  workspace.positiveRelations[0]!.value.lexicalConstraintSetId = 'lex-safe';
  const result = codes(workspace);
  assert.equal(result.has('E_PURE_CHARACTER_CONTAMINATION'), false);
  assert.equal(result.has('E_UNSAFE_SINGLE_CHAR_REVERSE'), false);
});

test('longer-rule validation uses ERROR only when redundancy is mechanically provable', () => {
  const proven = baseWorkspace();
  proven.positiveRelations[0]!.value.match = '合弁';
  proven.positiveRelations[0]!.value.target = '合瓣';
  proven.positiveRelations.push(located({
    ...proven.positiveRelations[0]!.value, id: 'rel-long', match: '合弁花', target: '合瓣花'
  }));
  assert.ok(codes(proven).has('E_REDUNDANT_LONGER_RULE'));
  const unproven = baseWorkspace();
  unproven.positiveRelations[0]!.value.match = '合弁';
  unproven.positiveRelations[0]!.value.target = '合辦';
  unproven.positiveRelations.push(located({
    ...unproven.positiveRelations[0]!.value, id: 'rel-long', match: '合弁花', target: '合瓣花'
  }));
  const diagnostics = validatePackLocal(unproven);
  assert.ok(diagnostics.some((d) => d.code === 'R_REDUNDANT_LONGER_RULE_UNPROVEN' && d.severity === 'REVIEW'));
});

test('layer leakage is ERROR when projection proves it and REVIEW when only suspected', () => {
  const proven = baseWorkspace();
  proven.evidence[0]!.value.claim = {
    type: 'mapping', direction: 'modern_to_historical', rawFrom: '間欠', rawTo: '閒歇',
    projectedTo: '間歇', projectionNotes: ['閒 is downstream rendering']
  };
  proven.positiveRelations[0]!.value.match = '間欠';
  proven.positiveRelations[0]!.value.target = '閒歇';
  assert.ok(codes(proven).has('E_LAYER_LEAKAGE'));

  const suspected = baseWorkspace();
  suspected.evidence[0]!.value.claim = {
    type: 'mapping', direction: 'modern_to_historical', rawFrom: '間欠', rawTo: '閒歇'
  };
  suspected.positiveRelations[0]!.value.match = '間欠';
  suspected.positiveRelations[0]!.value.target = '間歇';
  const diagnostics = validatePackLocal(suspected);
  assert.ok(diagnostics.some((d) => d.code === 'R_LAYER_LEAKAGE_SUSPECTED' && d.severity === 'REVIEW'));
});
