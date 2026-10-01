import { createRequire } from 'node:module';
import { compileBrowserPack } from '../../tools/browser-pack-compiler.ts';
import { kanaConventionGraph } from '../../tools/kana-rule-normalization.ts';
import { canonicalizeOrthographyKnowledge, type OrthographyKnowledgeGraph } from '../../tools/orthography-knowledge-model.ts';
import { HISTORICAL_PROFILE, KINOTCH_PROFILE, MODERN_PROFILE, withProfileRules } from '../../tools/orthography-policy.ts';

// Shared BrowserPack fixture for the #185 D-I browser tests (no tests in this module).
const { openBrowserPack } = createRequire(import.meta.url)('../../runtime/browser-pack-runtime.js');
const prov = { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] };
const H = ['period:historical-kana'];
const M = ['period:modern'];

export function plannerFixture(): OrthographyKnowledgeGraph {
  const g = withProfileRules(kanaConventionGraph());
  g.sources.push({ sourceId: 'src:fixture' });
  const form = (surface: string) => ({ id: `fact:literal_form:${surface}||`, kind: 'literal_form' as const, lexicalRefs: [`lexeme:${surface}`], surface, periodRefs: M, ...prov });
  const rel = (hist: string, modern: string, tags: string[] = []) => ({ id: `fact:form_relation:${hist}||${modern}`, kind: 'form_relation' as const, lexicalRefs: [], surface: hist, target: modern, periodRefs: H, tags, ...prov });
  g.facts.push(
    form('溶接'), form('溶'), form('する'), form('勘弁'), form('護衛'), form('弁護'), form('装丁'), form('こと'), form('ことば'), form('台風'), form('円'),
    rel('熔接', '溶接', ['lexical_historical_kanji']),
    rel('辯護', '弁護'),
    rel('装幀', '装丁', ['candidate']), rel('装釘', '装丁', ['candidate']),
    rel('颱風', '台風', ['contextual_kanji', 'context:constraint-taifu'])
  );
  g.rules.push({ id: 'rule:char:圓>円', class: 'orthographic', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['圓'], to: ['円'], dependencies: [], predicate: { channel: 'surface' }, ...prov });
  return canonicalizeOrthographyKnowledge(g);
}

export async function plannerPack(graph = plannerFixture()) {
  const build = compileBrowserPack(graph, [MODERN_PROFILE, HISTORICAL_PROFILE, KINOTCH_PROFILE], { shardBudgetBytes: 2048 });
  return { build, pack: await openBrowserPack(build.manifest, async (s: { path: string }) => build.files.get(s.path)!) };
}

