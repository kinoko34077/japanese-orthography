import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createSchemaValidator } from '../tools/schema-validator.ts';
import {
  buildNativeResidualCandidateCensus,
  selectHistoricalCandidate
} from '../tools/candidate-preference.ts';

const validate = createSchemaValidator();

test('authoritative source/context selection outranks every preference layer while retaining candidates', () => {
  const result = selectHistoricalCandidate({
    sourceCandidates: ['はふ', 'ほふ'],
    authoritativeSelection: {
      result: 'ほふ',
      basis: 'source_contextual',
      ruleRef: 'source:法:仏教用語'
    },
    diachronicRules: [{
      id: 'diachronic:prefer-hafu',
      admissibleCandidates: ['はふ', 'ほふ'],
      preferred: 'はふ'
    }],
    manualPriority: {
      id: 'manual:law',
      candidateSet: ['はふ', 'ほふ'],
      preferred: 'はふ',
      rationale: 'test-only lower-priority preference'
    }
  });

  assert.equal(result.status, 'selected');
  assert.equal(result.selectedResult, 'ほふ');
  assert.equal(result.basis, 'source_contextual');
  assert.deepEqual(result.sourceCandidates, ['はふ', 'ほふ']);
  assert.deepEqual(result.appliedRuleRefs, ['source:法:仏教用語']);
  assert.ok(result.blockedRuleRefs.includes('diachronic:prefer-hafu'));
  assert.ok(result.blockedRuleRefs.includes('manual:law'));
});

test('exact reading can select a compatible kana-only surface candidate without rewriting source truth', () => {
  const result = selectHistoricalCandidate({
    sourceCandidates: ['うじ〳〵', 'うぢうぢ'],
    exactCrossChannel: {
      value: 'うぢうぢ',
      ruleRef: 'cross:exact-reading',
      sourceRefs: ['native-dict'],
      evidenceRefs: ['ev:exact-reading']
    }
  });

  assert.equal(result.status, 'selected');
  assert.equal(result.selectedResult, 'うぢうぢ');
  assert.equal(result.basis, 'cross_channel_selected');
  assert.deepEqual(result.sourceCandidates, ['うじ〳〵', 'うぢうぢ']);
  assert.deepEqual(result.appliedRuleRefs, ['cross:exact-reading']);
  assert.deepEqual(result.sourceRefs, ['native-dict']);
  assert.deepEqual(result.evidenceRefs, ['ev:exact-reading']);
});

test('incompatible exact cross-channel evidence fails closed before weaker preferences', () => {
  const result = selectHistoricalCandidate({
    sourceCandidates: ['はふ', 'ほふ'],
    exactCrossChannel: {
      value: 'まをす',
      ruleRef: 'cross:incompatible',
      sourceRefs: ['native:exact'],
      evidenceRefs: ['ev:cross-conflict']
    },
    diachronicRules: [{
      id: 'dia:prefer-hafu',
      admissibleCandidates: ['はふ', 'ほふ'],
      preferred: 'はふ'
    }],
    manualPriority: {
      id: 'manual:prefer-hofu',
      candidateSet: ['はふ', 'ほふ'],
      preferred: 'ほふ',
      rationale: 'must not override conflicting exact evidence'
    }
  });

  assert.equal(result.status, 'candidates');
  assert.equal(result.selectedResult, null);
  assert.equal(result.basis, 'unresolved');
  assert.deepEqual(result.appliedRuleRefs, []);
  assert.ok(result.blockedRuleRefs.includes('cross:incompatible'));
  assert.ok(result.blockedRuleRefs.includes('dia:prefer-hafu'));
  assert.ok(result.blockedRuleRefs.includes('manual:prefer-hofu'));
  assert.deepEqual(result.sourceRefs, ['native:exact']);
  assert.deepEqual(result.evidenceRefs, ['ev:cross-conflict']);
});

test('explicit diachronic preference selects only within its declared admissible candidate set', () => {
  const selected = selectHistoricalCandidate({
    sourceCandidates: ['はふ', 'ほふ'],
    diachronicRules: [{
      id: 'diachronic:law-hafu-before-hou',
      admissibleCandidates: ['はふ', 'ほふ'],
      preferred: 'はふ',
      evidenceRefs: ['research:rule']
    }]
  });
  assert.equal(selected.selectedResult, 'はふ');
  assert.equal(selected.basis, 'generated_diachronic');
  assert.deepEqual(selected.sourceCandidates, ['はふ', 'ほふ']);

  const notApplicable = selectHistoricalCandidate({
    sourceCandidates: ['まうす', 'まをす'],
    diachronicRules: [{
      id: 'diachronic:law-hafu-before-hou',
      admissibleCandidates: ['はふ', 'ほふ'],
      preferred: 'はふ'
    }]
  });
  assert.equal(notApplicable.status, 'candidates');
  assert.equal(notApplicable.selectedResult, null);
});

test('conflicting diachronic preferences do not choose by rule order', () => {
  const a = {
    id: 'dia:a',
    admissibleCandidates: ['はふ', 'ほふ'],
    preferred: 'はふ'
  };
  const b = {
    id: 'dia:b',
    admissibleCandidates: ['はふ', 'ほふ'],
    preferred: 'ほふ'
  };

  const first = selectHistoricalCandidate({
    sourceCandidates: ['はふ', 'ほふ'],
    diachronicRules: [a, b]
  });
  const second = selectHistoricalCandidate({
    sourceCandidates: ['ほふ', 'はふ'],
    diachronicRules: [b, a]
  });

  assert.deepEqual(first, second);
  assert.equal(first.status, 'candidates');
  assert.equal(first.selectedResult, null);
  assert.ok(first.blockedRuleRefs.includes('dia:a'));
  assert.ok(first.blockedRuleRefs.includes('dia:b'));
});

test('full-size sokuon preference is gated by same-historical-representation evidence', () => {
  const gated = selectHistoricalCandidate({
    sourceCandidates: ['しょっちう', 'しょつちう'],
    renderingPreference: {
      id: 'render:full-size-sokuon',
      preferFullSizeSokuon: true,
      sameHistoricalRepresentation: true
    }
  });
  assert.equal(gated.selectedResult, 'しょつちう');
  assert.equal(gated.basis, 'generated_rendering');

  const ungated = selectHistoricalCandidate({
    sourceCandidates: ['しょっちう', 'しょつちう'],
    renderingPreference: {
      id: 'render:full-size-sokuon',
      preferFullSizeSokuon: true,
      sameHistoricalRepresentation: false
    }
  });
  assert.equal(ungated.status, 'candidates');
  assert.equal(ungated.selectedResult, null);
});

test('manual priority is residual-only and cannot override cross-channel or diachronic selection', () => {
  const manual = {
    id: 'manual:maosu',
    candidateSet: ['まうす', 'まをす'],
    preferred: 'まをす',
    rationale: 'reviewed residual choice'
  };

  const residual = selectHistoricalCandidate({
    sourceCandidates: ['まうす', 'まをす'],
    manualPriority: manual
  });
  assert.equal(residual.selectedResult, 'まをす');
  assert.equal(residual.basis, 'manual_preference');

  const stronger = selectHistoricalCandidate({
    sourceCandidates: ['まうす', 'まをす'],
    exactCrossChannel: { value: 'まうす', ruleRef: 'cross:exact' },
    manualPriority: manual
  });
  assert.equal(stronger.selectedResult, 'まうす');
  assert.equal(stronger.basis, 'cross_channel_selected');
  assert.ok(stronger.blockedRuleRefs.includes('manual:maosu'));
});

test('unresolved source candidates remain valid when no justified winner exists', () => {
  const result = selectHistoricalCandidate({
    sourceCandidates: ['むかう', 'むかふ']
  });
  assert.equal(result.status, 'candidates');
  assert.equal(result.selectedResult, null);
  assert.equal(result.basis, 'unresolved');
  assert.deepEqual(result.sourceCandidates, ['むかう', 'むかふ']);
});

test('manual-priority overlay is machine-validatable and candidate-set bounded', () => {
  const document = {
    schemaVersion: '1',
    kind: 'orthography_manual_priority_overlay',
    entries: [{
      id: 'manual:maosu',
      key: 'まおす',
      channel: 'reading',
      sourceCandidates: ['まうす', 'まをす'],
      preferred: 'まをす',
      rationale: 'reviewed residual choice',
      evidenceRefs: ['review:manual:maosu']
    }]
  };
  assert.deepEqual(validate(document, 'orthography-manual-priority-overlay-v1'), []);

  const invalid = structuredClone(document);
  invalid.entries[0]!.preferred = 'ます';
  assert.ok(validate(invalid, 'orthography-manual-priority-overlay-v1').length > 0);
});

test('native residual census performs only mechanical/cross-channel reduction and is order-independent', async () => {
  const artifact = JSON.parse(
    await readFile('data/historical/native/phase46d-native-kana.json', 'utf8')
  ) as Record<string, any>;

  const census = buildNativeResidualCandidateCensus(artifact);
  assert.equal(
    census.entries.length,
    artifact.ambiguousSurfaceCandidates.length + artifact.ambiguousReadingCandidates.length
  );

  const uji = census.entries.find((entry: any) =>
    entry.surface === 'うじうじ' && entry.channel === 'surface'
  );
  assert.equal(uji?.selectedResult, 'うぢうぢ');
  assert.equal(uji?.basis, 'cross_channel_selected');
  assert.deepEqual(uji?.sourceCandidates, ['うじ〳〵', 'うぢうぢ']);

  const aaiu = census.entries.find((entry: any) =>
    entry.surface === 'ああいう' && entry.channel === 'surface'
  );
  assert.equal(aaiu?.selectedResult, 'ああいふ');
  assert.equal(aaiu?.basis, 'generated_rendering');

  const mukou = census.entries.find((entry: any) =>
    entry.surface === '向こう' && entry.channel === 'reading'
  );
  assert.equal(mukou?.status, 'candidates');
  assert.deepEqual(mukou?.sourceCandidates, ['むかう', 'むかふ']);

  assert.ok(census.residualEntries < census.entries.length);

  const reversed = structuredClone(artifact);
  reversed.surfaceRelations.reverse();
  reversed.readingRelations.reverse();
  reversed.ambiguousSurfaceCandidates.reverse();
  reversed.ambiguousReadingCandidates.reverse();
  assert.deepEqual(buildNativeResidualCandidateCensus(reversed), census);
});
