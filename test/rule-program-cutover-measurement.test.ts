import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import {
  measureRuleProgramMode,
  RULE_PROGRAM_MODES
} from '../tools/measure-browser-rule-program-cutover.ts';

test('record Rule Program cutover measurements for #271 closure', async () => {
  const root = resolve(process.cwd());
  const runs = [];
  for (const mode of RULE_PROGRAM_MODES) {
    runs.push(await measureRuleProgramMode(root, mode));
  }

  const rendered = runs.map((run) => run.cold.renderedText);
  assert.ok(rendered.every((value) => typeof value === 'string' && value.length > 0));
  assert.equal(new Set(rendered).size, 1);

  console.log('JO271_CUTOVER_MEASUREMENT ' + JSON.stringify({
    schemaVersion: '1',
    main: '8dc9bee7a4965d6a0050fdec96b70476a5614892',
    runs
  }));
});
