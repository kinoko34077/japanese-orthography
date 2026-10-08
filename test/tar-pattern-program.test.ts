import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildAcceptedBrowserPackV3 } from '../tools/generate-browser-pack.ts';
import { normalizeAcceptedOrthographySources } from '../tools/orthography-source-normalization.ts';
import { withProfileRules } from '../tools/orthography-policy.ts';
import { compileRuleIR } from '../tools/rule-ir.ts';

const require = createRequire(import.meta.url);
const { openBrowserPack } = require('../runtime/browser-pack-runtime.js');
const { createTransformService } = require('../runtime/browser-transform-worker.js');

test('TAR pattern seven lower as profile-scoped program mechanisms, not exact text', async () => {
  const { graph } = await normalizeAcceptedOrthographySources(process.cwd());
  const ir = compileRuleIR(withProfileRules(graph));
  const patterns = ir.rules.filter((rule) => rule.ruleId.startsWith('rule:tar:pattern:'));
  assert.equal(patterns.length, 7);
  assert.equal(patterns.reduce((sum, rule) => sum + rule.branches.length, 0), 8);
  assert.ok(patterns.every((rule) =>
    rule.kind === 'profile-style' && rule.stage === 'profile'
    && rule.origin === 'tar' && rule.enabledBy?.length === 1
    && rule.enabledBy[0] === 'kinotch-fixed'
    && rule.predicate?.tokenContext?.tarPattern));
});

test('VM pattern scan preserves wildcard suffix, candidate sets, POS gates and fixed regex captures', async () => {
  const build = await buildAcceptedBrowserPackV3(fileURLToPath(new URL('..', import.meta.url)));
  const service = createTransformService({
    executionMode: 'vm-authoritative',
    openPack: () => openBrowserPack(build.manifest, async (section: { path: string }) => build.files.get(section.path)!)
  });
  const token = (surface: string, pos: string, pos1 = '') => ({
    surface_form: surface, basic_form: surface, pos, pos_detail_1: pos1,
    pos_detail_2: '', pos_detail_3: '', conjugated_type: '', conjugated_form: '',
    reading: '', pronunciation: '', word_type: ''
  });
  let id = 0;
  const execute = async (value: string, pos?: string, pos1 = '', profileId = 'kinotch-fixed') => {
    const result = await service.handle({
      type: 'transform', requestId: ++id, text: value, profileId,
      renderMode: 'plain', executionMode: 'vm-authoritative',
      ...(pos === undefined ? {} : { tokenWindow: { tokens: [token(value, pos, pos1)], index: 0 } })
    });
    assert.equal(result.type, 'result', result.message);
    const runs = (result.result?.programTrace?.runs ?? []).filter((row: any) =>
      row.lookupSequenceId === -1 && row.stage === 'profile'
    );
    return { result: result.result, runs, outputs: runs.flatMap((run: any) =>
      run.edges.map((edge: any) => edge.output)) };
  };

  const alternatives = await execute('による', '助詞', '格助詞');
  assert.deepEqual(new Set(alternatives.outputs), new Set(['に依', 'に因']));
  const invalidPos = await execute('による', '動詞');
  assert.deepEqual(invalidPos.outputs, []);
  const wrongProfile = await execute('による', '助詞', '格助詞', 'historical');
  assert.deepEqual(wrongProfile.outputs, []);

  const suffix = await execute('まずも', '副詞');
  assert.ok(suffix.outputs.includes('先ず'));
  const invalidSuffixPos = await execute('まずも', '名詞');
  assert.deepEqual(invalidSuffixPos.outputs, []);

  const regex = await execute('2026年10月8日');
  assert.deepEqual(regex.outputs, ['2026/10/8']);
  const invalidRegex = await execute('2026年123月8日');
  assert.deepEqual(invalidRegex.outputs, []);
});
