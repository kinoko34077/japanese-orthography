import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { arbitrate } = require('../runtime/occurrence-arbitration.js');

const candidate = (key: string, policy: string, extra: Record<string, unknown> = {}) => ({
  key, start: 0, end: 2, output: '置換', policy, ...extra
});
const dagEdges = () => [
  { start: 2, end: 4, internal: [], units: [] },
  { start: 0, end: 2, internal: [], units: [{ start: 0, end: 2, lexemes: ['target'], morphology: null }] },
  { start: 1, end: 4, internal: [], units: [] },
  { start: 0, end: 1, internal: [], units: [] }
];
const run = (edges: ReturnType<typeof dagEdges>, candidates: Record<string, unknown>[]) =>
  arbitrate({ length: 4, lexical: { dag: { length: 4, edges } }, candidates });

test('#340 normalizes unordered DAG edges without mutating input and preserves ambiguous boundaries', () => {
  const edges = dagEdges();
  const original = structuredClone(edges);
  const candidates = [candidate('boundary', 'lexical_boundary')];
  const observed = run(edges, candidates);
  assert.deepEqual(edges, original, 'normalization must not sort original lexical DAG in place');
  assert.deepEqual(observed.blocked.map((b: any) => [b.candidate.key, b.reason]),
    [['boundary', 'ambiguous_lexical_boundary']]);
  assert.deepEqual(run([...edges].reverse(), candidates), observed, 'DAG edge input ordering must not change decisions');
});

test('#340 repeated quantification with unit identity keeps partial vs all outcomes and stable ties', () => {
  const edges = dagEdges();
  edges.push({ start: 0, end: 2, internal: [], units: [] });
  const original = structuredClone(edges);
  const candidates = [candidate('unit', 'whole_lexeme', { lexicalIdentity: 'target' })];
  const first = run(edges, candidates);
  assert.deepEqual(run([...edges].reverse(), candidates), first);
  assert.ok(first.blocked.some((b: any) => b.candidate.key === 'unit'));
  assert.deepEqual(edges, original);
  const all = run([edges[0]!, edges[1]!], [candidate('boundary', 'lexical_boundary')]);
  assert.deepEqual(all.accepted.map((c: any) => c.key), ['boundary']);
});

test('#340 explicit lexical paths and invalid DAG edges preserve prior contracts', () => {
  const paths = arbitrate({
    length: 4, lexical: { paths: [{ boundaries: [0, 2, 4], units: [] }] },
    candidates: [candidate('paths', 'lexical_boundary')]
  });
  assert.deepEqual(paths.accepted.map((c: any) => c.key), ['paths']);
  assert.throws(() => run([{ start: -1, end: 2, internal: [], units: [] }], [candidate('invalid', 'lexical_boundary')]),
    /Invalid lexical DAG edge/);
});
