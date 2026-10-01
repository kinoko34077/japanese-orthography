import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadRuntime() {
  let source = '';
  try {
    source = await readFile('runtime/productive-relation-runtime.js', 'utf8');
  } catch {
    // RED before runtime exists.
  }
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  if (source) {
    vm.runInNewContext(source, sandbox, {
      filename: 'runtime/productive-relation-runtime.js'
    });
  }
  return sandbox.ProductiveRelationRuntime;
}

function relation(
  id: string,
  from: string,
  to: string,
  applicationMode: string,
  overrides: Record<string, any> = {}
) {
  return {
    id,
    relationKind: 'mapping',
    channel: 'surface',
    applicationMode,
    fromForms: [from],
    toForms: [to],
    basis: 'source_exact',
    evidenceRefs: [`ev:${id}`],
    ...overrides
  };
}

function graph(relations: Record<string, any>[]) {
  return {
    schemaVersion: '1',
    kind: 'normalized_orthography_graph',
    lexicalNamespaceId: 'test',
    sources: [],
    relations
  };
}

test('productive span applies inside unknown larger text and preserves identity gaps', async () => {
  const api = await loadRuntime();
  assert.equal(typeof api?.createProductiveRelationRuntime, 'function');

  const runtime = api.createProductiveRelationRuntime(graph([
    relation('test:bengo', '弁護', '辯護', 'substring_productive')
  ]));

  const result = runtime.transform('国選弁護士');
  assert.equal(result.output, '国選辯護士');
  assert.deepEqual(JSON.parse(JSON.stringify(result.segments)), [
    {
      sourceText: '国選',
      outputText: '国選',
      start: 0,
      end: 2,
      basis: 'implicit_identity',
      ruleRefs: []
    },
    {
      sourceText: '弁護',
      outputText: '辯護',
      start: 2,
      end: 4,
      basis: 'generated_productive_span',
      ruleRefs: ['test:bengo']
    },
    {
      sourceText: '士',
      outputText: '士',
      start: 4,
      end: 5,
      basis: 'implicit_identity',
      ruleRefs: []
    }
  ]);

  assert.equal(runtime.transform('勘弁護衛').output, '勘辯護衛');
});

test('safe character-productive relations apply by code point', async () => {
  const api = await loadRuntime();
  const runtime = api.createProductiveRelationRuntime(graph([
    relation('test:gaku', '学', '學', 'character_productive')
  ]));

  const result = runtime.transform('学校外');
  assert.equal(result.output, '學校外');
  assert.equal(result.segments[0].basis, 'generated_character');
  assert.deepEqual(JSON.parse(JSON.stringify(result.segments[0].ruleRefs)), ['test:gaku']);
});

test('exact/contextual relations do not leak into unknown-word productive fallback', async () => {
  const api = await loadRuntime();
  const runtime = api.createProductiveRelationRuntime(graph([
    relation('test:ben-exact', '弁', '辨', 'exact_lexeme'),
    relation('test:hou-context', '法', 'ほふ', 'contextual', { channel: 'reading' })
  ]));

  const result = runtime.transform('弁当法');
  assert.equal(result.output, '弁当法');
  assert.ok(result.blockedRules.some((entry: any) =>
    entry.ruleRef === 'test:ben-exact' &&
    entry.reason === 'exact_lexeme_not_productive'
  ));
  assert.ok(result.blockedRules.some((entry: any) =>
    entry.ruleRef === 'test:hou-context' &&
    entry.reason === 'context_required'
  ));
});

test('explicit preserve block outranks a matching productive relation', async () => {
  const api = await loadRuntime();
  const runtime = api.createProductiveRelationRuntime(graph([
    relation('test:productive-A', 'A', 'B', 'character_productive'),
    {
      id: 'test:preserve-XA',
      relationKind: 'preserve',
      channel: 'surface',
      applicationMode: 'preserve_block',
      fromForms: ['XA'],
      toForms: ['XA'],
      basis: 'preserve_exact',
      identitySemantics: 'preserve',
      evidenceRefs: ['ev:preserve']
    }
  ]));

  const result = runtime.transform('XA-A');
  assert.equal(result.output, 'XA-B');
  assert.equal(result.segments[0].basis, 'preserve_exact');
  assert.ok(result.blockedRules.some((entry: any) =>
    entry.ruleRef === 'test:productive-A' &&
    entry.reason === 'preserve_block'
  ));
});

test('longest productive match wins deterministically and shadows shorter matches', async () => {
  const api = await loadRuntime();
  const runtime = api.createProductiveRelationRuntime(graph([
    relation('test:A', 'A', 'Y', 'character_productive'),
    relation('test:AB', 'AB', 'X', 'substring_productive')
  ]));

  const result = runtime.transform('AB');
  assert.equal(result.output, 'X');
  assert.deepEqual(JSON.parse(JSON.stringify(result.segments)), [{
    sourceText: 'AB',
    outputText: 'X',
    start: 0,
    end: 2,
    basis: 'generated_productive_span',
    ruleRefs: ['test:AB']
  }]);
  assert.ok(result.blockedRules.some((entry: any) =>
    entry.ruleRef === 'test:A' &&
    entry.reason === 'shadowed_by_longer_match'
  ));
});

test('upstream dictionary-selected locked spans outrank productive fallback', async () => {
  const api = await loadRuntime();
  const runtime = api.createProductiveRelationRuntime(graph([
    relation('test:sou', '装', '裝', 'character_productive')
  ]));

  const result = runtime.transform('前装丁後', {
    lockedSegments: [{
      start: 1,
      end: 3,
      sourceText: '装丁',
      outputText: '装幀',
      basis: 'dictionary_selected',
      ruleRefs: ['dict:soutei']
    }]
  });

  assert.equal(result.output, '前装幀後');
  assert.ok(result.segments.some((segment: any) =>
    segment.basis === 'dictionary_selected' &&
    segment.outputText === '装幀'
  ));
  assert.ok(result.blockedRules.some((entry: any) =>
    entry.ruleRef === 'test:sou' &&
    entry.reason === 'upstream_locked_segment'
  ));
});

test('ambiguous or conflicting productive authority fails closed instead of using source order', async () => {
  const api = await loadRuntime();

  assert.throws(
    () => api.createProductiveRelationRuntime(graph([{
      id: 'test:ambiguous',
      relationKind: 'candidates',
      channel: 'surface',
      applicationMode: 'substring_productive',
      fromForms: ['AB'],
      toForms: ['X', 'Y'],
      basis: 'source_candidates',
      evidenceRefs: ['ev:ambiguous']
    }])),
    /ambiguous productive relation/i
  );

  assert.throws(
    () => api.createProductiveRelationRuntime(graph([
      relation('test:AB-X', 'AB', 'X', 'substring_productive'),
      relation('test:AB-Y', 'AB', 'Y', 'substring_productive')
    ])),
    /conflicting productive relation/i
  );
});
