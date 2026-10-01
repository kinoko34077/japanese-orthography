# Phase 4.8D — Lexical/morphological span-analysis bridge

Owner: #136 (parent #132). Code: `tools/lexical-span-analysis.ts`; tests: `test/phase48d-span-analysis.test.ts`.

`analyze(text)` returns a **span lattice**, not a committed tokenization:

- **Lexical spans**: every substring that is a pinned-JMdict surface (kanji form with its
  restriction-respecting readings; kana readings of kana-only or `uk` entries). Each span lists
  typed candidates: `LexemeId` (4.8C mapping contract), `ReadingPathId`s, `CategoryId`s and
  `jmdict:<date>:seq:<n>` provenance. Overlapping spans (`勘弁` / `弁護` / `護衛`) all stay.
- **Unknown spans**: maximal runs no lexical span covers; analysis never aborts.
- **Paths** (`paths(limit)`): complete segmentations through the lattice; positions no lexical
  span starts at are crossed as unknown characters. `勘弁+護衛` and `勘+弁護+衛` are both
  representable; arbitration is 4.8E.
- **Composition**: offered only when the reading aligns exactly with the concatenated component
  readings (`弁護士 べんごし = 弁護 べんご + 士 し`, likewise `人 にん`, `団 だん`). No
  reading alignment, no composition. `国選弁護士` (not a JMdict entry) is reachable as
  `国選 + 弁護士`, whose candidate carries the `弁護` component.
- **Morphology**: accepted UniDic-CWJ 2025.12 slice records attach as evidence by surface
  (`sourceRef: unidic-cwj:2025.12:lemma:<id>`); UniDic ids never become semantic ids.

Analyzer gap note: the repository commits only the bounded UniDic slice, not full `lex.csv`, so
UniDic contributes morphology evidence where the slice covers a surface while JMdict supplies
lattice coverage. The required 4.8 regression cases are satisfied by UniDic + JMdict; no
Sudachi dependency was needed.
