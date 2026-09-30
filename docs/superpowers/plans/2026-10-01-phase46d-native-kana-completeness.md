# Phase 4.6D Native Historical-Kana Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bounded native historical-kana first slice with a source-complete, fail-closed Phase 4.6D pipeline for the selected KKH and committed native-kana sources without introducing substring fallback or collapsing ambiguity.

**Architecture:** Keep raw-source extraction, intake classification, runtime compilation, and resolution as separate stages. Parse every selected source deterministically into countable source records, classify every coverage-contract record through the existing Phase-4.6 intake/accounting model, compile only safe exact lexical-surface / historical-reading authority, and extend the native runtime with exact-surface lookup while preserving lexical-identity+morphology precedence and unresolved ambiguity.

**Tech Stack:** Node.js >=22, TypeScript 7, tsx, node:test, existing AJV intake schema, existing UMD runtimes, GitHub Actions Verify.

**Spec:** `docs/superpowers/specs/2026-09-30-phase46-orthography-completeness-design.md`

## Global Constraints

- Owner remains #70; #72 is recovery/minutes only.
- Accepted baseline is `japanese-orthography/main@8b1a9c207491d19a82a3cf1c09eb32cf6e7a94cb`, post-main Verify `36747447448` PASS.
- Selected KKH source is exactly `okikae/kkh@19b24f88ab55809a186d88c465959548495b26a2:kana-jisyo`, blob `6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be`, BSD-2-Clause.
- Selected committed native sources are exactly:
  - `仮名遣等資料/仮名遣い辞典本文.html` blob `45380ff7690e177afa7c980f3f4ffd873b38d928`;
  - `仮名遣等資料/例外動詞一覧：歴史的仮名遣い教室.html` blob `57a50297fb2454e702d6f7b3450cd3cdd7e9cb9a`;
  - `仮名遣等資料/動物名・植物名歴史的仮名遣い辞典.html` blob `9eb26e76343526fe5cc8b17d1113f80414c4bf21`;
  - native A1–A9/B1–B5/C1–C2 rule/example section of `仮名遣等資料/歴史的仮名遣いで書きたい.html` blob `232cb508e1fdae0c5ec2e17a57409f20cde28756`.
- Every coverage-contract discovered record must end as `admitted`, `candidate_ambiguous`, or `excluded_unresolved`; no ignored bucket.
- Parser remainder that looks transformation-like is an ERROR.
- Source order never chooses a winner.
- Exact lexical identity + morphology remains higher priority than exact lexical-surface authority.
- Exact lexical-surface authority is whole-unit only. No substring replacement fallback is permitted.
- Dictionary historical readings are not automatically treated as replacement surfaces for kanji-bearing entries.
- Disabled KKH mappings remain disabled unless separately admitted with independent evidence.
- No inferred new inflectional form beyond selected source evidence in this phase; a future paradigm generator requires its own admitted paradigm evidence.
- No 4.6E 字音, 4.6F profile migration, consumer change, Phase 5/6, release/deploy/publication, permission/credential mutation, destructive/shared-history operation, or RDC.

## Inventory Baseline

- KKH physical lines: 8,036.
- KKH mapping-shaped records: 7,408 = 7,151 active + 257 disabled.
- Active KKH modern surfaces: 7,052.
- Active single-target surfaces: 6,953.
- Active two-target surfaces: 99; maximum targets per active surface is 2.
- `仮名遣い辞典本文.html`: 1,195 colon-structured dictionary records.
- `動物名・植物名歴史的仮名遣い辞典.html`: 1,369 colon-structured dictionary records.
- `例外動詞一覧：歴史的仮名遣い教室.html`: 111 table-entry blocks.
- Native guide section A1–A9/B1–B5/C1–C2: 255 non-empty paragraph records, including 16 rule-heading paragraphs.
- Current accepted `data/historical/native/kkh-kana-first-slice.json`: 3 source records / 1 executable relation only.

## Review Focus

- KKH duplicate modern surfaces with two source targets must never execute the first target by file order; `味わおう` is the canonical regression.
- Disabled mapping-shaped lines such as the KKH safety exclusions must consume coverage but never become runtime authority merely because they parse.
- A committed dictionary entry with kanji surface and historical kana reading must preserve the kanji surface while exposing historical reading; it must not replace the word with kana.
- Pure-kana / katakana dictionary entries may use the historical reading as exact rendered surface only when the source record is structurally unique and unambiguous.
- Unknown new mapping-like syntax in KKH or the claimed native guide section must fail coverage verification instead of disappearing.

---

### Task 1: Vendor the pinned KKH bytes and implement deterministic source extraction

**Files:**
- Create: `data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/kana-jisyo`
- Create: `data/sources/kkh/19b24f88ab55809a186d88c465959548495b26a2/LICENSE`
- Create: `tools/native-kana-source-parser.ts`
- Create: `test/phase46d-native-source-parser.test.ts`

**Interfaces:**
- Produces `NativeKanaExtractedRecord` with `sourceRef`, `sourceLocator`, `sourceRecordKind`, raw text, optional modern/historical surface or reading fields, optional alternatives/notes, and enabled/disabled status.
- Produces `NativeKanaParseResult = { records, discoveredRecordIds, remainders }`.
- Exports `parseKkhKanaJisyo(text, sourceId)`, `parseColonDictionaryHtml(text, sourceId)`, `parseExceptionVerbHtml(text, sourceId)`, and `parseNativeGuideHtml(text, sourceId)`.

- [ ] **Step 1: Write RED source-extraction tests.** Assert the exact inventory counts above from the real pinned/local source files and assert stable source locators for representative first/middle/last records.
- [ ] **Step 2: Add malformed-format RED cases.** Mutate a KKH mapping line and one native-guide transformation-like structure so each becomes a parser remainder with `kind: "mapping"`.
- [ ] **Step 3: Run RED.** Run `node --import tsx --test test/phase46d-native-source-parser.test.ts`; expected failure is missing parser exports / missing vendored source.
- [ ] **Step 4: Vendor exact upstream KKH bytes and BSD-2-Clause LICENSE.** Preserve byte content; add a test computing the Git blob identity of the vendored `kana-jisyo` and requiring `6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be`.
- [ ] **Step 5: Implement KKH extraction.** Active mapping line -> mapping record; commented mapping line -> disabled record; all 7,408 mapping-shaped lines must be discovered; ordinary comments/headings are not records.
- [ ] **Step 6: Implement committed HTML extraction.** Colon dictionaries produce one discovered record per mechanically identified entry line; exception verbs produce 111 table-entry blocks; the guide parser claims exactly the 255 non-empty paragraphs from A1 through C2 and classifies their structural subtype without inferring a conversion target.
- [ ] **Step 7: Verify GREEN.** Re-run the focused test and then `npm run typecheck`.
- [ ] **Step 8: Commit boundary.** Commit as `feat: parse Phase 4.6D native kana sources`.

### Task 2: Classify every discovered record into the Phase-4.6 intake contract

**Files:**
- Create: `tools/native-kana-intake.ts`
- Create: `tools/generate-native-kana.ts`
- Create: `data/intake/phase46d-native-kana.json`
- Create: `data/reports/phase46d-native-kana-coverage.json`
- Create: `test/phase46d-native-intake.test.ts`
- Create: `tools/validate-native-kana.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes Task-1 parse results plus existing `SourceSnapshot`, `IntakeRecord`, `buildCoverageSummary()`, and `validateCoverageAccounting()`.
- Produces one canonical `orthography_intake_bundle`, deterministic per-source coverage summaries, and a CLI gate used by `npm run check`.

- [ ] **Step 1: Write RED classification tests for KKH.** Require 257 disabled source records to become `excluded_unresolved/source_disabled`; require every active single-target KKH source record to be `admitted`; require both records for each of the 99 two-target surfaces to be `candidate_ambiguous` with the complete two-target set and no source-order winner.
- [ ] **Step 2: Write RED classification tests for committed dictionaries.** Simple one-left/one-reading records become admitted historical-reading evidence. One-left/multiple-reading records remain candidates. Equal-cardinality paired lists may be split positionally only when the parser can prove the pairing; otherwise classify `excluded_unresolved/source_structure_requires_manual_disambiguation`.
- [ ] **Step 3: Write RED classification tests for exception/rule material.** Records without an explicit modern->historical pair remain countable `identity` or `explanatory` records and are excluded with `requires_modern_surface_derivation` or `non_transformational_explanation`; they must not disappear.
- [ ] **Step 4: Run RED.** Run `node --import tsx --test test/phase46d-native-intake.test.ts`; expected failure is missing classifier/generator.
- [ ] **Step 5: Implement source snapshots.** Use one external-repository coverage-contract snapshot for pinned KKH and four committed-reference coverage-contract snapshots for the exact accepted HTML blobs.
- [ ] **Step 6: Implement deterministic classification and generation.** Preserve cross-source provenance; do not collapse conflicts by import order; make exclusion reasons machine-readable.
- [ ] **Step 7: Add native coverage validation CLI.** Parse the real source snapshots, load the generated intake, call `validateCoverageAccounting()` for every selected source, fail on any unclassified/unexpected record or mapping remainder, and emit deterministic summaries.
- [ ] **Step 8: Wire `npm run check`.** Add `validate:native-kana` and run it after generic `validate:intake`.
- [ ] **Step 9: Verify GREEN.** Run focused tests, `npm run validate:native-kana`, and `npm run check`.
- [ ] **Step 10: Commit boundary.** Commit as `feat: classify source-complete native kana intake`.

### Task 3: Compile safe runtime authority without conflating surface and reading evidence

**Files:**
- Create: `tools/native-kana-compiler.ts`
- Create: `data/historical/native/phase46d-native-kana.json`
- Create: `test/phase46d-native-compiler.test.ts`
- Keep: `data/historical/native/kkh-kana-first-slice.json` as the bounded historical regression fixture.

**Interfaces:**
- Consumes the canonical Phase-4.6D intake bundle.
- Produces a versioned native runtime artifact with:
  - existing lexical-identity+morphology relations;
  - exact whole-surface relations from unambiguous admitted surface mappings;
  - exact lexical-surface historical-reading relations from unambiguous dictionary evidence;
  - explicit ambiguous surface/reading candidate indexes;
  - source/evidence provenance for every emitted relation.
- Exports `compileNativeKanaArtifact(intake, options)`.

- [ ] **Step 1: Write RED compiler tests.** Require deterministic output, stable ordering independent of intake input order, merged evidence refs for cross-source duplicate claims, and no executable relation for a conflicting multi-target surface.
- [ ] **Step 2: Pin surface-vs-reading semantics.** KKH `植え -> 植ゑ` compiles as rendered-surface authority. Unique dictionary `挨拶：あいさつ` compiles as historical-reading authority while preserving surface `挨拶`; cross-source `藍：あゐ` / `藍：アヰ` remains a reading candidate set with no source-order winner. Unique animal/plant katakana `アイゴ：アヰゴ` compiles both surface and reading.
- [ ] **Step 3: Preserve the accepted `思う` identity+morphology anchor.** Carry the current first-slice relation into the new artifact so identity+morphology precedence has a real regression case.
- [ ] **Step 4: Run RED.** Run `node --import tsx --test test/phase46d-native-compiler.test.ts`.
- [ ] **Step 5: Implement the compiler.** Group by semantic key, canonicalize target/evidence sets, and refuse to emit an exact relation when more than one target survives.
- [ ] **Step 6: Generate the canonical artifact.** Generated data must be reproducible byte-for-byte from source snapshots + intake.
- [ ] **Step 7: Verify GREEN.** Run compiler tests twice and compare generated artifact text/content identity.
- [ ] **Step 8: Commit boundary.** Commit as `feat: compile Phase 4.6D native kana authority`.

### Task 4: Add exact-surface native resolution after identity+morphology

**Files:**
- Modify: `runtime/historical-native-runtime.js`
- Modify: `runtime/orthography-resolver.js`
- Modify: `test/historical-native-runtime.test.ts`
- Create: `test/phase46d-native-resolution.test.ts`

**Interfaces:**
- `createHistoricalNativeRuntime(artifact, options)` remains backward compatible with the current v1 first slice.
- New runtime method: `lookupSurface(surface)` returns either a unique resolved native relation, an explicit candidate result, or `null`.
- `OrthographyResolver.createResolver()` accepts optional `historicalSurfaceLookup(surface)`.

- [ ] **Step 1: Write RED priority tests.** A matching lexical-identity+morphology relation wins before surface fallback; morphology mismatch does not authorize an identity relation.
- [ ] **Step 2: Write RED exact-surface tests.** A source-complete unique KKH surface resolves exactly; an unknown lexical surface can still use a unique exact whole-surface relation; no substring search is performed.
- [ ] **Step 3: Write RED ambiguity tests.** `味わおう` exposes an unresolved/candidate historical decision with both source targets and never selects the first source row.
- [ ] **Step 4: Write RED historical-reading tests.** `挨拶` keeps rendered surface `挨拶` and exposes `あいさつ` as historical kana; `藍` remains an unresolved reading candidate (`あゐ` / `アヰ`); a unique pure-kana/katakana admitted entry such as `アイゴ` may change rendered surface exactly.
- [ ] **Step 5: Implement backward-compatible native runtime indexes.** Identity/morphology index first, exact-surface index second, candidate index separate; validate evidence refs and source metadata fail closed.
- [ ] **Step 6: Extend resolver exact-surface path.** Apply only to the full normalized unit; preserve protected input behavior, lexical candidate evidence, contextual/safe-kanji order, and current result fields. Add optional historical candidate metadata without removing existing fields.
- [ ] **Step 7: Verify GREEN.** Run native runtime, native integration, and Phase-4.6D resolution tests.
- [ ] **Step 8: Commit boundary.** Commit as `feat: resolve exact native historical kana surfaces`.

### Task 5: Switch the accepted resolver bundle to the Phase-4.6D artifact

**Files:**
- Modify: `tools/resolver-bundle.ts` only if type/validation support is required.
- Modify: `runtime/resolver-bundle-runtime.js`
- Modify: `test/resolver-bundle.test.ts`
- Modify: `test/resolver-bundle-integrity.test.ts`
- Modify: other bundle/evaluation fixtures only where deterministic content identity changes.
- Modify: `README.md` and/or `docs/phase3-resolver-bundle.md` only to replace stale first-slice current-state language.

**Interfaces:**
- Resolver bundle keeps the existing `historical-native` capability and public entry points.
- Bundle runtime wires both `historicalNative.lookup(candidate)` and `historicalNative.lookupSurface(surface)`; Sino behavior remains unchanged.

- [ ] **Step 1: Write RED bundle acceptance tests.** Accepted bundle must use `data/historical/native/phase46d-native-kana.json`, keep current Sino/contextual/safe-character behavior, and resolve representative KKH/dictionary/animal cases through the single bundle entry point.
- [ ] **Step 2: Preserve regression boundaries.** Existing `学校`, `台風`, ruby disambiguation, protected input, unknown input, and browser/Worker runtime tests remain green.
- [ ] **Step 3: Implement bundle wiring and refresh deterministic identities.** Do not change consumer repository or Phase-5 integration.
- [ ] **Step 4: Verify GREEN.** Run focused bundle tests and full `npm run check`.
- [ ] **Step 5: Commit boundary.** Commit as `feat: activate Phase 4.6D native kana bundle`.

### Task 6: Formal Review, exact-head verification, and accepted-state reconciliation

**Files / durable surfaces:**
- PR for the 4.6D implementation branch.
- #70 Execution Session / durable checkpoint.
- #28 roadmap.
- `devflow#180`.
- Documentation/current-state files only if the accepted repository state actually changes.

**Interfaces:**
- Produces review evidence, exact-head Verify, post-main Verify, and the first unfinished Phase-4.6 checkpoint.

- [ ] **Step 1: Run full verification on the final implementation head.** `npm run check` must pass with zero coverage remainder/unclassified records.
- [ ] **Step 2: Review source completeness.** Confirm all five selected snapshots have deterministic discovered counts, partition equality, zero unparsed mapping records, and visible exclusion/ambiguity counts.
- [ ] **Step 3: Review runtime safety.** Confirm no substring fallback, no source-order winner, disabled records are non-authoritative, and reading evidence does not replace kanji surfaces.
- [ ] **Step 4: Run Formal Review over the complete diff.** No Critical/Important finding may remain open.
- [ ] **Step 5: Merge only the exact reviewed head when safely revertible.**
- [ ] **Step 6: Require post-main Verify PASS.**
- [ ] **Step 7: Reconcile #70, #28, and `devflow#180`.** Mark 4.6D accepted only after post-main evidence; then re-evaluate whether 4.6E is the first unfinished selected acceptance condition.
