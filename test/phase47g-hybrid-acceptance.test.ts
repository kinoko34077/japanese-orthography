import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createSchemaValidator } from '../tools/schema-validator.ts';
import type { NormalizedOrthographyRelation } from '../tools/normalized-relation-model.ts';
import { projectPhase46dNativeArtifact } from '../tools/normalized-relation-compiler.ts';
import {
  compileCompactOrthographyArtifact,
  createCompactOrthographyRuntime
} from '../tools/compact-orthography.ts';
import {
  createApplicabilityLedger,
  ledgerEntryFromCandidateSelection,
  ledgerEntryFromProductiveResolution,
  queryApplicabilityLedgerByRule
} from '../tools/applicability-ledger.ts';
import { resolveProductiveOrthography } from '../tools/productive-orthography.ts';
import { selectHistoricalCandidate } from '../tools/candidate-preference.ts';
import {
  foldKanaScript,
  renderSpanIteration
} from '../tools/kana-orthography.ts';

const validate = createSchemaValidator();

function relation(
  id: string,
  fromForms: string[],
  toForms: string[],
  applicationMode: NormalizedOrthographyRelation['applicationMode'],
  relationKind: NormalizedOrthographyRelation['relationKind'] = 'mapping'
): NormalizedOrthographyRelation {
  return {
    id,
    relationKind,
    channel: 'surface',
    applicationMode,
    fromForms,
    toForms,
    basis: relationKind === 'candidates' ? 'source_candidates' : 'source_exact',
    evidenceRefs: [`ev:${id}`]
  };
}

async function loadSinoRuntime() {
  const artifact = JSON.parse(
    await readFile('data/historical/sino/phase46e-sino-kana.json', 'utf8')
  );
  const source = await readFile('runtime/historical-sino-runtime.js', 'utf8');
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'runtime/historical-sino-runtime.js' });
  return sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime(artifact);
}

test('hybrid unknown-word path applies productive span, guards contextual ambiguity, and emits an auditable ledger', () => {
  const productive = relation(
    'span:bengo',
    ['弁護'],
    ['辯護'],
    'substring_productive'
  );
  productive.sourceRefs = ['source:lexical'];
  const unsafe = relation(
    'unsafe:ben',
    ['弁'],
    ['辨', '瓣', '辯', '辦'],
    'contextual',
    'candidates'
  );

  const resolution = resolveProductiveOrthography('新弁護士', [unsafe, productive]);
  assert.equal(resolution.output, '新辯護士');
  assert.deepEqual(resolution.appliedRules.map(entry => entry.relationId), ['span:bengo']);
  assert.ok(resolution.blockedRules.some(entry =>
    entry.relationId === 'unsafe:ben' &&
    entry.reason === 'non_productive_application_mode'
  ));

  const ledger = createApplicabilityLedger([
    ledgerEntryFromProductiveResolution(resolution, {
      lexicalIdentity: 'unknown:new-compound'
    })
  ]);

  assert.deepEqual(validate(ledger, 'orthography-applicability-ledger-v1'), []);
  assert.equal(ledger.entries[0]?.selectedResult, '新辯護士');
  assert.equal(ledger.entries[0]?.basis, 'generated_productive_span');
  assert.equal(queryApplicabilityLedgerByRule(ledger, 'span:bengo').length, 1);
  assert.equal(queryApplicabilityLedgerByRule(ledger, 'unsafe:ben').length, 1);
});

test('context-qualified Sino authority outranks diachronic preference and remains provenance-visible', async () => {
  const runtime = await loadSinoRuntime();
  const contextual = runtime.reconstructWord('法', 'ほう', { context: '仏教用語' });

  assert.equal(contextual.status, 'resolved');
  assert.equal(contextual.historicalReading, 'ほふ');
  assert.equal(contextual.selectionContext, '仏教用語');

  const selection = selectHistoricalCandidate({
    sourceCandidates: ['はふ', 'ほふ'],
    authoritativeSelection: {
      result: contextual.historicalReading,
      basis: 'source_contextual',
      ruleRef: 'sino:法:仏教用語',
      evidenceRefs: contextual.evidenceRefs
    },
    diachronicRules: [{
      id: 'dia:prefer-hafu',
      admissibleCandidates: ['はふ', 'ほふ'],
      preferred: 'はふ',
      evidenceRefs: ['research:dia']
    }]
  });

  assert.equal(selection.selectedResult, 'ほふ');
  assert.equal(selection.basis, 'source_contextual');
  assert.ok(selection.blockedRuleRefs.includes('dia:prefer-hafu'));

  const ledger = createApplicabilityLedger([
    ledgerEntryFromCandidateSelection({
      input: '法',
      lexicalIdentity: 'test:buddhist-hou',
      context: { usage: '仏教用語' }
    }, selection)
  ]);

  assert.deepEqual(validate(ledger, 'orthography-applicability-ledger-v1'), []);
  assert.equal(ledger.entries[0]?.basis, 'source_contextual');
  assert.equal(ledger.entries[0]?.preferenceApplied, false);
  assert.ok(ledger.entries[0]?.blockedRules.some(rule =>
    rule.ruleRef === 'dia:prefer-hafu'
  ));
});

test('cross-channel lexical selection happens before orthographic rendering without erasing source candidates', () => {
  const selection = selectHistoricalCandidate({
    sourceCandidates: ['うじ〳〵', 'うぢうぢ'],
    exactCrossChannel: {
      value: 'うぢうぢ',
      ruleRef: 'cross:exact-reading',
      sourceRefs: ['native-dict'],
      evidenceRefs: ['ev:exact-reading']
    }
  });

  assert.equal(selection.selectedResult, 'うぢうぢ');
  assert.equal(selection.basis, 'cross_channel_selected');
  assert.deepEqual(selection.sourceCandidates, ['うじ〳〵', 'うぢうぢ']);

  const rendered = renderSpanIteration(selection.selectedResult!, 'うぢ');
  assert.equal(rendered, 'うぢ〳〵');
  assert.deepEqual(selection.sourceCandidates, ['うじ〳〵', 'うぢうぢ']);

  assert.equal(foldKanaScript('アカウ', { scriptFoldable: true }), 'あかう');
  assert.equal(foldKanaScript('アカウ', { scriptFoldable: false }), 'アカウ');
});

test('compact runtime preserves accepted candidate/exact channels from the canonical Phase-4.6D graph', async () => {
  const artifact = JSON.parse(
    await readFile('data/historical/native/phase46d-native-kana.json', 'utf8')
  ) as Record<string, any>;
  const graph = projectPhase46dNativeArtifact(artifact);
  const compact = compileCompactOrthographyArtifact(graph);
  const runtime = createCompactOrthographyRuntime(compact);

  const surface = runtime.lookup('surface', 'うじうじ');
  const reading = runtime.lookup('reading', 'うじうじ');

  assert.equal(surface.length, 1);
  assert.equal(surface[0]?.relationKind, 'candidates');
  assert.deepEqual(surface[0]?.toForms, ['うじ〳〵', 'うぢうぢ']);

  assert.equal(reading.length, 1);
  assert.equal(reading[0]?.relationKind, 'mapping');
  assert.deepEqual(reading[0]?.toForms, ['うぢうぢ']);
});
