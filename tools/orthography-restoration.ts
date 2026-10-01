import { createRequire } from 'node:module';
import type { OrthographyKnowledgeGraph } from './orthography-knowledge-model.ts';
import type { CanonicalOrthographyState, ProjectionPolicy } from './orthography-projection.ts';

// ARCH-V2 F (#170): typed façade over runtime/orthography-restoration-runtime.js (shared with
// browser/worker hosts). See the runtime for the restoration semantics.

export interface RestorationQuery {
  observedSurface: string;
  observedReading?: string | null;
  lexicalCandidates: string[];
  context?: Record<string, string> | null;
  targetPolicy: ProjectionPolicy;
  /** a state already carrying finer identity (e.g. a previous projection result) */
  knownState?: CanonicalOrthographyState;
}

export interface RestorationCandidate {
  state: CanonicalOrthographyState;
  basis: 'retained_identity' | 'reverse_traversal' | 'forward_agreement';
  ruleChain: string[];
  sourceRefs: string[];
  evidenceRefs: string[];
}

export interface RestorationResult {
  status: 'resolved' | 'candidates' | 'unresolved';
  candidates: RestorationCandidate[];
}

const core = createRequire(import.meta.url)('../runtime/orthography-restoration-runtime.js') as {
  restoreOrthography(query: RestorationQuery, graph: OrthographyKnowledgeGraph): RestorationResult;
};

export function restoreOrthography(query: RestorationQuery, graph: OrthographyKnowledgeGraph): RestorationResult {
  return core.restoreOrthography(query, graph);
}
