import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { buildAcceptedBrowserPack } from '../tools/generate-browser-pack.ts';

async function binaryApi() {
  const sandbox: Record<string, any> = { TextDecoder, Uint8Array, ArrayBuffer, DataView, Uint16Array, Uint32Array };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(await readFile('runtime/browser-pack-binary.js', 'utf8'), sandbox, { filename: 'runtime/browser-pack-binary.js' });
  return sandbox.BrowserPackBinary as { decodeSection: (body: Uint8Array) => any };
}

async function adapterApi() {
  const source = await readFile('runtime/browser-resolver-adapter.js', 'utf8');
  const sandbox: Record<string, any> = {
    globalThis: null,
    TransformShared: {},
    BrowserSpanPlanner: { assemble: () => ({}) },
    OrthographyResolver: { createResolver: () => ({}) },
    BrowserInflection: {},
    HistoricalSinoRuntime: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'runtime/browser-resolver-adapter.js' });
  return sandbox.BrowserResolverAdapter;
}

test('source-backed component alignment admits unknown origin only when every component has evidence', async () => {
  const api = await adapterApi();
  assert.equal(api.evaluateSinoApplicability({ lexicalOrigin: 'unknown' }, {
    status: 'resolved',
    components: [{ evidenceRefs: ['phase46e-sino-reading-class:row:446:column:E:char:必'] }, { evidenceRefs: ['phase46e-sino-table:row:67:token:0'] }]
  }), 'source-backed-components');
  assert.equal(api.evaluateSinoApplicability({ lexicalOrigin: 'unknown' }, {
    status: 'resolved',
    components: [{ evidenceRefs: [] }]
  }), null);
  assert.equal(api.evaluateSinoApplicability({ lexicalOrigin: 'unknown' }, {
    status: 'candidates',
    historicalReadings: ['候補1', '候補2']
  }), null);
  assert.equal(api.evaluateSinoApplicability({ lexicalOrigin: 'sino' }, {
    status: 'resolved',
    components: [{ evidenceRefs: [] }]
  }), 'lexical-origin');
});

test('production compact index retains every reading class within the eager budget', async () => {
  const build = await buildAcceptedBrowserPack(process.cwd());
  const manifest = build.manifest;
  const eagerBytes = manifest.sections.filter((section: any) => section.loading === 'eager').reduce((total: number, section: any) => total + section.byteLength, 0);
  const index = manifest.sections.find((section: any) => section.kind === 'sino-component-index');
  assert.ok(index, 'production pack must carry the compact Sino component index');
  assert.ok(eagerBytes < 1024 * 1024, `eager ${eagerBytes}`);
  const body = build.files.get(index.path);
  assert.ok(body, `compiled body ${index.path}`);
  const section = (await binaryApi()).decodeSection(body);
  const flags = new Set<number>();
  for (let i = 0; i < section.rowCount('classFlags'); i += 1) flags.add(section.value('classFlags', i));
  assert.equal([...flags].reduce((all, flag) => all | flag, 0), 15);
  assert.ok([...flags].some((flag) => (flag & (flag - 1)) !== 0), 'ambiguous multi-class evidence must remain represented');
});
