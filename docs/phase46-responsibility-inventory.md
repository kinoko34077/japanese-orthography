# Phase 4.6 Responsibility / Authority Inventory

This inventory records the Phase-4.6 linguistic responsibility of the repository's existing rule/data families separately from their current authority and storage location. A legacy filename or stage number is migration evidence, not a linguistic responsibility.

| Current family / location | Primary Phase-4.6 responsibility | Current authority role | Phase-4.6 handling |
| --- | --- | --- | --- |
| `data/deterministic/` safe-character material | `character_form` | generic only where an individual relation is already admitted by evidence/safety checks | keep deterministic character-form relations separate from lexical/contextual restoration |
| `data/packs/contextual-kanji/` homophone/contextual relations | `lexical_historical_kanji` | generic contextual authority only under the existing lexical constraints | retain lexical evidence and safety bindings; never flatten to unconditional character replacement |
| `data/packs/contextual-kanji/merged-ben.json` | `merged_character` | contextual/candidate authority per lexical identity; explicit preservation also exists | `弁` itself never receives one unconditional historical target |
| `data/packs/contextual-kanji/merged-tai.json` | `lexical_historical_kanji` | contextual authority for lexical units such as `台風` / `台頭`, plus fallback blocking | `台` itself remains guarded/contextual rather than generic deterministic character authority |
| `data/historical/native/` | `historical_kana_native` | source-backed native historical-kana first-slice/runtime data | later 4.6D expands this through source-complete pinned KKH + committed material ingestion |
| `data/historical/sino/` | `historical_kana_sino` | source-backed 字音 first-slice/runtime data | later 4.6E expands this against the full committed 字音 coverage oracle |
| `data/profiles/kinotch/` semantic compatibility/profile material | `kinotch_semantic` when the relation is project-specific semantic policy | KiNoTch profile only; compatibility evidence does not imply generic safety | keep outside generic linguistic authority |
| KiNoTch token-style overlay / style-render material | `kinotch_style` | KiNoTch profile/render policy only | keep as late/project-specific style responsibility |
| explicit safety constraints, excluded relations, normalization-unstable or corrupt legacy candidates | `preserve_unresolved` | no automatic positive authority | preserve or expose for review with explicit machine-readable reason |
| legacy Stage-40/50/55/60 snapshots and compatibility fixtures | mixed; classify per relation rather than per file | regression / migration / compatibility evidence | never treat the whole legacy bundle as one linguistic layer or as proof of generic safety |

## Known Phase-4.6A safety boundaries

`data/intake/phase46-legacy-safety.json` records four already-known boundaries without changing runtime behavior:

- Stage-40 `弁 -> 辨` is compatibility evidence for a merged modern character, not proof that `辨` is the unconditional generic target. Existing contextual evidence already distinguishes `辦`, `瓣`, `辯`, and preservation cases.
- `台` remains lexical/contextual. Existing data distinguishes `台風 -> 颱風`, `台頭 -> 擡頭`, and a fallback block for an original-`台` lexical unit.
- Stage-40 `穗 -> 瓣` is not a same-character modern/old-form relation and is explicitly excluded/unresolved.
- Stage-40 `舖 -> 辯` is not a same-character modern/old-form relation and is explicitly excluded/unresolved.

These records use `coverageRole: candidate-only`. They are an auditable migration/safety checkpoint and do not grant generic runtime authority.

## Authority boundary

Phase 4.6 keeps responsibility and authority orthogonal. A record may be correctly classified as `character_form`, `merged_character`, or historical-kana data without automatically becoming executable generic authority. Admission still depends on the evidence and ambiguity rules of the accepted Phase-4.6 design. Conversely, KiNoTch compatibility behavior may remain intentionally executable in its profile while having no generic-safety implication.
