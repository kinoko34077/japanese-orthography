# Phase 4.6A Intake and Admission Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the common Phase-4.6 responsibility, provenance, disposition, and source-completeness accounting contract, and classify the already-known unsafe legacy mappings without ingesting the full historical-kana or 字音 source sets yet.

**Architecture:** Add a Phase-4.6 intake model beside the existing canonical corpus model rather than overloading `tools/model.ts` before the later source parsers exist. JSON intake documents are validated through the repository's existing AJV path, loaded deterministically from `data/intake/`, and checked by a small accounting layer that makes silent source-record loss impossible for future coverage-contract parsers. A first foundation document records the known unsafe Stage-40/profile cases as migration/audit truth only; it does not change resolver behavior or grant new generic authority.

**Tech Stack:** Node.js >=22, TypeScript 7, AJV 8, `node:test`, JSON Schema 2020-12, existing `npm run check` GitHub Actions Verify workflow.

**Spec:** `docs/superpowers/specs/2026-09-30-phase46-orthography-completeness-design.md`

## Global Constraints

- Keep `character_form`, `lexical_historical_kanji`, `merged_character`, `historical_kana_native`, `historical_kana_sino`, `kinotch_semantic`, `kinotch_style`, and `preserve_unresolved` as distinct primary responsibilities.
- Keep `admitted`, `candidate_ambiguous`, and `excluded_unresolved` as distinct dispositions.
- A coverage-contract source must satisfy `discovered = admitted + candidate_ambiguous + excluded_unresolved`; there is no silent ignored bucket.
- Unknown transformation-like parser remainder must be observable and must make validation fail once a parser claims coverage.
- `excluded_unresolved` records require a machine-readable exclusion reason.
- Source snapshot identity must remain explicit; no moving external branch may become generated authority.
- `弁` must not become an unconditional generic one-target character mapping; `台` remains contextual/guarded; `穗 -> 瓣` and `舖 -> 辯` must not pass as same-character old/new relations.
- Existing generic authority and KiNoTch profile authority remain separate. Compatibility fixtures are audit/history evidence, not proof of generic safety.
- 4.6A does not ingest the full KKH/native HTML/字音 snapshots, alter resolver runtime behavior, change `txt-auto-replace`, or start Phase 5/6.
- No unpublished/full lyric fixtures, RDC, release/deploy/publication, credential/permission mutation, destructive operation, or shared-history rewrite.
- Every implementation task uses RED -> observed expected failure -> minimal GREEN -> full relevant verification; final exact-head gate is `npm run check` plus GitHub Actions Verify.

## Review Focus

- A record whose `sourceRef` does not resolve to a declared snapshot must fail intake validation instead of becoming provenance-free data.
- `excluded_unresolved` without `exclusionReason` must fail schema/semantic validation.
- A coverage batch with one discovered source record omitted from dispositions must produce an error even if every emitted `IntakeRecord` is individually valid.
- A disabled or explanatory source record must still be countable/classifiable and cannot disappear through a generic ignored bucket.
- Candidate ordering must not encode a winner: alternative arrays are canonicalized/deduplicated for comparison, while disposition remains `candidate_ambiguous`.

---

### Task 1: Define the Phase-4.6 intake schema and TypeScript contract

**Files:**
- Create: `tools/intake-model.ts`
- Create: `schema/v1/orthography-intake-bundle.schema.json`
- Modify: `tools/schema-validator.ts`
- Create: `test/phase46-intake-schema.test.ts`

**Interfaces:**
- Consumes: existing `Diagnostic` type and `createSchemaValidator()` AJV infrastructure.
- Produces: `Responsibility`, `Disposition`, `SourceRecordKind`, `CoverageRole`, `SourceSnapshot`, `IntakeRecord`, and `IntakeBundleDocument`; schema ID `orthography-intake-bundle-v1`.

- [ ] **Step 1: Write the failing schema tests.** Add `test/phase46-intake-schema.test.ts` with one minimal valid bundle containing one `committed-reference` snapshot and one `merged_character` record, then invalid cases for an unknown responsibility, an unresolved record without `exclusionReason`, an empty `evidenceRefs`, and an invalid coverage role.
- [ ] **Step 2: Run RED.** Open the implementation PR before this commit so GitHub Actions runs on PR updates. Commit only the test and let Verify run. Expected failure: TypeScript/module or `E_UNKNOWN_SCHEMA` failure because the Phase-4.6 model/schema is not yet present.
- [ ] **Step 3: Add `tools/intake-model.ts`.** Define exactly the responsibility/disposition/record-kind/source-snapshot fields required by the approved design. Keep the new model separate from existing `SourceDescriptor`/`CanonicalWorkspace`; no migration is performed in this task.
- [ ] **Step 4: Add the JSON Schema.** `orthography-intake-bundle-v1` contains `schemaVersion: "1"`, `kind: "orthography_intake_bundle"`, `snapshots`, and `records`; rejects unknown top-level/record fields; requires non-empty IDs/source locators/evidence refs; conditionally requires `exclusionReason` when disposition is `excluded_unresolved`.
- [ ] **Step 5: Register the schema.** Add the schema file to `tools/schema-validator.ts` without changing existing schema IDs.
- [ ] **Step 6: Verify GREEN.** Push implementation commit and require GitHub Actions Verify PASS; the focused schema test must be green within the full `npm run check` run.
- [ ] **Step 7: Commit boundary.** Commit as `feat: define Phase 4.6 intake contract`.

### Task 2: Add deterministic intake loading and provenance validation

**Files:**
- Create: `tools/load-intake.ts`
- Create: `test/phase46-intake-loader.test.ts`

**Interfaces:**
- Consumes: `IntakeBundleDocument`, `SourceSnapshot`, `IntakeRecord`, and `createSchemaValidator()`.
- Produces: `loadIntakeWorkspace(rootDir)` returning `{ snapshots, records }` in stable path/order, plus `IntakeLoadError` with stable error codes.

- [ ] **Step 1: Write RED loader tests.** Use temporary fixture roots to prove deterministic recursive `.json` loading under `data/intake`, schema rejection, duplicate `sourceId`, duplicate record `id`, and a record whose `sourceRef` is undeclared.
- [ ] **Step 2: Run RED.** Commit the tests only. Expected Verify failure: missing `tools/load-intake.ts` / missing exported loader behavior.
- [ ] **Step 3: Implement strict loading.** Reuse the existing UTF-8/strict-JSON/schema-validation pattern from `tools/load-workspace.ts`; sort paths deterministically; retain file + JSON-pointer locations for diagnostics; do not read unrelated `data/` trees.
- [ ] **Step 4: Enforce provenance links.** Reject duplicate snapshot IDs, duplicate intake IDs, and unknown `sourceRef` values with stable codes such as `E_DUPLICATE_INTAKE_SOURCE`, `E_DUPLICATE_INTAKE_RECORD`, and `E_UNKNOWN_INTAKE_SOURCE`.
- [ ] **Step 5: Verify GREEN.** Push implementation and require GitHub Actions Verify PASS.
- [ ] **Step 6: Commit boundary.** Commit as `feat: load source-locked orthography intake`.

### Task 3: Make source-completeness accounting fail closed

**Files:**
- Create: `tools/intake-accounting.ts`
- Create: `test/phase46-coverage-accounting.test.ts`

**Interfaces:**
- Consumes: a `SourceSnapshot`, the discovered source-record IDs claimed by a future parser, emitted `IntakeRecord[]`, and parser remainder diagnostics.
- Produces: `buildCoverageSummary(input)` and `validateCoverageAccounting(input): Diagnostic[]`, with counts for discovered/admitted/ambiguous/excluded/unparsed/unclassified and stable source-record ID sets.

- [ ] **Step 1: Write RED accounting tests.** Cover an exact 3-record partition (`admitted`, `candidate_ambiguous`, `excluded_unresolved`), one discovered-but-unclassified record, one classified record not present in discovered IDs, one unparsed mapping-shaped remainder, and a non-coverage source where completeness errors are not promoted to the coverage-contract gate.
- [ ] **Step 2: Add disabled/explanatory coverage cases.** Prove that `sourceRecordKind: "disabled"` / `"explanatory"` still consume a discovered record identity and can be explicitly `excluded_unresolved`; they must not be filtered before accounting.
- [ ] **Step 3: Run RED.** Commit tests only; expected Verify failure is missing accounting exports.
- [ ] **Step 4: Implement summary/accounting.** Canonicalize record IDs as sets for comparison; count disposition from emitted records; report missing/unexpected IDs deterministically; return ERROR diagnostics for missing classifications or unparsed transformation-like remainder on `coverage-contract` sources.
- [ ] **Step 5: Preserve ambiguity without order authority.** Add a helper used only for comparison/reporting that deduplicates and sorts `alternatives`; it must not change source provenance or turn a candidate into an admitted mapping.
- [ ] **Step 6: Verify GREEN.** Push and require GitHub Actions Verify PASS.
- [ ] **Step 7: Commit boundary.** Commit as `feat: enforce source completeness accounting`.

### Task 4: Record the current responsibility inventory and known unsafe legacy relations

**Files:**
- Create: `data/intake/phase46-legacy-safety.json`
- Create: `docs/phase46-responsibility-inventory.md`
- Create: `test/phase46-legacy-safety.test.ts`

**Interfaces:**
- Consumes: current accepted main `67c86f18385da5cff45bce91b5c9688523500e1d`, pinned Stage-40 fixture `test/fixtures/pinned/txt-auto-replace/40-legacy-kanji.json5`, `data/profiles/kinotch/legacy-stage60-classification.json`, contextual packs, native/sino first slices, and KiNoTch profile/token-style data.
- Produces: auditable intake records for known unsafe relations and a path-level responsibility/authority inventory; no runtime behavior changes.

- [ ] **Step 1: Write RED safety tests.** Load `phase46-legacy-safety.json` and assert: `弁 -> 辨` is never `character_form/admitted`; `台` is not generic deterministic; `穗 -> 瓣` and `舖 -> 辯` are `preserve_unresolved + excluded_unresolved` (or equivalently non-admitted with an explicit machine reason); all records resolve to declared pinned snapshots.
- [ ] **Step 2: Run RED.** Commit tests only; expected Verify failure is missing foundation intake data.
- [ ] **Step 3: Add the foundation intake document.** Pin the relevant committed source paths with repository, accepted-main commit, blob SHA, and `candidate-only` coverage role. Record `弁`, `台`, `穗 -> 瓣`, and `舖 -> 辯` without granting generic authority. For `弁`, preserve ambiguity rather than selecting the legacy Stage-40 target; for corruption/same-character failures use explicit exclusion reasons.
- [ ] **Step 4: Add `docs/phase46-responsibility-inventory.md`.** Inventory the current rule/data families by *responsibility* separately from *current authority/location*: deterministic safe-character data -> `character_form`; contextual/homophone/merged packs -> `lexical_historical_kanji` or `merged_character`; native first slice -> `historical_kana_native`; sino first slice -> `historical_kana_sino`; KiNoTch semantic/profile datasets -> `kinotch_semantic` where project-only; token style overlay -> `kinotch_style`; preserve/safety exclusions -> `preserve_unresolved`. Mark mixed legacy bundles as migration evidence rather than assigning the whole file one linguistic responsibility.
- [ ] **Step 5: Verify GREEN.** Require GitHub Actions Verify PASS and confirm existing legacy classification tests remain green.
- [ ] **Step 6: Commit boundary.** Commit as `data: classify Phase 4.6 legacy safety boundaries`.

### Task 5: Put intake validation on the repository verification path

**Files:**
- Create: `tools/validate-intake.ts`
- Modify: `package.json`
- Create: `test/phase46-intake-cli.test.ts`

**Interfaces:**
- Consumes: `loadIntakeWorkspace`, schema validation, and coverage accounting primitives.
- Produces: `npm run validate:intake`, a nonzero exit on malformed/unprovenanced intake foundation data, and inclusion in `npm run check`.

- [ ] **Step 1: Write RED CLI tests.** Spawn the proposed validator against the repository root and a temporary invalid root. Assert exit 0 for valid data and nonzero with a stable diagnostic for an invalid `sourceRef`/schema record.
- [ ] **Step 2: Run RED.** Commit tests/package script declaration only if needed to invoke the missing validator; expected Verify failure is missing `tools/validate-intake.ts` or nonzero valid-root result.
- [ ] **Step 3: Implement `validate-intake.ts`.** Load `data/intake`, print stable diagnostics, and fail on loader/schema/provenance errors. Do not manufacture coverage-parser results for sources that 4.6A has not ingested; coverage accounting remains an API/tests contract until 4.6D/E parsers supply discovered/remainder inputs.
- [ ] **Step 4: Integrate `npm run check`.** Add `validate:intake` to the existing check chain without weakening/removing any current validator, test, typecheck, check, or profile check.
- [ ] **Step 5: Verify exact head.** Require GitHub Actions Verify PASS on the implementation PR. Inspect changed files and confirm no runtime resolver/consumer file changed.
- [ ] **Step 6: Formal review.** Review the whole PR against the approved spec, especially responsibility/authority separation and fail-closed completeness accounting. Critical/Important findings receive one TDD fix pass before merge.
- [ ] **Step 7: Reconcile durable state.** Record exact head, Verify run, findings/review, accepted scope, and first unfinished 4.6B action on #70; update #28 and `devflow#180` only for the accepted state transition.
- [ ] **Step 8: Merge boundary.** Merge only after exact-head Verify and review are clean; the merge remains reversible by a dedicated revert PR. Then re-read live state and create the bounded 4.6B plan rather than extending 4.6A opportunistically.

## Self-Review Result

- **Spec coverage:** 4.6A's four promised outputs are each owned: cross-domain model/schema (Task 1), provenance/loading (Task 2), no-silent-drop accounting (Task 3), unsafe legacy classification/responsibility inventory (Task 4), and repository verification integration (Task 5). Full KKH/native/字音 parsing is intentionally deferred to 4.6D/E per the approved phase decomposition.
- **Step scan:** Each behavior-changing task has a test-only RED checkpoint before implementation and an observable GitHub Actions failure/success gate; no production resolver code is introduced.
- **Type consistency:** `SourceSnapshot.sourceId` is the key referenced by `IntakeRecord.sourceRef`; `IntakeBundleDocument` is the loader input; coverage accounting consumes these same model types without redefining responsibility/disposition strings.
- **Review Focus:** provenance orphaning, missing exclusion reason, silent discovered-record drop, disabled/explanatory record loss, and candidate-order authority are all pinned by Tasks 1-3.
- **Proportion:** The plan decides interfaces and testable boundaries needed for 4.6A, while parser-specific full-source algorithms and runtime integration remain in their later bounded units.