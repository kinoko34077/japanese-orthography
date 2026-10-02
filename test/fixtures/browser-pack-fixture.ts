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

/** #196 B+: lexeme-centric fixture (surface/reading convergence, candidate sets, kana-only lexemes). */
export function lexicalFixture(): OrthographyKnowledgeGraph {
  const g = plannerFixture();
  const form = (lexeme: string, surface: string, tags?: string[]) => ({ id: `fact:literal_form:${surface}|${lexeme}`, kind: 'literal_form' as const, lexicalRefs: [lexeme], surface, periodRefs: M, ...(tags ? { tags } : {}), ...prov });
  const reading = (lexeme: string, surface: string | undefined, r: string, period = M) => ({ id: `fact:literal_reading:${surface ?? ''}|${r}|${lexeme}|${period[0]}`, kind: 'literal_reading' as const, lexicalRefs: [lexeme], ...(surface ? { surface } : {}), reading: r, periodRefs: period, ...prov });
  g.facts.push(
    form('lexeme:学校/がっこう', '学校'), reading('lexeme:学校/がっこう', '学校', 'がっこう'), reading('lexeme:学校/がっこう', '學校', 'がっこう'),
    reading('lexeme:学校/がっこう', '学校', 'がくかう', H),
    form('lexeme:楽校/がっこう', '楽校'), reading('lexeme:楽校/がっこう', '楽校', 'がっこう'),
    form('lexeme:独逸/ドイツ', '独逸', ['ateji', 'rK']), form('lexeme:独逸/ドイツ', '独乙', ['ateji']),
    reading('lexeme:独逸/ドイツ', '独逸', 'ドイツ'), reading('lexeme:独逸/ドイツ', '独乙', 'ドイツ'),
    form('lexeme:見る/みる', '見る'), form('lexeme:見る/みる', '観る'), reading('lexeme:見る/みる', '見る', 'みる'), reading('lexeme:見る/みる', '観る', 'みる'),
    form('lexeme:診る/みる', '診る'), reading('lexeme:診る/みる', '診る', 'みる'),
    reading('lexeme:ドキドキ/ドキドキ', undefined, 'ドキドキ')
  );
  return canonicalizeOrthographyKnowledge(g);
}

/** #196 D/E: adapter fixture — contextual binding, native kana relations, 今日 with several readings. */
export function adapterFixture(): OrthographyKnowledgeGraph {
  const g = lexicalFixture();
  const P = { sourceRefs: ['src:fixture'], evidenceRefs: ['ev:fixture'] };
  const MOD = ['period:modern'];
  const HIST = ['period:historical-kana'];
  g.facts.push(
    { id: 'fact:literal_form:台頭', kind: 'literal_form', lexicalRefs: ['lexeme:台頭/たいとう'], surface: '台頭', periodRefs: MOD, ...P },
    { id: 'fact:literal_reading:台頭|たいとう', kind: 'literal_reading', lexicalRefs: ['lexeme:台頭/たいとう'], surface: '台頭', reading: 'たいとう', periodRefs: MOD, ...P },
    { id: 'fact:form_relation:擡頭||台頭', kind: 'form_relation', lexicalRefs: ['lexeme:台頭/たいとう'], surface: '擡頭', target: '台頭', periodRefs: HIST, tags: ['contextual_kanji', 'context:constraint-taito'], ...P },
    { id: 'fact:form_relation:がくかう||がっこう', kind: 'form_relation', lexicalRefs: [], surface: 'がくかう', target: 'がっこう', periodRefs: HIST, tags: ['historical_kana_native'], ...P },
    { id: 'fact:form_relation:けふ||きょう', kind: 'form_relation', lexicalRefs: [], surface: 'けふ', target: 'きょう', periodRefs: HIST, tags: ['historical_kana_native'], ...P },
    { id: 'fact:literal_form:今日', kind: 'literal_form', lexicalRefs: ['lexeme:今日/きょう'], surface: '今日', periodRefs: MOD, ...P },
    { id: 'fact:literal_reading:今日|きょう', kind: 'literal_reading', lexicalRefs: ['lexeme:今日/きょう'], surface: '今日', reading: 'きょう', periodRefs: MOD, ...P },
    { id: 'fact:literal_reading:今日|こんにち', kind: 'literal_reading', lexicalRefs: ['lexeme:今日/きょう'], surface: '今日', reading: 'こんにち', periodRefs: MOD, ...P },
    { id: 'fact:literal_reading:今日|けふ', kind: 'literal_reading', lexicalRefs: [], surface: '今日', reading: 'けふ', periodRefs: HIST, tags: ['historical_kana_native'], ...P }
  );
  g.rules.push({ id: 'rule:char:學>学', class: 'orthographic', directionality: 'reverse_traversable', lossiness: 'lossless', from: ['學'], to: ['学'], dependencies: [], predicate: { channel: 'surface' }, ...P });
  return canonicalizeOrthographyKnowledge(g);
}
