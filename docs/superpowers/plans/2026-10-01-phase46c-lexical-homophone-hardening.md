# Phase 4.6C Lexical/Homophone Hardening Implementation Plan

**Goal:** Close the already-admitted official homophone-rewrite mini-slice into the Phase-4.6 responsibility/intake model, preserve lexical-unit boundaries and ambiguity, and prevent the official modernization table from becoming bare-character reverse authority.

**Accepted baseline:** `japanese-orthography@a2926b7a16192365cd1f2266ece56acda31cc66c` (Phase 4.6B accepted; post-main Verify `36734772621` PASS).

**Design authority:** `docs/superpowers/specs/2026-09-30-phase46-orthography-completeness-design.md`, especially §§7, 12, 15, 16.3, 17 (4.6C), 18; contextual-corpus authority #2 remains compatible and subordinate to the Phase-4.6 owner #70.

## Bounded official lexical set

This unit does **not** ingest the full 1956 table. It hardens the five already-canonical whole-word reverse relations whose primary evidence is committed in `data/evidence/culture-agency-1956-douon.json`:

- `溶接 -> 熔接`
- `間欠 -> 間歇`
- `賛嘆 -> 讃嘆`
- `装丁 -> 装釘`
- `装丁 -> 装幀`

The primary source direction remains `historical -> modern`; these reverse relations are project-admitted lexical restorations for the exact listed modern lexical surfaces, not evidence for any universal reverse character mapping.

The live audit found no accepted real-UniDic binding for the four modern keys (`溶接`, `間欠`, `賛嘆`, `装丁`) in the current committed lexical slice. This plan therefore does **not** fabricate lemma IDs. Exact source-identified lexical surfaces are the bounded lexical identity for this unit. A later relation that requires sense/homograph disambiguation must obtain a separately source-backed lexical binding before AUTO authority.

## Intake/admission semantics

Add one supplemental official intake snapshot for the existing Culture Agency evidence and represent the active relations as `lexical_historical_kanji`:

- `溶接 -> 熔接`: `admitted`
- `間欠 -> 間歇`: `admitted`
- `賛嘆 -> 讃嘆`: `admitted`
- `装丁 -> {装釘, 装幀}`: one `candidate_ambiguous` intake record whose alternatives contain both targets; both executable candidate relations close to that same record.

`admitted` at the canonical relation layer continues to mean “eligible relation/candidate”, not “chosen default”. For `装丁`, runtime/compiler behavior must retain both viable candidates and must never pick one by file/source order.

## Safety invariants

- Every changed executable relation declares `responsibility: "lexical_historical_kanji"` and a non-empty `intakeRecordRef`.
- A linked `admitted` intake record must exactly match relation modern/historical surfaces.
- A linked `candidate_ambiguous` intake record must match the modern surface and include the relation target in its complete alternatives set.
- `candidate_ambiguous` alternatives are canonicalized deterministically and source order cannot select a winner.
- No one-character reverse relation is added or inferred.
- `間欠 -> 間歇` remains the lexical target; downstream variant rendering such as `間 -> 閒` stays outside this relation.
- `賛嘆 -> 讃嘆` remains the lexical target; later character/variant rendering is separate.
- No KKH/kyujipy/legacy table is bulk-imported by this unit.
- Existing merged-character (`弁`), guarded `台`, deterministic character-form, native-kana, 字音, and KiNoTch profile authorities remain unchanged.
- No consumer (`txt-auto-replace`) change, Phase 5/6, release/deploy/publication, credential/permission mutation, shared-history rewrite, or RDC.

## Task 1 — RED: define cross-domain lexical-intake closure

**Create/modify:**
- `test/phase46c-lexical-homophone.test.ts`
- `data/intake/phase46c-homophone-rewrite.json` (absent during initial RED)
- `data/packs/contextual-kanji/homophone-rewrite.json`

Write failing tests requiring:
1. the bounded relation set remains exactly the five relations above;
2. every relation has `responsibility: "lexical_historical_kanji"` and `intakeRecordRef`;
3. the three single-target records are `admitted` and close exactly to their executable relation;
4. `装丁` is represented once in intake as `candidate_ambiguous` with complete alternatives `{装釘, 装幀}`;
5. both `装丁` executable candidate relations reference that record;
6. no bare-character reverse relation exists for any changed character;
7. relation evidence still closes to the existing primary Culture Agency evidence IDs.

**RED expectation:** current main fails because the contextual relations are not connected to Phase-4.6 intake and carry no explicit Phase-4.6 responsibility metadata.

## Task 2 — GREEN: materialize the bounded Phase-4.6C intake

**Create:**
- `data/intake/phase46c-homophone-rewrite.json`

Use one `sourceClass: "official"`, `coverageRole: "supplemental"` snapshot pointing to the existing Culture Agency source locator/version. Do not claim full-table coverage.

Materialize:
- three admitted mapping records for `溶接`, `間欠`, `賛嘆`;
- one ambiguous alternative record for `装丁`, with both historical alternatives and both existing evidence refs.

Do not add fabricated `lexicalIdentity` values.

## Task 3 — GREEN: attach contextual relations to responsibility/intake metadata

**Modify:**
- `schema/v1/contextual-kanji-pack.schema.json`
- `tools/model.ts`
- `data/packs/contextual-kanji/homophone-rewrite.json`
- directly affected schema/model tests

Extend `PositiveRelation` minimally so Phase-4.6 relations may carry:
- `responsibility` from the accepted responsibility enum;
- `intakeRecordRef` as a non-empty string.

For the five bounded relations, set responsibility/intake references exactly as defined above. Do not require these fields globally for unrelated pre-4.6 contextual relations in this unit; later Phase-4.6 units/final closure will finish the repository-wide classification requirement.

## Task 4 — fail-closed cross-domain validation

**Create/modify:**
- `tools/phase46-authority-closure.ts`
- `tools/validate.ts`
- `test/phase46c-lexical-homophone.test.ts`

Add validation for every contextual relation that declares a Phase-4.6 `intakeRecordRef`:
- referenced intake record exists;
- relation responsibility equals intake responsibility;
- modern surface equals the intake modern surface;
- `admitted`: relation target equals `historicalSurface`;
- `candidate_ambiguous`: relation target is included in canonicalized `alternatives`;
- any other disposition cannot compile as admitted hot authority through this linked relation.

Wire this closure into the repository validation/check path. The validator is incremental: it enforces declared Phase-4.6 links without pretending that unrelated pre-existing relation families have already been migrated.

## Task 5 — ambiguity/runtime regression proof

**Modify:**
- `test/canonical-slice.test.ts` and/or `test/orthography-resolver.test.ts` only as needed
- `test/phase46c-lexical-homophone.test.ts`

Prove:
- `溶接`, `間欠`, `賛嘆` retain their exact admitted lexical target;
- `装丁` produces the complete two-target candidate set and source order reversal does not select a winner;
- no one-character reverse authority is introduced;
- downstream safe-character rendering remains a separate stage;
- existing `台風`, merged `弁`, native-kana and 字音 regressions remain green.

Run focused tests, then full `npm run check` on exact head.

## Task 6 — Formal Review and acceptance

Formal Review checks:
- only the five existing official lexical relations are changed by this unit;
- no fabricated UniDic identity/binding;
- `装丁` ambiguity is complete and order-independent;
- primary source direction/provenance is preserved;
- no single-character reverse authority or layer leakage;
- intake closure is fail-closed for every declared Phase-4.6 contextual link;
- no consumer/profile/Phase-5+ scope leakage.

After clean exact-head Verify + review:
- record accepted head/check/review on #70;
- merge by revertible PR;
- confirm post-main Verify;
- update #28 and `devflow#180` for 4.6C acceptance;
- re-evaluate Phase-4.6 acceptance conditions and continue to 4.6D unless a concrete unmet 4.6C condition remains.

## Non-goals

- exhaustive 1956 homophone-table ingest;
- full contextual-kanji corpus completion under #2;
- invented or guessed UniDic lemma IDs;
- full external KKH/kyujipy import;
- merged-character expansion beyond already accepted boundaries;
- native historical-kana completeness (4.6D);
- 字音 completeness (4.6E);
- KiNoTch semantic/style migration (4.6F);
- consumer migration, Phase 5/6, package/API freeze, release/deploy/publication, credentials/permissions, destructive/shared-history operations, or RDC.
