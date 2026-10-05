import test from 'node:test';
import { resolve } from 'node:path';
import { measureRuleProgramModes } from '../tools/measure-browser-rule-program-cutover.ts';

test('record Rule Program cutover measurements for #271 closure', async () => {
  const root = resolve(process.cwd());
  const runs = await measureRuleProgramModes(root);

  console.log('JO271_CUTOVER_MEASUREMENT ' + JSON.stringify({
    schemaVersion: '1',
    main: '8dc9bee7a4965d6a0050fdec96b70476a5614892',
    runs
  }));
});
