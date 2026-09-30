import { resolve } from 'node:path';
import { IntakeLoadError, loadIntakeWorkspace } from './load-intake.ts';
import type { SourceSnapshot } from './intake-model.ts';

function requirePinnedSnapshot(snapshot: SourceSnapshot, file?: string): void {
  const requiresRepositoryPin =
    snapshot.sourceClass === 'committed-reference'
    || snapshot.sourceClass === 'external-repository';

  if (!requiresRepositoryPin) return;
  if (snapshot.repository && snapshot.commit && snapshot.blobSha) return;

  throw new IntakeLoadError(
    'E_INTAKE_UNPINNED_SOURCE',
    `Source ${snapshot.sourceId} must pin repository, commit, and blobSha`,
    file
  );
}

async function main(): Promise<void> {
  const root = resolve(process.env.ORTHOGRAPHY_ROOT ?? process.cwd());

  try {
    const workspace = await loadIntakeWorkspace(root);
    for (const entry of workspace.snapshots) {
      requirePinnedSnapshot(entry.value, entry.location.file);
    }
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
