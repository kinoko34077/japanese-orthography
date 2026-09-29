import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateIntegration,
  type ExternalPackIndex,
  type LexicalNamespaceDescriptor
} from '../tools/integration-validator.ts';
import type { CanonicalWorkspace, Located } from '../tools/model.ts';

function located<T>(value: T): Located<T> {
  return { value, location: { file: 'fixture.json', pointer: '/' } };
}

function workspaceWithFallback(): CanonicalWorkspace {
  return {
    sources: [located({ id: 'official', kind: 'primary_official', title: 'source', locator: 'table' })],
    evidence: [located({
      id: 'ev-tai', sourceRef: 'official', locator: 'row', sourceClass: 'official',
      claim: { type: 'attestation', form: '台密', senseNote: 'original 台 preserve' }
    })],
    lexicalEvidence: [], lexicalConstraintSets: [], restorationUnits: [], positiveRelations: [],
    safetyConstraints: [located({
      id: 'safe-tai', kind: 'contextual_kanji', channel: 'surface', match: '台密',
      effect: 'block_fallback', evidenceRefs: ['ev-tai'],
      blocks: [{ packId: 'safe-kanji', relationId: 'char-tai' }], admission: 'admitted'
    })],
    reviewHints: [], packMetadata: [located({ packId: 'contextual-kanji' })]
  };
}
const safePack: ExternalPackIndex = {
  packId: 'safe-kanji',
  exportedRelationIds: new Set(['char-tai', 'char-gaku'])
};

test('integration resolves only explicitly exported external relations', () => {
  const valid = validateIntegration(workspaceWithFallback(), [safePack], null);
  assert.equal(valid.some((d) => d.severity === 'ERROR'), false);

  const missing = workspaceWithFallback();
  missing.safetyConstraints[0]!.value.blocks = [{ packId: 'safe-kanji', relationId: 'renamed' }];
  const diagnostics = validateIntegration(missing, [safePack], null);
  assert.ok(diagnostics.some((d) => d.code === 'E_EXTERNAL_RELATION_UNRESOLVED'));
});

test('block_fallback without explicit relation identity is an integration error', () => {
  const workspace = workspaceWithFallback();
  delete (workspace.safetyConstraints[0]!.value as { blocks?: unknown }).blocks;
  const diagnostics = validateIntegration(workspace, [safePack], null);
  assert.ok(diagnostics.some((d) => d.code === 'E_FALLBACK_DEPENDENCY_MISSING'));
});
function workspaceWithLexicalRequirement(): CanonicalWorkspace {
  const workspace = workspaceWithFallback();
  workspace.packMetadata[0]!.value.requiresLexicalNamespaceId = 'pmin-current';
  workspace.sources.push(located({ id: 'unidic', kind: 'dictionary', title: 'UniDic', locator: '2025.12' }));
  workspace.lexicalEvidence.push(located({
    id: 'lex-unidic', sourceRef: 'unidic', sourceIdentity: 'lemma:123', evidenceRefs: []
  }));
  workspace.lexicalConstraintSets.push(located({ id: 'lex-required', lexicalEvidenceRefs: ['lex-unidic'] }));
  workspace.restorationUnits.push(located({ id: 'unit-lex', family: 'test', modernKey: '合弁' }));
  workspace.positiveRelations.push(located({
    id: 'rel-lex', unitId: 'unit-lex', kind: 'contextual_kanji', direction: 'modern_to_historical',
    channel: 'surface', match: '合弁', lexicalConstraintSetId: 'lex-required',
    target: '合辦', evidenceRefs: ['ev-tai'], admission: 'admitted'
  }));
  return workspace;
}

test('required lexical namespace must exist, match id, and cover source namespaces', () => {
  const workspace = workspaceWithLexicalRequirement();
  assert.ok(validateIntegration(workspace, [safePack], null).some((d) => d.code === 'E_LEXICAL_NAMESPACE_REQUIRED'));

  const wrongId: LexicalNamespaceDescriptor = { id: 'other', compatibleSourceNamespaces: new Set(['unidic']) };
  assert.ok(validateIntegration(workspace, [safePack], wrongId).some((d) => d.code === 'E_LEXICAL_NAMESPACE_INCOMPATIBLE'));
  const wrongSources: LexicalNamespaceDescriptor = { id: 'pmin-current', compatibleSourceNamespaces: new Set(['other-source']) };
  assert.ok(validateIntegration(workspace, [safePack], wrongSources).some((d) => d.code === 'E_LEXICAL_NAMESPACE_INCOMPATIBLE'));

  const valid: LexicalNamespaceDescriptor = { id: 'pmin-current', compatibleSourceNamespaces: new Set(['unidic']) };
  assert.equal(validateIntegration(workspace, [safePack], valid).some((d) => d.code.startsWith('E_LEXICAL_NAMESPACE')), false);
});

test('integration validation does not import external pack data into canonical workspace', () => {
  const workspace = workspaceWithFallback();
  const before = JSON.stringify(workspace);
  validateIntegration(workspace, [safePack], null);
  assert.equal(JSON.stringify(workspace), before);
});
