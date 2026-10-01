import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NAMESPACES,
  buildEntityGraph,
  canonicalizeEntityGraph,
  compactEntityGraph,
  createEntityGraphRuntime,
  inflateEntityGraph,
  makeId,
  parseId,
  validateEntityGraph,
  type EntityGraph
} from '../tools/lexical-entity-graph.ts';

// Synthetic fixture shaped like the accepted 4.6E rows plus one path-level class (文法 ぶんぽう).
function fixture(): EntityGraph {
  return buildEntityGraph({
    sources: [{ key: 'phase46e-sino-table', sourceClass: 'committed-reference' }, { key: 'jmdict-2026-10-01', sourceClass: 'pinned-snapshot' }],
    evidence: [
      { key: 'phase46e-sino-table:row:153:token:0', source: 'phase46e-sino-table' },
      { key: 'phase46e-sino-table:row:154:token:0', source: 'phase46e-sino-table' },
      { key: 'phase46e-sino-table:row:1:token:0', source: 'phase46e-sino-table' }
    ],
    contexts: ['usage:仏教用語'],
    patterns: [
      { key: 'hafu>hou', from: ['はふ'], to: ['ほう'] },
      { key: 'hofu>hou', from: ['ほふ'], to: ['ほう'] },
      { key: 'sau>sou', from: ['さう'], to: ['そう'] },
      // shared environmental mechanism: after a moraic ん, ほう surfaces as ぽう (文法, 憲法, 説法 ...)
      { key: 'hou>pou/n_', from: ['ほう'], to: ['ぽう'], environment: { leftEndsWith: 'ん' } }
    ],
    bindings: [
      { symbol: '法', modern: ['ほう'], context: null, patterns: ['hafu>hou'], evidence: ['phase46e-sino-table:row:153:token:0'] },
      { symbol: '法', modern: ['ほう'], context: 'usage:仏教用語', patterns: ['hofu>hou'], evidence: ['phase46e-sino-table:row:154:token:0'] },
      { symbol: '法', modern: ['ぽう'], context: null, patterns: ['hou>pou/n_', 'hafu>hou'], evidence: [] },
      { symbol: '装', modern: ['そう'], context: null, patterns: ['sau>sou'], evidence: ['phase46e-sino-table:row:1:token:0'] },
      { symbol: '文', modern: ['ぶん'], context: null, patterns: [], evidence: [] }
    ],
    lexemes: [
      { key: 'soutei-binding', forms: ['装丁', '装幀', '装釘', '装訂'], readings: [{ path: ['そう', 'てい'] }], categories: ['jmdict-pos:n'], sourceRefs: ['jmdict:2026-10-01:seq:1000001'] },
      { key: 'soutei-assume', forms: ['想定'], readings: [{ path: ['そう', 'てい'] }], categories: ['jmdict-pos:n'], sourceRefs: ['jmdict:2026-10-01:seq:1000002'] },
      { key: 'bunpou', forms: ['文法'], readings: [{ path: ['ぶん', 'ぽう'] }], categories: [], sourceRefs: [] },
      { key: 'bengo', forms: ['弁護'], readings: [{ path: ['べん', 'ご'] }], categories: [], sourceRefs: [] },
      { key: 'bengoshi', forms: ['弁護士'], readings: [{ path: ['べん', 'ご', 'し'] }], categories: [], sourceRefs: [], composition: ['lexeme:bengo', 'morpheme:shi'] }
    ],
    morphemes: [{ key: 'shi', form: '士', reading: ['し'] }],
    relations: [{ key: 'phase47:弁護>辯護', lexeme: 'bengo' }]
  });
}

test('every namespace is distinct and ids carry their semantic type', () => {
  assert.deepEqual([...NAMESPACES].sort(), ['category', 'context', 'evidence', 'form', 'lexeme', 'morpheme', 'pattern', 'reading-atom', 'reading-path', 'relation', 'source', 'symbol'].sort());
  const id = makeId('form', '装丁');
  assert.deepEqual(parseId(id), { namespace: 'form', key: '装丁' });
  assert.notEqual(makeId('form', '装'), makeId('symbol', '装'));
  assert.throws(() => makeId('nope' as never, 'x'), /unknown namespace/);
  assert.throws(() => parseId('装丁'), /untyped id/);
});

test('same string may belong to several lexemes and one lexeme owns several forms', () => {
  const graph = fixture();
  const runtime = createEntityGraphRuntime(graph);
  const souteiPath = makeId('reading-path', 'そう|てい');
  assert.deepEqual(runtime.lexemesByReading(souteiPath), [makeId('lexeme', 'soutei-assume'), makeId('lexeme', 'soutei-binding')]);
  assert.deepEqual(runtime.lexemesByForm(makeId('form', '装幀')), [makeId('lexeme', 'soutei-binding')]);
  assert.equal(graph.lexemes.find((l) => l.id === makeId('lexeme', 'soutei-binding'))!.forms.length, 4);
  // source-local refs are kept beside, never as, the semantic id
  const lexeme = graph.lexemes.find((l) => l.id === makeId('lexeme', 'soutei-binding'))!;
  assert.deepEqual(lexeme.sourceRefs, ['jmdict:2026-10-01:seq:1000001']);
  assert.ok(!lexeme.id.includes('1000001'));
});

test('cross-namespace references fail closed', () => {
  const graph = fixture();
  const misuse = structuredClone(graph);
  misuse.lexemes.find((l) => l.id === makeId('lexeme', 'soutei-assume'))!.forms[0] = makeId('symbol', '装') as never;
  assert.match(validateEntityGraph(misuse).join('\n'), /lexeme:soutei-assume\.forms expects form, got symbol:装/);
  const dangling = structuredClone(graph);
  dangling.bindings[0]!.patterns.push(makeId('pattern', 'missing') as never);
  assert.match(validateEntityGraph(dangling).join('\n'), /dangling pattern:missing/);
  const pathAsAtom = structuredClone(graph);
  pathAsAtom.readingPaths[0]!.atoms[0] = pathAsAtom.readingPaths[0]!.id as never;
  assert.match(validateEntityGraph(pathAsAtom).join('\n'), /expects reading-atom, got reading-path/);
  assert.deepEqual(validateEntityGraph(graph), []);
});

test('convergence mechanisms are stored once and shared', () => {
  const graph = fixture();
  assert.equal(graph.convergencePatterns.length, 4);
  assert.equal(graph.readingAtoms.filter((a) => a.kana === 'ほう').length, 1);
  const bound = graph.bindings.flatMap((b) => b.patterns);
  assert.equal(bound.filter((p) => p === makeId('pattern', 'hafu>hou')).length, 2);
  // a binding is keyed by (symbol, modern reading, context), never by symbol alone
  const hou = graph.bindings.filter((b) => b.symbol === makeId('symbol', '法'));
  assert.equal(hou.length, 3);
  assert.throws(() => buildEntityGraph({ ...rawWithDuplicateBinding() }), /duplicate binding/);
});

function rawWithDuplicateBinding() {
  return {
    sources: [], evidence: [], contexts: [], morphemes: [], relations: [], lexemes: [],
    patterns: [{ key: 'hafu>hou', from: ['はふ'], to: ['ほう'] }],
    bindings: [
      { symbol: '法', modern: ['ほう'], context: null, patterns: ['hafu>hou'], evidence: [] },
      { symbol: '法', modern: ['ほう'], context: null, patterns: ['hafu>hou'], evidence: [] }
    ]
  };
}

test('reverse traversal preserves every admissible predecessor and context prunes without order dependence', () => {
  const runtime = createEntityGraphRuntime(fixture());
  // no context: 法 / ほう -> はふ | ほふ (accepted 4.6E authority)
  assert.deepEqual(runtime.reconstruct(['法'], ['ほう']), { status: 'candidates', historical: ['はふ', 'ほふ'] });
  // Buddhist usage selects ほふ
  assert.deepEqual(runtime.reconstruct(['法'], ['ほう'], { context: 'usage:仏教用語' }).historical, ['ほふ']);
  // explicit unqualified context does not invent a non-Buddhist default beyond the unqualified row
  assert.deepEqual(runtime.reconstruct(['法'], ['ほう'], { context: null }).historical, ['はふ']);
  // binding order does not choose a winner
  const reversed = fixture();
  reversed.bindings.reverse();
  reversed.convergencePatterns.reverse();
  assert.deepEqual(createEntityGraphRuntime(reversed).reconstruct(['法'], ['ほう']), runtime.reconstruct(['法'], ['ほう']));
  // reverse index from a modern path lists its candidate patterns
  assert.deepEqual(runtime.patternsToModern(makeId('reading-path', 'ほう')), [makeId('pattern', 'hafu>hou'), makeId('pattern', 'hofu>hou')]);
});

test('path-level convergence reconstructs 文法 ぶんぽう -> ぶんはふ through shared chained patterns', () => {
  const runtime = createEntityGraphRuntime(fixture());
  const result = runtime.reconstruct(['文', '法'], ['ぶん', 'ぽう']);
  assert.equal(result.status, 'resolved');
  assert.deepEqual(result.historical, ['ぶんはふ']);
  assert.deepEqual(result.chains![1], [makeId('pattern', 'hou>pou/n_'), makeId('pattern', 'hafu>hou')]);
  // the environmental pattern does not fire without its left environment
  assert.equal(runtime.reconstruct(['法'], ['ぽう']).status, 'unresolved');
  // unknown symbol stays unresolved rather than failing the whole call
  assert.equal(runtime.reconstruct(['謎'], ['なぞ']).status, 'unresolved');
  // そう -> さう through the shared local pattern
  assert.deepEqual(runtime.reconstruct(['装'], ['そう']).historical, ['さう']);
});

test('canonicalization is deterministic and compact round-trips without erasing types', () => {
  const graph = fixture();
  const shuffled = structuredClone(graph);
  shuffled.lexemes.reverse();
  shuffled.forms.reverse();
  shuffled.readingAtoms.reverse();
  assert.equal(JSON.stringify(canonicalizeEntityGraph(shuffled)), JSON.stringify(canonicalizeEntityGraph(graph)));
  const compact = compactEntityGraph(graph);
  assert.deepEqual(inflateEntityGraph(compact), canonicalizeEntityGraph(graph));
  // compact references are per-namespace dense indexes; a form index cannot be read as a symbol
  const lexemeTable = compact.tables.lexeme;
  assert.ok(Array.isArray(lexemeTable.forms[0]));
  const broken = structuredClone(compact);
  broken.tables.lexeme.forms[0]![0] = compact.tables.form.key.length + 5;
  assert.throws(() => inflateEntityGraph(broken), /form index .* out of range/);
  const confused = structuredClone(compact);
  (confused.schema as Record<string, Record<string, string>>).lexeme!.forms = 'symbol[]';
  assert.throws(() => inflateEntityGraph(confused), /schema mismatch lexeme\.forms/);
});
