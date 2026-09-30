# Phase 4.6A Intake Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the Phase-4.6 cross-domain intake/source-snapshot/completeness foundation and classify the known unsafe legacy Stage-40 relations without changing production restoration behavior.

**Architecture:** Add a versioned orthography-intake document schema beside the existing v1 schemas, with typed source snapshots, intake records, and explicit coverage accounting. Load `data/intake/*.json` independently from the existing resolver workspace, validate it fail-closed from the existing `validateRoot`/`npm run check` path, and keep 4.6A classification evidence non-authoritative for runtime output. Later 4.6B–E reuse this exact intake/coverage contract rather than inventing per-source accounting.

**Tech Stack:** Node.js >=22, TypeScript 7, node:test, AJV 2020, existing `npm run check` GitHub Actions Verify workflow.

**Spec:** `docs/superpowers/specs/2026-09-30-phase46-orthography-completeness-design.md`

## Global Constraints

- Every intake record has exactly one Phase-4.6 responsibility and one disposition.
- `coverage-contract` sources have no silent drop: discovered = admitted + candidate_ambiguous + excluded_unresolved, with zero unparsed mapping records and zero unclassified records at accepted head.
- `excluded_unresolved` always carries a machine-readable exclusion reason.
- External/committed coverage snapshots are pinned; moving branches are never runtime authority.
- Known merged/contextual legacy relations are not promoted to unconditional `character_form` authority.
- 4.6A does not ingest the full native-kana or 字音 snapshots and does not change resolver output.
- Generic authority and KiNoTch profile policy remain distinct.
- No Phase 5/6, release/deploy/publication, credentials/permissions, shared-history rewrite, unpublished lyric fixtures, or RDC.

## Review Focus

- Coverage counts that numerically balance only because records from the wrong `sourceRef` were counted: source-local counts must be checked.
- Duplicate source IDs / duplicate intake record IDs: fail closed rather than last-write-wins.
- Coverage source with missing pin fields (`commit`/`blobSha`): reject before later parsers can depend on a moving source.
- `excluded_unresolved` without an exclusion reason: reject rather than creating an invisible discard bucket.
- Legacy `弁`, `穗 -> 瓣`, `舖 -> 辯` accidentally appearing as admitted `character_form`: regression tests must prohibit it.

---

### Task 1: Versioned intake schema and semantic accounting

**Files:**
- Create: `schema/v1/orthography-intake.schema.json`
- Create: `tools/orthography-intake.ts`
- Modify: `tools/schema-validator.ts`
- Test: `test/orthography-intake.test.ts`

**Interfaces:**
- Produces `OrthographyResponsibility`, `IntakeDisposition`, `SourceSnapshot`, `IntakeRecord`, `SourceCoverageAccounting`, `OrthographyIntakeDocument`.
- Produces `validateOrthographyIntakeDocument(document: OrthographyIntakeDocument, path?: string): Diagnostic[]`.
- Produces schema ID `orthography-intake-v1` through `createSchemaValidator()`.

- [ ] **Step 1: Write failing schema/semantic tests**

Add tests proving that a valid pinned coverage source is accepted, while duplicate IDs, missing source references, missing coverage pin fields, nonzero parser remainder, source-local count mismatch, and `excluded_unresolved` without `exclusionReason` are rejected.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test test/orthography-intake.test.ts`

Expected: FAIL because the schema/module does not exist.

- [ ] **Step 3: Add the minimal schema/types/validator**

`OrthographyIntakeDocument` has `schemaVersion: '1'`, `batchId`, `sources`, `records`, and `coverage`.

`SourceSnapshot` fields: `sourceId`, `sourceClass`, optional `repository`, optional `commit`, `path`, optional `blobSha`, optional `license`, `coverageRole`.

`IntakeRecord` fields and enum values exactly follow the Phase-4.6 design. `SourceCoverageAccounting` contains `sourceRef`, `discoveredRecordCount`, `unparsedMappingRecords`, and `unclassifiedRecords`.

`validateOrthographyIntakeDocument` enforces source/record uniqueness, source references, one accounting row for each coverage source, zero accepted parser remainder, and source-local disposition-count equality.

- [ ] **Step 4: Run focused test and full suite**

Run: `node --import tsx --test test/orthography-intake.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add orthography intake completeness contract`

### Task 2: Deterministic intake loader and production check integration

**Files:**
- Create: `tools/load-orthography-intake.ts`
- Modify: `tools/validate.ts`
- Test: `test/orthography-intake.test.ts`

**Interfaces:**
- Consumes: `OrthographyIntakeDocument`, `validateOrthographyIntakeDocument` from Task 1.
- Produces `loadOrthographyIntakeDocuments(rootDir: string): Promise<Array<{ file: string; document: OrthographyIntakeDocument }>>`.
- Extends `validateRoot` diagnostics with every discovered intake document; an absent `data/intake` directory is valid and returns no intake diagnostics.

- [ ] **Step 1: Add failing loader/integration tests**

Tests cover deterministic lexical filename order, invalid JSON/schema failure, missing intake directory, and a malformed coverage document producing diagnostics through `validateRoot`.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --import tsx --test test/orthography-intake.test.ts`
Expected: FAIL because loader/check integration is missing.

- [ ] **Step 3: Implement deterministic loader and validateRoot integration**

Only `*.json` files directly under `data/intake/` are canonical 4.6 intake documents in this unit. Schema errors are converted to diagnostics tied to the intake file; malformed JSON fails closed.

- [ ] **Step 4: Verify GREEN**

Run: `node --import tsx --test test/orthography-intake.test.ts`
Expected: PASS.

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: validate orthography intake in production checks`

### Task 3: Known unsafe legacy classification and family inventory

**Files:**
- Create: `data/intake/phase46a-known-unsafe.json`
- Create: `docs/phase46a-responsibility-inventory.md`
- Modify: `test/orthography-intake.test.ts`

**Interfaces:**
- Consumes the Task-1 intake schema and Task-2 loader.
- Produces durable non-runtime classification records for the current KiNoTch legacy Stage-40 snapshot.

- [ ] **Step 1: Add failing safety tests**

Assert that the accepted 4.6A classification contains:
- `弁 -> 辨` as `merged_character` + `candidate_ambiguous`, with alternatives including `辨`, `瓣`, `辯`, `辦`;
- `穗 -> 瓣` as `preserve_unresolved` + `excluded_unresolved`;
- `舖 -> 辯` as `preserve_unresolved` + `excluded_unresolved`;
- none of those three as admitted `character_form`.

Also assert that the intake source snapshot pins `kinoko34077/japanese-orthography`, accepted design main `67c86f18385da5cff45bce91b5c9688523500e1d`, and blob `23239f87420d8b938250b932319a6f8422fdd45f` for `data/profiles/kinotch/legacy-kanji.json`.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --import tsx --test test/orthography-intake.test.ts`
Expected: FAIL because the classification document does not exist.

- [ ] **Step 3: Add the classification document and responsibility inventory**

The inventory maps current accepted families to the eight Phase-4.6 responsibilities and explicitly states that it is routing/classification metadata, not new runtime authority. Keep existing Stage-40 output unchanged in 4.6A.

- [ ] **Step 4: Verify GREEN**

Run: `node --import tsx --test test/orthography-intake.test.ts`
Expected: PASS.

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `data: classify unsafe legacy orthography relations`

### Task 4: Whole-unit verification and acceptance evidence

**Files:**
- No production files unless review finds a defect.
- Update durable progress on `japanese-orthography#70` and the PR.

**Interfaces:**
- Consumes Tasks 1–3.
- Produces the accepted 4.6A verification/review evidence used to decide whether 4.6B may start.

- [ ] **Step 1: Run exact-head verification**

Run: `npm run check`
Expected: PASS with zero intake ERROR/REVIEW diagnostics.

- [ ] **Step 2: Review branch diff against the design**

Confirm: no resolver behavior changed; coverage contract is reusable for 4.6D/E; unsafe legacy entries cannot become unconditional character-form authority through this data.

- [ ] **Step 3: Merge only if the PR head is unchanged and Verify is green**

Use the existing reversible PR merge path. No release/deploy/publication occurs.

- [ ] **Step 4: Reconcile durable state**

Update #70 and `devflow#180` with accepted main SHA, 4.6A completion evidence, and the next selected frontier. Re-evaluate 4.6B before starting it rather than automatically widening scope.
