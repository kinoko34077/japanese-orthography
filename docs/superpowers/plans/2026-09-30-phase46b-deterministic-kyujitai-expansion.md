# Phase 4.6B Deterministic Kyujitai Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand generic deterministic same-character modern→historical character authority from the accepted `学→學` control to the five Culture Agency pairs already explicitly pinned in the safe-character source descriptor: `円→圓`, `応→應`, `学→學`, `宝→寶`, `竜→龍`.

**Architecture:** Keep the existing safe-character runtime unchanged and expand only its source-backed data. Each admitted mapping remains one modern code point to one historical code point, has explicit official evidence, is Unicode normalization-stable, and is rejected if the modern character is in the contextual exclusion set. Compatibility/profile mappings remain regression evidence only and do not confer generic authority.

**Tech Stack:** Node.js >=22, TypeScript 7 tests, node:test, existing UMD safe-character runtime, GitHub Actions `npm run check`.

**Spec:** `docs/superpowers/specs/2026-09-30-phase46-orthography-completeness-design.md`

## Global Constraints

- Admit only same-character form relations explicitly supported by the already-recorded Culture Agency source.
- Accepted set for this unit is exactly `円→圓`, `応→應`, `学→學`, `宝→寶`, `竜→龍`.
- `弁` and `台` remain excluded from unconditional character authority.
- Do not infer generic safety from `data/profiles/kinotch/legacy-kanji.json` or other compatibility snapshots.
- Every target is exactly one Unicode code point and must satisfy NFC/NFKC stability in this bounded set.
- No runtime algorithm change unless a RED test proves the existing runtime cannot express the accepted data.
- No lexical/homophone/native historical-kana/字音/profile migration in 4.6B.
- No Phase 5/6, release/deploy/publication, credential/permission mutation, destructive/shared-history operation, unpublished lyric fixture, or RDC.

## Review Focus

- An admitted historical target normalizes to a different code point under NFKC.
- A mapping lacks official same-character-form evidence or borrows the `学` project ruling incorrectly.
- `弁` or `台` reappears in the unconditional map.
- Compatibility profile membership is accidentally treated as generic proof.
- Source/runtime tests disagree on the exact five-pair set or mapping order.

---

### Task 1: Pin the exact five-pair source contract

**Files:**
- Modify: `test/safe-character-source.test.ts`
- Modify: `data/deterministic/safe-character-first-slice.json`

**Interfaces:**
- Produces the canonical deterministic map consumed by `runtime/safe-character-runtime.js`.
- Existing official source ID remains `bunkacho-joyo-character-form`.

- [ ] **Step 1: Write failing source tests**

Change the expected canonical mapping list to exactly:

```ts
[
  ['円', '圓'],
  ['応', '應'],
  ['学', '學'],
  ['宝', '寶'],
  ['竜', '龍']
]
```

Assert every admitted mapping:
- has `admission === 'unconditional'`;
- has a non-empty evidence list resolving to the official Culture Agency source;
- has one-code-point modern/target values;
- has `historical.normalize('NFC') === historical` and `historical.normalize('NFKC') === historical`.

Retain exact exclusions `['弁', '台']`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --import tsx --test test/safe-character-source.test.ts`
Expected: FAIL because only `学→學` is currently admitted.

- [ ] **Step 3: Add the four official mappings and evidence records**

Add same-character-form evidence records for `円`, `応`, `宝`, `竜`, all referencing `bunkacho-joyo-character-form`. Keep the existing `学` project-layer evidence as additional evidence only for `学`; do not copy that project ruling onto the other mappings. Do not add compatibility regression refs unless the existing pinned profile independently contains the exact pair.

- [ ] **Step 4: Verify GREEN**

Run: `node --import tsx --test test/safe-character-source.test.ts`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `data: expand source-backed deterministic kyujitai`

### Task 2: Prove runtime and resolver composition without changing runtime code

**Files:**
- Modify: `test/safe-character-runtime.test.ts`
- Modify: `test/safe-character-integration.test.ts`
- Production runtime: no change expected.

**Interfaces:**
- Consumes the canonical five-pair source slice from Task 1.
- Proves the existing runtime applies all admitted mappings while preserving contextual exclusions.

- [ ] **Step 1: Write failing runtime/integration assertions**

Assert the canonical runtime applies:

```text
円応学宝竜 -> 圓應學寶龍
```

and still preserves `弁台` in the bare safe-character layer.

In integration, assert the loaded canonical safe map contains the five admitted keys and excludes `弁`/`台`; retain existing contextual `台風→颱風` behavior.

- [ ] **Step 2: Run focused tests and verify expected state**

Run: `node --import tsx --test test/safe-character-runtime.test.ts test/safe-character-integration.test.ts`
Expected after Task 1 data: PASS without production runtime changes. If this passes immediately, record that runtime capability pre-existed and do not manufacture a runtime change.

- [ ] **Step 3: Run full repository verification**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit test-only integration proof if changed**

Commit message: `test: verify expanded deterministic kyujitai runtime`

### Task 3: Formal review, merge, and reconcile 4.6B

**Files:**
- No additional production files unless review exposes a defect.
- Durable state: #70, `devflow#180`, #28.

- [ ] **Step 1: Review exact PR diff against the Phase-4.6 design**

Confirm the PR changes only source-backed deterministic character data/tests; no contextual/profile/native-kana/字音 widening and no compatibility-derived authority.

- [ ] **Step 2: Verify exact head**

GitHub Actions Verify must PASS on the unchanged PR head.

- [ ] **Step 3: Merge through the reversible PR path**

Merge only if head is unchanged and review is clean. No release/deploy/publication.

- [ ] **Step 4: Verify accepted main and reconcile durable state**

Require post-main Verify PASS. Update #70, `devflow#180`, and #28 with accepted SHA/evidence and re-evaluate the next unfinished Phase-4.6 condition. If 4.6B acceptance is satisfied, move to bounded 4.6C planning.
