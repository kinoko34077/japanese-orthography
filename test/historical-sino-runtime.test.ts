import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadRuntime(path: string, globals: Record<string, unknown> = {}) {
  let source = '';
  try { source = await readFile(path, 'utf8'); } catch { /* RED before runtime exists */ }
  const sandbox: Record<string, any> = { ...globals };
  sandbox.globalThis = sandbox;
  if (source) vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
}

test('historical Sino runtime resolves a source-backed relation by lexical identity', async () => {
  const sandbox = await loadRuntime('runtime/historical-sino-runtime.js');
  assert.equal(typeof sandbox.HistoricalSinoRuntime?.createHistoricalSinoRuntime, 'function');

  const runtime = sandbox.HistoricalSinoRuntime.createHistoricalSinoRuntime({
    schemaVersion: '1',
    kind: 'japanese-orthography-historical-sino-slice',
    lexicalNamespaceId: 'namespace-1',
    source: {
      repository: 'example/source',
      commit: '0123456789abcdef0123456789abcdef01234567',
      file: 'jion-jisyo',
      blobSha: '0123456789abcdef0123456789abcdef01234567'
    },
    relations: [{
      lexicalIdentity: 'namespace-1:lemma:1',
      surface: '学校',
      modernReading: 'がっこう',
      historicalReading: 'がくかう',
      components: [
        { surface: '学', modernReading: 'がく', historicalReading: 'がく', readingClass: 'on' },
        { surface: '校', modernReading: 'こう', historicalReading: 'かう', readingClass: 'on' }
      ],
      evidenceRefs: ['source:jion:school']
    }]
  }, { lexicalNamespaceId: 'namespace-1' });

  const relation = runtime.lookup({ lexicalIdentity: 'namespace-1:lemma:1', lexicalOrigin: 'sino' });
  assert.equal(relation.route, 'sino');
  assert.equal(relation.reading, 'がくかう');
  assert.deepEqual(Array.from(relation.components, (component: any) => [
    component.surface,
    component.lexicalReading,
    component.historicalKana,
    component.readingClass
  ]), [
    ['学', 'がく', 'がく', 'on'],
    ['校', 'こう', 'かう', 'on']
  ]);
});
