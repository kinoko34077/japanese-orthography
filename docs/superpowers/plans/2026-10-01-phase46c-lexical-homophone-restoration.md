# Phase 4.6C Lexical / Homophone Restoration Implementation Plan

**Goal:** Bring the existing bounded homophone-rewrite slice into the accepted Phase-4.6 responsibility/evidence contract: reverse restoration is lexical, independently attested, ambiguity-preserving, and never promoted to unconditional character authority.

**Accepted baseline:** `japanese-orthography@a2926b7a16192365cd1f2266ece56acda31cc66c` (Phase 4.6B accepted; post-main Verify `36734772621` PASS).

**Design authority:** `docs/superpowers/specs/2026-09-30-phase46-orthography-completeness-design.md`, especially §§4, 7, 12, 15–18.

## Bounded relation set

4.6C first hardens the five reverse relations already present in `data/packs/contextual-kanji/homophone-rewrite.json`:

- `溶接 -> 熔接`
- `間欠 -> 間歇`
- `賛嘆 -> 讃嘆`
- `装丁 -> 装釘`
- `装丁 -> 装幀`

The Culture Agency 1956 table records the modernization direction `historical -> modern`. It remains provenance for the rewrite relation, but is not by itself reverse-restoration authority.

Independent lexical attestations are required before an existing reverse relation remains admitted. Re-observed lexical sources for this bounded unit:

- Kotobank `溶接`: `溶接 / 熔接`, including the note that `溶` is the rewrite of `熔`;
- Kotobank `間欠`: `間欠 / 間歇`, including the note that `間欠` is the rewrite of `間歇`;
- Kotobank `讃嘆`: `賛嘆 / 讚歎 / 讚嘆` spelling family;
- Kotobank `装丁`: `装丁 / 装釘 / 装幀`, including historical usage notes;
- Kanjipedia independently marks `間欠`, `賛嘆`, and `装丁` as rewrite forms.

Dictionary pages are lexical attestation. They are not coverage-contract datasets and do not create blanket reverse authority outside the exact lexical unit they attest.

## Safety invariants

- Every executable relation in this unit is an exact multi-character lexical surface, never a one-character reverse rule.
- Every admitted relation closes to both:
  1. Culture Agency modernization evidence; and
  2. at least one independent lexical dictionary attestation for the same lexical relation/family.
- Every executable relation is represented in Phase-4.6 intake as `responsibility: "lexical_historical_kanji"` and `disposition: "admitted"`.
- `装丁` retains both source-supported targets and resolves to `CANDIDATES`; relation/source ordering cannot choose a winner.
- Unique lexical units (`溶接`, `間欠`, `賛嘆`) may resolve automatically only when the resolver has an accepted lexical candidate for that exact surface.
- Existing `merged_character`, `character_form`, native-kana, 字音, and KiNoTch-profile responsibilities are unchanged.
- This unit does not bulk-reverse the Culture Agency table and does not claim source-snapshot completeness for that table.
- No consumer change, Phase 5/6, release/deploy/publication, credential/permission mutation, destructive/shared-history operation, unpublished lyric fixture, or RDC.

## Task 1 — RED: pin 4.6C evidence/intake contract

**Add/modify:**
- `test/phase46c-lexical-homophone.test.ts`
- `data/evidence/dictionaries/kotobank.json`
- `data/evidence/dictionaries/kanjipedia.json` only where an independently verified relation is retained
- `data/intake/phase46c-lexical-homophone.json`
- `data/packs/contextual-kanji/homophone-rewrite.json`

Write tests first that require:

1. the bounded modern/target relation multiset is exactly the five relations above;
2. every admitted relation has its existing Culture Agency evidence ref plus a lexical evidence ref whose claim attests the same exact lexical relation or spelling family;
3. no admitted relation has a one-code-point `match`;
4. every relation closes to an intake record with responsibility `lexical_historical_kanji`, disposition `admitted`, matching modern/historical surfaces, and source/evidence provenance;
5. the intake bundle uses only supplemental/candidate source roles, not `coverage-contract`, because 4.6C is a bounded admission unit rather than full-table extraction;
6. `装丁` has exactly two admitted targets `{装釘, 装幀}` and no preferred/default target field.

**RED expectation:** current main fails because homophone relations cite only the Culture Agency rows and have no 4.6C intake closure.

Commit the test-only RED state and require GitHub Actions Verify to fail only on the new contract while the existing suite remains green.

## Task 2 — GREEN: add independent lexical evidence and intake closure

Add minimal lexical evidence records to the existing dictionary evidence bundles. Preserve recoverable source locator URLs and describe only what the referenced dictionary page actually attests.

Create `data/intake/phase46c-lexical-homophone.json` with one admitted intake record per executable target relation. Use:

- `responsibility: "lexical_historical_kanji"`;
- `disposition: "admitted"`;
- exact `modernSurface` / `historicalSurface`;
- Culture Agency source as modernization provenance;
- dictionary evidence as lexical attestation.

Update each relation's `evidenceRefs` so it closes to both evidence roles. If the contextual pack schema needs an explicit intake link to make closure mechanically enforceable, add the smallest versioned schema/model extension and fail-closed validation; otherwise keep the intake linkage in a dedicated repository invariant test rather than adding duplicate runtime metadata.

Do not invent UniDic lemma IDs. The existing exact whole-word `match` is the lexical unit for this bounded admission; UniDic binding expansion is a separate step only if a RED integration test proves runtime behavior cannot meet the accepted contract without it.

Require focused tests and full `npm run check` GREEN.

## Task 3 — RED/GREEN: prove ambiguity and runtime behavior

**Modify/add:**
- contextual resolver/integration tests only as necessary.

Prove:

- relation order reversal for the two `装丁` relations does not change the candidate set;
- `装丁` exposes both `装釘` and `装幀` and never becomes `AUTO` merely because one relation appears first;
- unique target relations can become `AUTO` when an accepted lexical candidate for the exact surface is supplied;
- a surface with no accepted lexical candidate does not acquire a homophone restoration merely from character overlap;
- no single-character relation is generated or admitted by this unit.

If current lexical runtime fixtures do not contain these words, use a narrowly typed accepted lexical candidate fixture for resolver semantics rather than forging production UniDic identities. Production UniDic expansion occurs only if required for accepted runtime integration and must then be generated from real pinned UniDic source data.

Require exact-head Verify GREEN.

## Task 4 — Formal Review and acceptance

Review the exact PR diff against the Phase-4.6 design:

- official modernization evidence is not mislabeled as reverse lexical proof;
- independent lexical evidence exists for every admitted target;
- `装丁` remains ambiguous and order-independent;
- no one-character reverse authority is introduced;
- every executable relation has `lexical_historical_kanji` intake responsibility;
- no 4.6D/E/F, consumer, profile, package/API, release/deploy, credential, or RDC leakage.

Any Critical/Important finding receives one TDD fix pass and a fresh exact-head Verify.

After clean review:
- record exact head + Verify + review outcome on #70;
- merge through a reversible PR with expected-head protection;
- require post-main Verify PASS;
- update #28 and `devflow#180` only for the accepted 4.6C transition;
- re-evaluate Phase-4.6 acceptance conditions and continue to 4.6D if no earlier acceptance condition remains unfinished.

## Non-goals

- full Culture Agency homophone-table reverse ingestion;
- one-character modern→historical reverse mappings;
- full KKH `kanji-jisyo` completeness;
- Phase 4.6D native historical-kana completeness;
- Phase 4.6E 字音 completeness;
- Phase 4.6F KiNoTch semantic/style migration;
- consumer migration;
- Phase 5/6;
- release/deploy/publication;
- credential/session/permission changes;
- destructive/shared-history operations;
- RDC.
