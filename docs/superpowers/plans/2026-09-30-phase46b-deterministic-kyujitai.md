# Phase 4.6B Deterministic Kyujitai Expansion Implementation Plan

**Goal:** Expand generic deterministic shinjitai→kyujitai authority only for source-backed, normalization-stable same-character form relations, without admitting merged/contextual forms or bulk-reversing legacy/modernization tables.

**Accepted baseline:** `japanese-orthography@8c9b35eb7c1f8d7ada8fe57567d33cb84b91f1f5` (Phase 4.6A accepted).

**Design authority:** `docs/superpowers/specs/2026-09-30-phase46-orthography-completeness-design.md`, especially §§11, 16.3, 17 (4.6B), 18.

## Bounded admission set

The current deterministic slice already admits `学 -> 學`. 4.6B adds only the four additional pairs already named by the existing Cultural Affairs Agency character-form source descriptor and independently present in pinned KKH `kanji-jisyo`:

- `円 -> 圓`
- `応 -> 應`
- `宝 -> 寶`
- `竜 -> 龍`

Pinned KKH evidence:
- repository: `okikae/kkh`
- commit: `19b24f88ab55809a186d88c465959548495b26a2`
- path: `kanji-jisyo`
- blob SHA: `95c5db9b5bacb82ab2a685f24f74fef3b32f9992`
- license: BSD-2-Clause

KKH is corroborating evidence, not a blanket admission source. In particular, `宝 /寳` is not admitted because the accepted official target is `寶`, and KKH itself labels `寳` as a俗字 alternative. No other KKH relation is admitted by this unit merely because it appears in `kanji-jisyo`.

## Safety invariants

- Every executable mapping is explicitly `responsibility: "character_form"` and `admission: "unconditional"`.
- Both modern and historical forms are exactly one Unicode code point and NFC-stable.
- `弁` and `台` remain excluded from unconditional safe-character mapping.
- Existing Phase-4.6A exclusions `穗 -> 瓣` and `舖 -> 辯` remain non-character-form relations.
- Source/evidence references remain closed and reproducible; KKH is pinned by exact commit + blob SHA.
- Compatibility/profile data may provide regression evidence but never creates generic safety.
- No blind reverse of Stage-40/60, the Cultural Affairs Agency homophone table, or the whole KKH dictionary.
- No consumer (`txt-auto-replace`) change in 4.6B.

## Task 1 — RED: define the expanded source-backed character-form contract

**Modify:**
- `test/safe-character-source.test.ts`
- `test/safe-character-runtime.test.ts`

Add tests that require:
1. the canonical safe-character mapping set is exactly `円→圓, 応→應, 学→學, 宝→寶, 竜→龍` in deterministic order;
2. each canonical mapping declares `responsibility: "character_form"` and `admission: "unconditional"`;
3. the canonical slice contains the exact pinned KKH `kanji-jisyo` source descriptor and relation-specific KKH evidence for the four new mappings;
4. source evidence for each new mapping includes both the existing official character-form source and the pinned KKH relation;
5. `弁` / `台` remain negative controls;
6. runtime rejects a mapping with any other responsibility/admission;
7. runtime rejects an NFC-unstable modern or historical code point.

**RED expectation:** current main fails because only `学 -> 學` is admitted and runtime does not yet enforce responsibility/NFC stability.

## Task 2 — GREEN: harden safe-character runtime contract

**Modify:**
- `runtime/safe-character-runtime.js`
- test fixtures in `test/safe-character-runtime.test.ts` as required

Implement the minimum fail-closed checks:
- require `mapping.responsibility === "character_form"`;
- require `mapping.admission === "unconditional"`;
- require modern and historical strings to equal their NFC normalization;
- preserve all existing one-code-point, uniqueness, evidence-closure, and exclusion checks.

Do not add lexical/contextual fallback behavior.

Require focused tests and full `npm run check` GREEN before proceeding.

## Task 3 — GREEN: admit the four bounded relations with source-locked evidence

**Modify:**
- `data/deterministic/safe-character-first-slice.json`
- `test/safe-character-source.test.ts`

Add one exact KKH external-repository source descriptor to the safe-character slice and relation-specific evidence records. Keep the existing Cultural Affairs Agency descriptor as the primary same-character-form authority.

For each of `円/応/宝/竜`, add one unconditional `character_form` mapping whose positive evidence closes to:
- the existing official source; and
- the exact pinned KKH relation.

Update the existing `学 -> 學` mapping to declare the same explicit responsibility/admission metadata without changing its accepted evidence semantics.

Do not admit `寳`, `弁`, `台`, or any additional KKH pair in this unit.

Require exact-head Verify GREEN.

## Task 4 — integration/regression proof

**Modify:**
- `test/safe-character-integration.test.ts`
- other directly affected safe-character tests only if required by the explicit contract

Prove through the actual safe-character runtime/resolver composition that:
- deterministic application maps a representative combined input containing all five accepted forms to the exact historical forms;
- existing `学校` lexical/字音 behavior remains intact;
- contextual `台風 -> 颱風` remains contextual and `safe.apply("台風")` remains unchanged;
- `弁` remains absent from the deterministic map;
- no source-order or compatibility-profile behavior grants additional mappings.

Run the full repository gate on exact head: `npm run check` via GitHub Actions Verify.

## Task 5 — Formal Review and acceptance

Review the whole PR against the accepted Phase-4.6 design, with specific checks for:
- no relation beyond the five official bounded pairs in deterministic authority;
- exact KKH pin (`19b24f...` / blob `95c5db...`);
- no `寳` admission;
- no weakening of `弁`/`台` controls;
- NFC checks cover both sides;
- no consumer/profile/runtime layer leakage beyond safe-character contract hardening.

Any Critical/Important finding receives one TDD fix pass and fresh exact-head Verify.

After clean review:
- record final head + Verify + review outcome on #70;
- merge via independently revertible PR;
- verify post-main;
- update #28 and `devflow#180` only for the accepted 4.6B transition;
- re-evaluate Phase-4.6 acceptance conditions before selecting 4.6C.

## Non-goals

- bulk admission of the 229 audit candidates;
- full KKH `kanji-jisyo` completeness contract;
- homophone reverse restoration (4.6C);
- native historical-kana completeness (4.6D);
- 字音 completeness (4.6E);
- KiNoTch semantic/style migration (4.6F);
- consumer migration, Phase 5/6, package/API freeze, release/deploy/publication, credential/permission changes, destructive/shared-history operations, or RDC.
