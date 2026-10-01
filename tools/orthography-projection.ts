import { createRequire } from 'node:module';
import type { OrthographyKnowledgeGraph } from './orthography-knowledge-model.ts';

// ARCH-V2 C (#167): typed façade over the shared forward-projection core
// (runtime/orthography-projection-runtime.js), so TS tooling and browser/worker hosts execute the
// same rule composition.

export interface ProjectionPolicy {
  enabledRuleIds?: string[];
  disabledRuleIds?: string[];
  period?: string | null;
  thresholds?: Record<string, string | number | boolean>;
  /** opt-in rule scopes (e.g. 'sino-component'); scoped rules never fire on free text */
  scopes?: string[];
  /** per-rule parameters for named mechanisms (e.g. iteration boundary offsets) */
  ruleParams?: Record<string, Record<string, unknown>>;
}

export interface CanonicalOrthographyState {
  lexicalIdentity: string | null;
  surface: string;
  reading: string | null;
  morphology: Record<string, string> | null;
  factIds: string[];
  retainedDistinctions: Record<string, string>;
}

export interface ProjectionStep { ruleId: string; before: CanonicalOrthographyState; after: CanonicalOrthographyState; evidenceRefs: string[] }
export interface ProjectionResult {
  state: CanonicalOrthographyState;
  steps: ProjectionStep[];
  blockedRules: { ruleId: string; reason: string }[];
  /** literal facts that directly attest the projected output */
  attestedBy: string[];
  authority: 'source_attested' | 'generated' | 'identity';
}

const core = createRequire(import.meta.url)('../runtime/orthography-projection-runtime.js') as {
  compileRuleOrder(graph: OrthographyKnowledgeGraph, policy: ProjectionPolicy): string[];
  projectOrthography(state: CanonicalOrthographyState, graph: OrthographyKnowledgeGraph, policy: ProjectionPolicy): ProjectionResult;
};

export function compileRuleOrder(graph: OrthographyKnowledgeGraph, policy: ProjectionPolicy): string[] {
  return core.compileRuleOrder(graph, policy);
}

export function projectOrthography(state: CanonicalOrthographyState, graph: OrthographyKnowledgeGraph, policy: ProjectionPolicy): ProjectionResult {
  return core.projectOrthography(state, graph, policy);
}
