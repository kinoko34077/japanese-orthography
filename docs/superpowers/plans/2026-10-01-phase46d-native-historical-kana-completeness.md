# Phase 4.6D Native Historical-Kana Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every selected native historical-kana source record mechanically discoverable, dispositioned, provenance-locked and directly reproducible where its target is uniquely supported, while preserving ambiguity and preventing source-order or substring authority.

**Architecture:** Reuse the accepted Phase-4.6 intake/accounting model instead of creating a second completeness system. Parse the exact pinned KKH `kana-jisyo` plus the four selected committed HTML snapshots into deterministic source records, classify every discovered record into the existing intake dispositions, compile only safe admitted/candidate native authority, and extend the existing historical-native runtime with exact-source resolution while preserving its lexical-identity/morphology path. The runtime never executes KKH's sequential-replacement ordering and never performs literal substring fallback.

**Tech Stack:** Node.js >=22, TypeScript/tsx, existing `node:test` suite, existing Phase-4.6 intake/accounting modules, browser/Worker-compatible plain-JS historical-native runtime.

**Spec:** `docs/superpowers/specs/2026-09-30-phase46-orthography-completeness-design.md` §§5.1, 6–9, 14–18; owner `#70`.

## Global Constraints

- Accepted baseline: `japanese-orthography@8b1a9c207491d19a82a3cf1c09eb32cf6e7a94cb`; post-main Verify `36747447448` PASS.
- KKH source is exactly `okikae/kkh@19b24f88ab55809a186d88c465959548495b26a2:kana-jisyo`, blob `6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be`, BSD-2-Clause.
- Committed coverage snapshots are exactly:
  - `仮名遣等資料/仮名遣い辞典本文.html` blob `45380ff7690e177afa7c980f3f4ffd873b38d928`;
  - `仮名遣等資料/例外動詞一覧：歴史的仮名遣い教室.html` blob `57a50297fb2454e702d6f7b3450cd3cdd7e9cb9a`;
  - `仮名遣等資料/動物名・植物名歴史的仮名遣い辞典.html` blob `9eb26e76343526fe5cc8b17d1113f80414c4bf21`;
  - `仮名遣等資料/歴史的仮名遣いで書きたい.html` blob `232cb508e1fdae0c5ec2e17a57409f20cde28756`.
- All five snapshots are `coverage-contract`; discovered = admitted + candidate_ambiguous + excluded_unresolved, with zero mapping-shaped parser remainder.
- KKH commented mapping-shaped lines are discovered as disabled records and cannot become hot authority merely by parsing.
- Same modern input with multiple source-supported targets remains a complete candidate set unless accepted lexical/morphological identity safely separates it; source/file order never selects a winner.
- Exact lexical identity + morphology outranks exact lexical surface; exact lexical surface outranks any generated paradigm; there is no literal substring fallback.
- A committed dictionary entry that supplies historical reading rather than a safe replacement surface is represented as reading evidence; it must not replace a kanji headword with kana merely to satisfy completeness.
- Do not fabricate UniDic IDs or morphology. Existing accepted identity/morphology (for example `思う`) may be reused where already committed.
- No 4.6E 字音 implementation, 4.6F profile migration, consumer change, Phase 5/6, release/deploy/publication, credential/permission mutation, destructive/shared-history operation, or RDC.

## Review Focus

1. **KKH duplicates/order dependencies:** duplicate modern surfaces with distinct targets must yield candidates independent of line order; test in Task 3.
2. **Disabled KKH rows:** commented mapping-shaped rows must be counted and excluded, never executable; test in Tasks 1–2.
3. **HTML reading-vs-surface semantics:** kanji headwords with historical kana readings must resolve as reading evidence without surface replacement; test in Tasks 1 and 4.
4. **Parser drift/remainders:** unseen transformation-like syntax in any coverage snapshot must fail coverage accounting rather than disappear; test in Task 2.
5. **Resolver false positives:** exact-surface fallback must require native lexical origin/exact surface and must not match substrings or sino candidates; test in Task 4.

---

### Task 1: Deterministic selected-source extraction

**Files:**
- Create: `data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/kana-jisyo`
- Create: `data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/LICENSE`
- Create: `tools/phase46d-native-source.ts`
- Create: `test/phase46d-native-source-parser.test.ts`
- Read only: the four selected `仮名遣等資料/*.html` snapshots.

**Interfaces:**
- Produces `NativeSourceDiscovery` with one exact `SourceSnapshot`, stable `discoveredRecordIds`, normalized `NativeDiscoveredRecord[]`, and `ParserRemainder[]` per source.
- Produces `discoverPhase46dNativeSources(rootDir: string): Promise<NativeSourceDiscovery[]>` for Task 2.

- [ ] **Step 1: Write RED tests for KKH active/disabled/duplicate parsing and exact pin identity.**
  Assert that active `surface /historical ;note` lines become enabled mapping records, `;surface /historical ;note` lines become disabled mapping records, ordinary comments are not mappings, line/record IDs are stable, and reversed parser input order cannot erase duplicate targets.
- [ ] **Step 2: Write RED tests for each committed HTML parser.**
  Pin the four blob SHAs above; assert representative dictionary, exception, animal/plant and rule/example structures are mechanically discovered. Assert dictionary entries distinguish `historicalReading` from `historicalSurface` when the left side is a lexical/kanji headword.
- [ ] **Step 3: Run focused tests and verify RED.**
  Run `node --import tsx --test test/phase46d-native-source-parser.test.ts`; expected failure because `tools/phase46d-native-source.ts` and the vendored KKH snapshot do not exist.
- [ ] **Step 4: Vendor the exact pinned KKH source/license and implement the deterministic parsers.**
  `parseKkhKana(text, snapshot)`, `parseKanaDictionaryHtml(html, snapshot)`, `parseExceptionVerbHtml(html, snapshot)`, `parseAnimalPlantHtml(html, snapshot)`, and `parseHistoricalKanaRuleHtml(html, snapshot)` must preserve source locator, raw/source text, enabled/disabled state, modern key where explicit, historical surface/reading where explicit, alternatives where explicit, and remainder classification.
- [ ] **Step 5: Re-run focused tests and verify GREEN.**
- [ ] **Step 6: Commit.**

### Task 2: Coverage-contract intake generation and accounting

**Files:**
- Create: `tools/phase46d-native-intake.ts`
- Create: `tools/generate-phase46d-native-intake.ts`
- Create: `data/intake/phase46d-native-kkh.json`
- Create: `data/intake/phase46d-native-dictionary.json`
- Create: `data/intake/phase46d-native-exception-verbs.json`
- Create: `data/intake/phase46d-native-animal-plant.json`
- Create: `data/intake/phase46d-native-rules.json`
- Create: `test/phase46d-native-coverage.test.ts`
- Modify: `tools/validate-intake.ts` only to wire the Phase-4.6D discovery/accounting gate into the existing validation path.

**Interfaces:**
- Consumes `discoverPhase46dNativeSources(rootDir)` from Task 1 and existing `buildCoverageSummary` / `validateCoverageAccounting`.
- Produces deterministic `IntakeBundleDocument` data and `validatePhase46dNativeCoverage(rootDir, intakeWorkspace): Promise<Diagnostic[]>`.

- [ ] **Step 1: Write RED coverage tests.**
  Assert all five snapshots use `coverage-contract`; all discovered source locators have exactly one disposition; active unique KKH mappings are admitted, distinct-target duplicates are `candidate_ambiguous`, disabled KKH mappings are `excluded_unresolved/source_disabled`; complex HTML entries may be explicitly excluded but may not disappear.
- [ ] **Step 2: Add parser-remainder mutation tests.**
  Inject a mapping-shaped unknown KKH line and an unknown transformation-like HTML element; expect `E_COVERAGE_UNPARSED_MAPPING`. Remove a generated intake record; expect `E_COVERAGE_UNCLASSIFIED`.
- [ ] **Step 3: Run focused tests and verify RED.**
- [ ] **Step 4: Implement deterministic classification/generation.**
  Classification rules must be explicit and machine-readable. For committed dictionary entries, admit safe exact historical surface/readings where the source is unambiguous; use candidates for explicit alternatives; otherwise preserve as `excluded_unresolved` with a concrete reason such as `reading_only_requires_lexical_binding`, `complex_source_entry`, or `non_transformational_explanation` rather than guessing.
- [ ] **Step 5: Wire 4.6D coverage validation into `npm run validate:intake`.**
- [ ] **Step 6: Regenerate all five intake files and assert regeneration byte-for-byte determinism.**
- [ ] **Step 7: Run `npm run validate:intake` and focused tests; verify GREEN.**
- [ ] **Step 8: Commit.**

### Task 3: Native authority compilation with explicit ambiguity

**Files:**
- Create: `tools/phase46d-native-compile.ts`
- Create: `data/historical/native/phase46d-native-authority.json`
- Create: `test/phase46d-native-compile.test.ts`
- Preserve: `data/historical/native/kkh-kana-first-slice.json` as regression evidence until Task 5 proves replacement compatibility.

**Interfaces:**
- Consumes admitted/candidate `historical_kana_native` intake records.
- Produces a runtime slice with exact-surface entries, optional accepted lexical-identity/morphology bindings, complete alternatives, provenance refs, and no excluded/disabled records.

- [ ] **Step 1: Write RED compiler tests.**
  Assert disabled/excluded records never compile; source duplicates with one target coalesce provenance; distinct targets for one modern surface compile one candidate set; relation order does not choose a target; existing accepted `思う` lexical identity/morphology binding remains present.
- [ ] **Step 2: Write a negative test proving no substring relation is generated.**
- [ ] **Step 3: Run focused tests and verify RED.**
- [ ] **Step 4: Implement deterministic compiler and generated authority file.**
  Sort by semantic keys, never source order; carry source/intake/evidence IDs through compiled entries.
- [ ] **Step 5: Re-run focused tests and verify GREEN.**
- [ ] **Step 6: Commit.**

### Task 4: Exact native resolution and safe runtime fallback

**Files:**
- Modify: `runtime/historical-native-runtime.js`
- Modify: `test/historical-native-runtime.test.ts`
- Modify: `test/historical-native-source.test.ts`
- Create: `test/phase46d-native-runtime.test.ts`
- Modify: `test/historical-native-integration.test.ts` only where the existing resolver path needs the new exact-surface/candidate shape.

**Interfaces:**
- Add `resolveExact(input)` to the historical-native runtime, returning typed `none | resolved | candidates` semantics with optional surface/reading targets and evidence refs.
- Preserve existing `lookup(candidate)` API for current consumers; extend it to use accepted lexical identity+morphology first, then an exact native-surface entry when safe.

- [ ] **Step 1: Write RED direct-resolution tests over generated authority.**
  Every uniquely admitted KKH exact-surface mapping must return its exact source target; admitted committed reading records must return their exact historical reading without replacing a kanji surface.
- [ ] **Step 2: Write RED ambiguity/order tests.**
  For every ambiguous modern key, both normal and reversed relation order must return the complete same candidate set with no selected target.
- [ ] **Step 3: Write RED false-positive tests.**
  Sino lexical origin, non-equal surface, substring-containing text, missing required morphology and disabled source rows must not auto-resolve.
- [ ] **Step 4: Implement `resolveExact` and compatibility-preserving `lookup`.**
  Priority: accepted lexical identity+morphology -> exact native surface/reading relation -> candidates/none. Do not implement substring replacement or heuristic scoring.
- [ ] **Step 5: Re-run focused runtime/integration tests and verify GREEN.**
- [ ] **Step 6: Commit.**

### Task 5: Exhaustive completeness/regression gate and replacement of first-slice authority

**Files:**
- Create: `test/golden/phase46d-native-coverage.json`
- Create: `test/phase46d-native-exhaustive.test.ts`
- Modify: `tools/validate.ts` and/or repository check wiring only as necessary to make the accepted 4.6D gate part of `npm run check`.
- Modify: resolver-bundle source selection to use `data/historical/native/phase46d-native-authority.json` instead of the bounded first slice after compatibility is proven.
- Modify existing bundle/integrity/real-text tests only for the source identity/artifact change.

**Interfaces:**
- Produces a machine-readable coverage report per selected source: discovered, admitted, ambiguous, excluded, unclassified, unexpected, unparsedMappingRecords.
- Makes full Phase-4.6D coverage and direct-resolution proofs mandatory in `npm run check`.

- [ ] **Step 1: Write RED exhaustive acceptance tests.**
  Assert zero unclassified/unexpected/unparsed coverage records for every source; assert `discovered = admitted + ambiguous + excluded`; loop over every unique admitted mapping and prove exact direct resolution; loop over ambiguous records and prove complete candidate preservation; prove disabled records stay non-executable.
- [ ] **Step 2: Add regression assertions for the accepted first-slice behavior (`思う→思ふ`) and existing resolver-bundle tests.**
- [ ] **Step 3: Run focused/exhaustive tests and verify RED before switching bundle authority.**
- [ ] **Step 4: Switch the native bundle source to the Phase-4.6D generated authority and refresh only mechanically affected golden/source identities.**
- [ ] **Step 5: Run focused native tests, then full `npm run check`; both must PASS on the exact head.**
- [ ] **Step 6: Commit.**

### Task 6: Formal Review and acceptance

**Files:**
- No new behavior unless review finds a defect.
- Update owner/control Issues after acceptance.

**Interfaces:**
- Acceptance evidence is exact-head Verify + Formal Review + post-main Verify.

- [ ] **Step 1: Audit the complete PR against the accepted design.**
  Verify selected-source SHA/commit/license locks, full disposition accounting, disabled-row handling, reading-vs-surface safety, ambiguity/order independence, exact-resolution proof, no fabricated lexical IDs, no substring fallback, and no 4.6E/4.6F/consumer scope leakage.
- [ ] **Step 2: Require exact-head `npm run check` / GitHub Verify PASS with no remaining Critical/Important findings.**
- [ ] **Step 3: Merge by reversible PR, then require post-main Verify PASS.**
- [ ] **Step 4: Record accepted SHA/check/review on #70, roadmap #28 and `devflow#180`.**
- [ ] **Step 5: Global re-evaluation.**
  If all 4.6D acceptance conditions are satisfied, select 4.6E as the next unfinished Phase-4.6 unit; otherwise keep 4.6D open with the concrete unmet condition.

## Self-Review Result

- Spec coverage: 4.6D selected-source completeness, disabled-record accounting, deterministic provenance, ambiguity, lexical/morphology precedence, exact direct resolution and parser-remainder gates each map to a task.
- Scope: 4.6E 字音 and 4.6F profile behavior remain explicit non-goals.
- Type consistency: Task 1 discovery feeds Task 2 intake; Task 2 intake feeds Task 3 compiler; Task 3 authority feeds Task 4 runtime; Task 5 promotes these checks to the repository gate.
- Review focus: all five listed failure modes have owning tests.
- Proportion: the plan fixes interfaces/acceptance decisions without embedding parser/runtime implementation bodies.
