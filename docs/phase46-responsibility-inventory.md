# Phase 4.6 Responsibility / Authority Inventory

This inventory records the Phase-4.6 linguistic responsibility of the current data families separately from their current storage location or execution authority. It is a migration/audit aid, not a resolver precedence table.

## Responsibility inventory

| Current family / path | Phase-4.6 responsibility | Current authority / use | 4.6A boundary |
| --- | --- | --- | --- |
| `data/deterministic/safe-character-first-slice.json` | `character_form` | source-backed generic deterministic character-form authority for admitted mappings; also carries negative controls | Only independently evidenced same-character form relations may enter this responsibility. `弁` and `台` remain explicit exclusions from unconditional ownership. |
| `data/packs/contextual-kanji/*.json` | `lexical_historical_kanji` and `merged_character` | admitted contextual relations, lexical constraints, preserves, and review hints | Responsibility is assigned per relation. The pack directory is not itself one linguistic class. `merged-ben.json` and `merged-tai.json` demonstrate that `弁`/`台` require lexical or sense context rather than one global character target. |
| `data/lexical/sources/*`, `data/lexical/bindings/*`, `data/lexical/constraints/*` | supporting identity/evidence infrastructure for `lexical_historical_kanji` / `merged_character` | lexical identity, morphology and contextual binding evidence | These files identify the lexical unit to which a relation applies; they do not become replacement authority independently of an admitted relation. |
| `data/historical/native/*` | `historical_kana_native` | current bounded source-backed native historical-kana slice/runtime input | Phase 4.6D will expand this responsibility under the selected source-completeness contracts. 4.6A does not claim full native coverage. |
| `data/historical/sino/*` | `historical_kana_sino` | current bounded source-backed 字音 slice/runtime input | Phase 4.6E will expand this responsibility. KKH `jion-jisyo` remains supplemental; the committed `仮名遣等資料/字音仮名遣い表.html` is the selected full coverage oracle. |
| `data/profiles/kinotch/legacy-kanji.json`, `homophone-kanji.json`, `official-homophone-restoration.json`, `legacy-stage60-classification.json` | mixed: `character_form`, `lexical_historical_kanji`, `merged_character`, `kinotch_semantic`, `kinotch_style`, or `preserve_unresolved` depending on the record | KiNoTch compatibility/profile behavior and migration evidence | Never assign the whole legacy/profile file one linguistic responsibility. Compatibility authority does not imply generic safety. Each relation requires individual evidence/admission before generic migration. |
| `data/profiles/kinotch/token-style-overlay.json` | `kinotch_style` | project-specific rendering/style authority | Remains separate from generic historical orthography authority. |
| explicit safety exclusions, unresolved legacy relations, normalization-unstable or cross-character corruption | `preserve_unresolved` | fail-closed safety boundary | Exclusion requires an explicit reason. A preserved/excluded relation is not an admitted transformation. |
| `test/fixtures/pinned/txt-auto-replace/*.json5` and generated/golden compatibility artifacts | no generic responsibility by themselves; migration/audit evidence only | behavioral compatibility snapshots | They may prove what the historical consumer did, but cannot alone prove linguistic/generic correctness. |

## Known Phase-4.6 safety classifications

The machine-readable companion is `data/intake/phase46-legacy-safety.json`.

- Stage-40 `弁 -> 辨` is retained as evidence of historical consumer behavior, but is classified under `merged_character / candidate_ambiguous`, not `character_form / admitted`.
- `merged-ben.json` currently contains distinct lexical outcomes (`合弁 -> 合辦`, `合弁 -> 合瓣`), an explicit preserve case (`武弁`), and a review-only `弁護 -> 辯護` hint. This is evidence against selecting one global `弁` target.
- `merged-tai.json` currently contains lexical outcomes `台風 -> 颱風`, `台頭 -> 擡頭`, and a preserve/block case for `台密`. Therefore `台` remains a contextual/merged responsibility rather than a generic deterministic one-target mapping.
- Stage-40 `穗 -> 瓣` and `舖 -> 辯` are not same-character old/new-form relations and are explicitly classified `preserve_unresolved / excluded_unresolved` with reason `legacy_relation_not_same_character_form`.

## Selected source-completeness families after 4.6A

4.6A establishes the contract used by later parsers but does not itself claim full ingestion of these sources.

### Native historical kana — Phase 4.6D

Coverage-contract sources selected by the approved Phase-4.6 design:

- pinned `okikae/kkh@19b24f88ab55809a186d88c465959548495b26a2:kana-jisyo`;
- `仮名遣等資料/仮名遣い辞典本文.html`;
- `仮名遣等資料/例外動詞一覧：歴史的仮名遣い教室.html`;
- `仮名遣等資料/動物名・植物名歴史的仮名遣い辞典.html`;
- mechanically extractable rule/example material from `仮名遣等資料/歴史的仮名遣いで書きたい.html`.

For a source designated `coverage-contract`, every discovered record must become `admitted`, `candidate_ambiguous`, or `excluded_unresolved`; mapping-shaped parser remainder is an error.

### 字音 — Phase 4.6E

- `仮名遣等資料/字音仮名遣い表.html` is the selected committed full coverage oracle.
- KKH `jion-jisyo` is supplemental because the source describes it as Beta/incomplete.
- `仮名遣等資料/字音仮名_まとめ.xlsx` may support reconciliation only after mechanical agreement with the selected HTML oracle.

## Authority rule

Responsibility answers **what linguistic transformation a record represents**. Authority answers **whether and where that record may execute**. A source file, compatibility fixture, profile, or corpus location does not determine responsibility by itself; admission evidence and safety constraints do. This separation is required throughout Phase 4.6 so generic historical authority cannot be created accidentally from KiNoTch profile behavior or old consumer snapshots.
