import { IntakeLoadError, loadIntakeWorkspace } from './load-intake.ts';

async function main(): Promise<void> {
  const rootDir = process.env.ORTHOGRAPHY_ROOT ?? process.cwd();

  try {
    const workspace = await loadIntakeWorkspace(rootDir);
    console.log(`Phase 4.6 intake validation OK: ${workspace.snapshots.length} snapshots, ${workspace.records.length} records`);
  } catch (error) {
    if (error instanceof IntakeLoadError) {
      const location = error.file ? ` ${error.file}` : '';
      console.error(`${error.code}${location}: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

await main();
