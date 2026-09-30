# Phase 4.6F KiNoTch Semantic/Style Classification Plan

Owner #70. Spec §17 4.6F: "Deliver only evidence-backed KiNoTch-specific gaps after generic responsibilities are known."

## Evidence review
- Generic responsibilities are now fixed (4.6A–E accepted).
- Real authoring gaps with evidence already delivered: `こと → ヿ` (4.5B, #64/PR #67), `奇 → 畸` lexicalization (4.5C, txt-auto-replace#19/PR #20).
- No further authoring defect has been reported, so 4.6F adds **no new executable profile behavior** and does not change the consumer.

## Deliverable
The remaining gap against Phase-4.6 acceptance criterion 1 ("every active transformation relation has an explicit responsibility class") is the consumer-local KiNoTch rules. 4.6F records them in the Phase-4.6 intake model:

- vendored, blob-verified copies of `txt-auto-replace@198f856` stages 10/15/20/30/31/60;
- `data/intake/phase46f-kinotch-profile.json` — 373 records, one per active relation (runtime modes count as one relation);
- responsibilities: stage 10/20 (except ごと sequences)/30/31/15 runtime → `kinotch_style`; ごと sequences → `kinotch_semantic`; long-vowel exclusion → `preserve_unresolved`; stage 60 via the #57 per-entry classification (word substitutions → `kinotch_semantic`, variant preferences → `kinotch_style`, kyujitai candidates → `character_form` excluded unless already admitted in the safe map, merged characters → `merged_character` excluded, NFC-unstable → `preserve_unresolved` excluded);
- `validate:kinotch-profile-intake` in `npm run check`; tests prove no project relation becomes generic authority.
