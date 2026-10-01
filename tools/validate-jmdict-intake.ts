import { resolve } from 'node:path';
import { JMDICT_FIELD_CONTRACT, loadJmdictIntake, validateJmdictIntake } from './jmdict-intake.ts';

async function main(): Promise<void> {
  const rootDir = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());
  const { extract, accounting, manifest } = await loadJmdictIntake(rootDir);
  const diagnostics = validateJmdictIntake(extract, accounting);
  if (JSON.stringify(manifest.fieldContract) !== JSON.stringify(JMDICT_FIELD_CONTRACT)) diagnostics.push('manifest field contract drifted from tools/jmdict-intake.ts');
  if (manifest.historicalAuthority !== false) diagnostics.push('JMdict intake must not claim historical authority');
  if (manifest.license?.id !== 'CC-BY-SA-4.0') diagnostics.push('JMdict licence record missing');
  if (diagnostics.length) throw new Error(`JMdict intake validation failed:\n${diagnostics.join('\n')}`);
  console.log(`Phase 4.8A JMdict intake validation OK: ${extract.length} entries (${accounting.createdDate})`);
}

await main();
