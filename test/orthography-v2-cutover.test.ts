import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { buildDefaultResolverBundleArtifact, buildResolverBundleArtifact } from '../tools/resolver-bundle.ts';
import { inflateHotArtifact } from '../tools/orthography-hot-artifact.ts';

// ARCH-V2 I (#173): dual-run the accepted v1 bundle semantics and the orthography-v2 default over
// every accepted fixture surface, classify every difference, and check the cutover invariants.

async function json(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, any>;
}

async function runtimeSandbox() {
  const sandbox: Record<string, any> = {};
  sandbox.globalThis = sandbox;
  for (const file of [
    'runtime/transform-shared.js', 'runtime/lexical-runtime.js', 'runtime/historical-native-runtime.js', 'runtime/historical-sino-runtime.js',
    'runtime/safe-character-runtime.js', 'runtime/orthography-resolver.js', 'runtime/orthography-projection-runtime.js',
    'runtime/orthography-restoration-runtime.js', 'runtime/orthography-hot-runtime.js', 'runtime/resolver-bundle-runtime.js'
  ]) vm.runInNewContext(await readFile(file, 'utf8'), sandbox, { filename: file });
  return sandbox;
}

const v2Artifact = await buildDefaultResolverBundleArtifact(process.cwd());
const { orthographyV2Section: _omit, ...v1Inputs } = {
  lexicalSource: await json('data/lexical/sources/unidic-cwj-202512-first-slice.json'),
  nativeSlice: await json('data/historical/native/phase46d-native-kana.json'),
  sinoSlice: await json('data/historical/sino/phase46e-sino-kana.json'),
  contextualBindingSlice: await json('data/lexical/bindings/contextual-kanji-unidic-first-slice.json'),
  contextualManifest: await json('data/packs/contextual-kanji/manifest.json'),
  contextualTaiPack: await json('data/packs/contextual-kanji/merged-tai.json'),
  safeCharacterSlice: await json('data/deterministic/safe-character-first-slice.json'),
  orthographyV2Section: undefined
};
const v1Artifact = buildResolverBundleArtifact(v1Inputs as any);
const sandbox = await runtimeSandbox();
const v1 = sandbox.ResolverBundleRuntime.createResolverBundle(v1Artifact);
const v2 = sandbox.ResolverBundleRuntime.createResolverBundle(v2Artifact);
const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null));
const withoutTrace = (unit: any) => {
  const copy = plain(unit);
  if (copy?.historical) delete copy.historical.v2;
  return copy;
};

const surfaces = [...new Set((v1Inputs.lexicalSource.records as { surface: string }[]).map((r) => r.surface))].sort();
const readingInputs = ['がっこう', 'きょう', 'こんにち', 'たいふう', 'あわ', 'おもう', 'かう'];
const MODES = ['plain', 'ruby-whole-explicit', 'ruby-whole-implicit', 'ruby-components-explicit', 'ruby-components-implicit'];
// spec-backed v2 differences (#163/#173); empty unless recorded with a reason
const INTENTIONAL_DIFFERENCES = new Map<string, string>();

test('v2 is the default bundle semantics and keeps every v1 compatibility section', () => {
  assert.equal(v2Artifact.bundleSemantics, 'orthography-v2');
  assert.deepEqual(v2Artifact.sections.map((s) => s.id), [...v1Artifact.sections.map((s) => s.id), 'orthography-v2']);
  assert.equal(v2.bundleSemantics, 'orthography-v2');
  const tampered = structuredClone(v2Artifact) as any;
  tampered.orthographyV2.lexemeBridge['x\u0000y'] = ['lexeme:x'];
  assert.throws(() => sandbox.ResolverBundleRuntime.createResolverBundle(tampered), /orthography-v2 section identity mismatch/);
});

test('dual-run over every fixture surface, reading and render mode: no unexplained difference', () => {
  const differences: string[] = [];
  const classify = (label: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (INTENTIONAL_DIFFERENCES.has(label)) return;
    differences.push(label);
  };
  for (const surface of surfaces) {
    const a = v1.resolveUnit(surface);
    const b = v2.resolveUnit(surface);
    classify(`unit:${surface}`, plain(a), withoutTrace(b));
    for (const mode of MODES) classify(`render:${surface}:${mode}`, v1.render(a, { mode }), v2.render(b, { mode }));
  }
  for (const reading of readingInputs) classify(`reading:${reading}`, plain(v1.resolveReading(reading)), withoutTrace(v2.resolveReading(reading)));
  assert.deepEqual(differences, []);
});

test('every resolved v2 unit carries a trace identifying literal-fact vs generated-rule basis', () => {
  let resolved = 0;
  for (const surface of [...surfaces, ...readingInputs]) {
    for (const unit of [v2.resolveUnit(surface), v2.resolveReading(surface)]) {
      if (unit.kind !== 'resolved') continue;
      resolved += 1;
      const trace = unit.historical.v2;
      assert.ok(trace, surface);
      assert.ok(['resolved', 'candidates', 'unresolved'].includes(trace.status));
      assert.ok(['parity', 'v1-only', 'v2-only', 'none'].includes(trace.agreement), `${surface}: ${trace.agreement}`);
      for (const c of trace.candidates) assert.ok(['literal_fact', 'source_rule_binding', 'generated_rule'].includes(c.authority));
    }
  }
  assert.ok(resolved > 0);
  const school = v2.resolveUnit('学校');
  assert.equal(school.historical.kana, 'がくかう');
  assert.equal(school.historical.v2.agreement, 'parity');
  assert.equal(school.historical.v2.candidates[0].authority, 'literal_fact');
});

test('ambiguity and fail-closed cases stay non-forced under v2', () => {
  for (const surface of ['今日', '思う', '未知語']) {
    const a = v1.resolveUnit(surface);
    const b = v2.resolveUnit(surface);
    assert.equal(b.kind, a.kind, surface);
    assert.notEqual(b.kind === 'resolved' && a.kind !== 'resolved', true);
  }
  assert.notEqual(v2.resolveUnit('今日').kind, 'resolved');
});

test('source accounting is complete and irregular data survives cutover as literal facts', async () => {
  const report = await json('data/reports/orthography-v2-source-accounting.json');
  assert.equal(report.totals.unaccounted, 0);
  assert.equal(report.totals.inputRecords, report.totals.disposedRecords);
  const section = inflateHotArtifact(v2Artifact.orthographyV2!.hot);
  assert.ok(section.graph.facts.some((f) => f.surface === '今日' && f.reading === 'けふ' && f.kind === 'literal_reading'));
  assert.ok(!section.graph.rules.some((r) => r.from.includes('けふ') && r.to.includes('きょう') && !section.graph.bindings.some((b) => b.ruleId === r.id)));
  // the accepted source libraries remain on disk as provenance roots
  for (const path of ['data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/kana-jisyo', 'data/lexical/sources/jmdict/2026-10-01/jmdict-lexical-intake.json.gz', 'data/intake/phase46d-native-kana.json']) {
    await readFile(path);
  }
});

test('real-text evaluation under the v2 default keeps the accepted rendering and exposes the v2 trace', async () => {
  const fixture = await json('test/fixtures/real-text/phase35-first-slice.json');
  const evaluatorSandbox: Record<string, any> = {};
  evaluatorSandbox.globalThis = evaluatorSandbox;
  vm.runInNewContext(await readFile('runtime/real-text-evaluation-runtime.js', 'utf8'), evaluatorSandbox);
  const evaluator = evaluatorSandbox.RealTextEvaluationRuntime.createRealTextEvaluator(v2);
  const result = evaluator.evaluate(fixture.sourceText, fixture.spans);
  assert.equal(result.renderedText, fixture.expected.renderedText);
  assert.deepEqual(plain(result.summary), fixture.expected.summary);
  const school = result.trace.find((r: any) => r.sourceText === '学校');
  assert.equal(school.historical.v2.agreement, 'parity');
});
