# Phase 4.6E 字音 Table Completeness Plan

Owner #70. Spec §10 of `docs/superpowers/specs/2026-09-30-phase46-orthography-completeness-design.md`.

## Decisions for the open spec questions
- Parser: `tools/sino-table-parser.ts`, main `<table>` rows; rowspan state carries 発音/現代仮名; locator `row:{n}:token:{k}` (`row:{n}:catch-all` for the その他 row). Grey (`#C0C0C0`) rows are `identity` records. `字（注記）` tokens carry a usage context; `(字)` tokens are excluded as uncertain.
- Key: `(NFC character, modern reading in hiragana, usage context | null)`. Compatibility-ideograph duplicates in the source merge into their NFC key.
- Workbook `字音仮名_まとめ.xlsx` and KKH `jion-jisyo`: not used (optional per spec).
- Direct API: `resolveHistoricalSino({ character, modernReading, context })`; `context` omitted = every usage, `null` = unqualified entries only.
- Word alignment: depth-first enumeration over kanji-only surfaces, segments shaped as one Sino syllable, table forms extended by the page's voicing note and gemination note; unlisted sounds are identity except geminated codas; results collapsed by output; >1 → candidates; >64 → unresolved.
- Coverage report: `data/reports/phase46e-sino-kana-coverage.json`.

## Tasks
1. RED tests (`test/phase46e-sino-kana.test.ts`): extraction counts, partition, byte-reproducibility, direct-API completeness over every admitted record, context candidates, word reconstruction and ambiguity, bundle precedence.
2. Parser + intake + compiler + validator (`tools/sino-kana.ts`, `tools/validate-sino-kana.ts`), wired into `npm run check`.
3. Sino runtime v2 (v1 retained), resolver passes the unit surface to `historicalLookup` and surfaces Sino candidates as `CANDIDATES`; bundle switches to the 4.6E artifact and exposes `resolveHistoricalSino`.
4. Full check, Formal Review, merge, reconcile #70 / #28 / devflow#180.
