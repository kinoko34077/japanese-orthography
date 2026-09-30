# Phase 4.6B Deterministic Kyujitai Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand generic deterministic shinjitai→kyujitai authority only for source-backed, normalization-stable same-character form relations, while making every executable mapping traceable through the Phase-4.6 intake model.

**Architecture:** Keep the existing `safe-character` runtime path as the only unconditional character-rendering layer. Phase 4.6B first records the bounded admitted relations in `orthography_intake_bundle`, then expands the existing safe-character slice with cross-file intake references and source-locked evidence; runtime validation is hardened only enough to reject wrong responsibility/admission and normalization-unstable mappings.

**Tech Stack:** Node.js, TypeScript tests via `node:test`/`tsx`, browser/Worker-neutral UMD runtime JavaScript, JSON source/intake artifacts, GitHub Actions Verify.

**Spec:** `docs/superpowers/specs/2026-09-30-phase46-orthography-completeness-design.md` §§11, 16.3, 16.5, 17 (4.6B), 18–19.

## Global Constraints

- Accepted base: `japanese-orthography@8c9b35eb7c1f8d7ada8fe57567d33cb84b91f1f5` / post-main Verify `36728827068` PASS.
- Existing accepted relation `学 -> 學` remains; the only new admissions are `円 -> 圓`, `応 -> 應`, `宝 -> 寶`, `竜 -> 龍`.
- Pinned corroborating source: `okikae/kkh@19b24f88ab55809a186d88c465959548495b26a2:kanji-jisyo`, blob `95c5db9b5bacb82ab2a685f24f74fef3b32f9992`, BSD-2-Clause.
- KKH is evidence, not blanket authority. Do not admit `宝 -> 寳` or any other KKH row in this unit.
- `弁` and `台` remain explicit negative controls; `穗 -> 瓣` and `舖 -> 辯` remain non-character-form/excluded relations.
- Compatibility/profile data is regression evidence only and cannot confer generic safety.
- No blind reverse import from Stage-40/60, the Cultural Affairs Agency homophone table, or KKH.
- No consumer (`txt-auto-replace`) change, Phase 5/6, release/deploy/publication, credentials/permissions, destructive/shared-history operation, unpublished lyric fixtures, or RDC.

## Review Focus

- A safe mapping exists without a matching `character_form / admitted` intake record: fail cross-file traceability test.
- A mapping uses a merged/contextual modern character (`弁`, `台`): runtime/data tests must reject or keep it excluded.
- A modern or historical code point changes under NFC or NFKC: runtime must fail closed before creating the deterministic map.
- A mapping cites moving/unpinned KKH coordinates: intake/source test must require exact repository+commit+blob SHA.
- A secondary/compatibility source introduces an extra pair such as `宝 -> 寳`: exact bounded-set assertions must fail.

---

## Bounded admission set

The canonical deterministic map after this unit is exactly:

```text
円 -> 圓
応 -> 應
学 -> 學
宝 -> 寶
竜 -> 龍
```

The order above is the canonical data/test order. The Cultural Affairs Agency character-form source remains the primary same-character-form authority; pinned KKH corroborates the four new relations. Existing `学 -> 學` keeps its accepted project-layer and regression evidence semantics.

### Task 1: Phase-4.6 intake authority for deterministic character forms

**Files:**
- Create: `test/phase46b-character-form.test.ts`
- Create: `data/intake/phase46b-character-form.json`

**Interfaces:**
- Consumes: `orthography_intake_bundle` schema/model introduced by 4.6A; `loadIntakeWorkspace()`/`validate:intake` behavior remains unchanged.
- Produces: five stable intake record IDs, one per canonical safe mapping, each `responsibility: "character_form"`, `disposition: "admitted"`, with the exact official source and pinned KKH snapshot represented.

- [ ] **Step 1: write the failing intake tests.** Require `data/intake/phase46b-character-form.json` to load and assert: exact five modern/historical pairs; every record is `mapping / character_form / admitted`; official source is supplemental; KKH snapshot is `external-repository` with exact repository/commit/path/blob/license and `candidate-only`; the four new records carry relation-specific pinned-KKH evidence; no `弁`, `台`, `穗 -> 瓣`, `舖 -> 辯`, or `寳` admission appears.
- [ ] **Step 2: run the focused test and observe RED.** Run `node --import tsx --test test/phase46b-character-form.test.ts`. Expected: FAIL because the new intake bundle is absent.
- [ ] **Step 3: create the minimum intake bundle.** Use source IDs `phase46b-bunkacho-joyo-character-form` and `phase46b-kkh-kanji-jisyo`; use stable record IDs `phase46b-character-en`, `phase46b-character-ou`, `phase46b-character-gaku`, `phase46b-character-takara`, `phase46b-character-ryu`.
- [ ] **Step 4: run focused intake test plus intake validation.** Run `node --import tsx --test test/phase46b-character-form.test.ts` and `npm run validate:intake`. Expected: PASS.
- [ ] **Step 5: commit.** Commit only the new intake artifact and its test as the independently reviewable authority boundary.

### Task 2: RED for safe-character execution and normalization safety

**Files:**
- Modify: `test/safe-character-source.test.ts`
- Modify: `test/safe-character-runtime.test.ts`
- Modify: `test/safe-character-integration.test.ts`

**Interfaces:**
- Consumes: Task-1 intake record IDs.
- Produces: executable contract tests that the safe-character slice is exactly the five admitted intake-backed mappings and that invalid responsibility/admission/normalization fails closed.

- [ ] **Step 1: update source tests before production data.** Replace the old “only 学” expectation with exact canonical order `円/応/学/宝/竜`; require `responsibility: "character_form"`, `admission: "unconditional"`, and `intakeRecordRef` closure to Task-1 records. Require exact KKH commit/blob metadata and dual positive evidence for each new mapping; preserve `弁`/`台` exclusions.
- [ ] **Step 2: add runtime negative tests.** Assert the runtime rejects: non-`character_form` responsibility, non-`unconditional` admission, NFC-unstable one-code-point input (for example `Å`), and NFKC-unstable compatibility target (for example a CJK compatibility ideograph). Keep existing one-code-point/reference/exclusion tests.
- [ ] **Step 3: add integration assertions.** Require `safe.apply('円応学宝竜') === '圓應學寶龍'`; retain `学校 -> 學校` + `がくかう`, contextual `台風 -> 颱風`, and absence of `弁`/`台` from deterministic map.
- [ ] **Step 4: run focused tests and observe RED.** Run `node --import tsx --test test/safe-character-source.test.ts test/safe-character-runtime.test.ts test/safe-character-integration.test.ts`. Expected: FAIL because current data contains only `学 -> 學` and current runtime does not enforce the new metadata/normalization contract.
- [ ] **Step 5: commit RED tests.** Preserve the failing-test checkpoint before production changes.

### Task 3: GREEN safe-character data and runtime

**Files:**
- Modify: `runtime/safe-character-runtime.js`
- Modify: `data/deterministic/safe-character-first-slice.json`
- Test: Task-2 files plus `test/phase46b-character-form.test.ts`

**Interfaces:**
- Consumes: Task-1 intake record IDs and Task-2 contract.
- Produces: frozen `characterMap` with exactly the five canonical mappings; no change to resolver precedence or consumer APIs.

- [ ] **Step 1: harden runtime minimally.** For each mapping require `responsibility === 'character_form'`, `admission === 'unconditional'`, and exact NFC/NFKC stability on both modern and historical one-code-point strings before adding them to the map. Preserve source/evidence closure, uniqueness, exclusions, and code-point application behavior.
- [ ] **Step 2: expand the canonical safe slice.** Add exact pinned KKH source metadata and relation-specific evidence for the four new pairs; keep the existing official source. Add explicit `responsibility`, `admission`, and `intakeRecordRef` to all five mappings. Existing `学` evidence semantics remain intact.
- [ ] **Step 3: run focused tests.** Run `node --import tsx --test test/phase46b-character-form.test.ts test/safe-character-source.test.ts test/safe-character-runtime.test.ts test/safe-character-integration.test.ts`. Expected: PASS.
- [ ] **Step 4: run complete local repository gate.** Run `npm run check`. Expected: PASS with no removed validation/test/typecheck/profile step.
- [ ] **Step 5: commit GREEN implementation.** No unrelated resolver/profile/consumer files.

### Task 4: exact-head Verify, Formal Review, acceptance

**Files:**
- No implementation file unless review finds a Critical/Important defect.
- Owner record: `japanese-orthography#70`; roadmap/control updates only after acceptance.

**Interfaces:**
- Consumes: complete 4.6B PR head.
- Produces: accepted main state or a single TDD review-fix pass followed by re-verification.

- [ ] **Step 1: require GitHub Actions Verify on exact PR head.** Full repository gate must pass; record run ID and exact head on #70.
- [ ] **Step 2: Formal Review against §§11, 16, 17, 18.** Check exact five-pair bound, KKH immutable pin, no `寳`, no weakening of `弁`/`台`, NFC+NFKC safety, intake closure, and no consumer/profile leakage.
- [ ] **Step 3: if any Critical/Important finding exists, add a failing test first, apply one bounded fix pass, and obtain a fresh exact-head Verify.** Minor findings are recorded without scope expansion.
- [ ] **Step 4: merge the independently revertible PR only when review is clean and exact-head Verify is green; then require post-main Verify.** Record accepted SHA/run on #70.
- [ ] **Step 5: update #28 and `devflow#180` to the accepted 4.6B state, then re-evaluate the first unfinished Phase-4.6 acceptance condition.** If no blocker emerges, select 4.6C; do not start Phase 5/6.

## Self-review result

- Spec coverage: §§11.1–11.3, 16.3, 16.5, 17/4.6B, and repository-level traceability/source-lock conditions are assigned to Tasks 1–4.
- Shared interfaces: Task 1 produces stable intake record IDs consumed by Tasks 2–3; Task 2 defines runtime/data behavior implemented by Task 3.
- Safety: merged/contextual characters and known bad legacy relations stay outside unconditional character authority.
- Proportion: no parser/bulk-source work is pulled forward from 4.6C–E; this remains an independently revertible 4.6B unit.
