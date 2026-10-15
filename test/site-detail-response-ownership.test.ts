import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

// #369: exercise the *real page boot/event handlers* with reordered worker replies.
const require = createRequire(import.meta.url);
const app = require('../site/app.js');
const dictionary = JSON.parse(await readFile(new URL('../site/terminology-ja.json', import.meta.url), 'utf8'));

const tick = async () => { await new Promise<void>((resolve) => setImmediate(resolve)); };
function detail(sourceText: string) {
  return { detail: { kind: 'unit', sourceText, recognition: { resolved: true, changed: false },
    reading: null, historical: null, lexemes: [], morphologyContext: { available: false, note: '未取得' },
    inflection: null, candidateForms: [], lexicalIdentity: null,
    provenance: { sourceRefs: [], evidenceRefs: [] },
    profileEffects: { profileId: 'historical', period: null }, renderMode: 'plain',
    range: { start: 0, end: 1 } } };
}

function fixture() {
  const controls = new Map<string, any>();
  const listeners = new Map<string, (event?: any) => void>();
  function element(id: string) {
    if (!controls.has(id)) controls.set(id, {
      id, value: '', innerHTML: '', textContent: '', hidden: false,
      checked: false, disabled: false, isConnected: true, className: '', dataset: {},
      attrs: new Map<string, string>(),
      setAttribute(name: string, value: string) { this.attrs.set(name, value); },
      getAttribute(name: string) { return this.attrs.get(name); },
      addEventListener(type: string, fn: (event?: any) => void) { listeners.set(id + ':' + type, fn); },
      querySelectorAll() { return []; },
      focus() {}
    });
    return controls.get(id);
  }
  for (const id of ['status', 'source', 'copy', 'convert', 'result', 'summary', 'detail',
    'detail-body', 'diagnostic-legend', 'diagnostic-options', 'engine-info', 'policy',
    'render-modes', 'notation-group', 'auto', 'inspect']) element(id);
  let view = 'diagnostic';
  const radios = new Map<string, any[]>();
  radios.set('input[name="resultView"]', [{ addEventListener(type: string, fn: (event?: any) => void) {
    listeners.set('view:' + type, fn);
  }}]);
  const doc = {
    getElementById: element,
    querySelector(selector: string) {
      if (selector === 'input[name="profile"]:checked') return { value: 'historical' };
      if (selector === 'input[name="resultView"]:checked') return { value: view };
      if (selector === 'input[name="rubyTarget"]:checked') return { value: 'none' };
      if (selector === 'input[name="rubyNotation"]:checked') return { value: 'implicit' };
      return null;
    },
    querySelectorAll(selector: string) { return radios.get(selector) ?? []; },
    addEventListener(type: string, fn: (event?: any) => void) { listeners.set('document:' + type, fn); },
    createElement() { return { addEventListener() {}, textContent: '', type: '' }; }
  };
  const pending: Array<{ resultId: string; ref: string; resolve: (v: unknown) => void; reject: (e: Error) => void }> = [];
  let next = 0;
  const client = {
    open: async () => ({ packDigest: '0123456789abcdef', renderModes: ['plain'] }),
    transform: async () => ({ requestId: 'result-' + ++next, stale: false, elapsedMs: 1,
      result: { renderedText: 'AB', counts: { unique: 2, conditional: 0, unresolved: 0 },
        spans: [
          { renderedStart: 0, renderedEnd: 1, sourceText: 'A', renderedText: 'A', detailRef: '0', certainty: 'unique', changed: true },
          { renderedStart: 1, renderedEnd: 2, sourceText: 'B', renderedText: 'B', detailRef: '1', certainty: 'unique', changed: true }
        ], units: [] } }),
    detail: (resultId: string, ref: string) => new Promise((resolve, reject) => pending.push({ resultId, ref, resolve, reject })),
    restart() {}
  };
  const win = {
    document: doc, navigator: { onLine: true }, location: { href: 'https://example.test/' },
    fetch: async (url: string) => ({ json: async () => url.endsWith('terminology-ja.json')
      ? dictionary : { sections: [], compilerVersion: '3' } }),
    WorkerClient: { createWorkerClient: () => client },
    addEventListener() {},
  };
  app.boot(win);
  const convert = async () => { listeners.get('convert:click')?.(); await tick(); await tick(); };
  const mark = (ref: string) => ({
    isConnected: true, dataset: { ref }, attrs: new Map<string,string>(),
    setAttribute(name: string, value: string) { this.attrs.set(name, value); },
    getAttribute(name: string) { return this.attrs.get(name); },
    focus() {}
  });
  const activate = (target: any) => listeners.get('result:click')?.({
    target: { closest: (selector: string) => selector === '.diag[data-ref]' ? target : null },
    type: 'click', preventDefault() {}
  });
  return {
    pending, controls, listeners, mark, activate, convert,
    setView(value: string) { view = value; listeners.get('view:change')?.(); },
    close() { listeners.get('detail-close:click')?.(); },
    escape() { listeners.get('document:keydown')?.({ key: 'Escape' }); },
    get html() { return controls.get('detail-body').innerHTML as string; },
    get hidden() { return controls.get('detail').hidden as boolean; }
  };
}

test('detail A delayed after B cannot overwrite current selection', async () => {
  const ui = fixture(); await tick(); await ui.convert();
  const a = ui.mark('0'), b = ui.mark('1');
  ui.activate(a); ui.activate(b);
  assert.equal(ui.pending.length, 2);
  ui.pending[1]!.resolve(detail('B')); await tick();
  assert.match(ui.html, /「B」/);
  ui.pending[0]!.resolve(detail('A')); await tick();
  assert.match(ui.html, /「B」/);
  assert.doesNotMatch(ui.html, /「A」/);
  assert.equal(b.getAttribute('aria-pressed'), 'true');
});

test('older detail failure cannot replace newer successful information', async () => {
  const ui = fixture(); await tick(); await ui.convert();
  ui.activate(ui.mark('0')); ui.activate(ui.mark('1'));
  ui.pending[1]!.resolve(detail('B')); await tick();
  ui.pending[0]!.reject(Error('old request failed')); await tick();
  assert.match(ui.html, /「B」/);
  assert.doesNotMatch(ui.html, /old request failed/);
});

test('detail close, Escape and mode switch revoke in-flight requests', async () => {
  for (const mode of ['close','escape','clean']) {
    const ui = fixture(); await tick(); await ui.convert();
    ui.activate(ui.mark('0'));
    if (mode === 'close') ui.close();
    if (mode === 'escape') ui.escape();
    if (mode === 'clean') ui.setView('clean');
    ui.pending[0]!.resolve(detail('A')); await tick();
    assert.equal(ui.hidden, true, mode);
    assert.doesNotMatch(ui.html, /「A」/, mode);
  }
});

test('fresh conversion revokes prior detail before and after completion', async () => {
  const ui = fixture(); await tick(); await ui.convert();
  ui.activate(ui.mark('0'));
  await ui.convert();
  ui.pending[0]!.resolve(detail('A')); await tick();
  assert.equal(ui.hidden, true);
  assert.doesNotMatch(ui.html, /「A」/);
});

test('normal fresh detail still renders and rebound result nodes invalidate it', async () => {
  const ui = fixture(); await tick(); await ui.convert();
  const a=ui.mark('0');
  ui.activate(a);
  ui.pending[0]!.resolve(detail('A')); await tick();
  assert.match(ui.html, /「A」/);
  ui.setView('diagnostic');
  assert.equal(ui.hidden, true);
  assert.equal(a.getAttribute('aria-pressed'),'false');
});
