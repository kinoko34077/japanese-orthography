# Semantic certainty and provenance design (#230/#244/#236)

## Goal

Make the diagnostics contract report semantic facts rather than counting serialized output spans. A preferred display reading is useful output decoration, not lexical or historical certainty.

## Explicit semantic state

Every summarized unit and every applied span must carry independent state for:

- `lexicalIdentity`: `resolved`, `ambiguous`, or `unknown`, with candidate IDs and restrictions;
- `reading`: `resolved`, `ambiguous`, or `unknown`, with the complete allowed reading set;
- `historical`: `resolved`, `candidate`, `unavailable`, or `unknown`, with route, basis, and evidence;
- `displayReading`: optional value plus its source (`priority`, `consensus`, or explicit input), explicitly marked as display-only;
- `provenance`: source references, canonical IDs, evidence references, and any Rule Program ID.

The serializer may select one display value under #244 when exactly one distinct reading has valid JMdict priority after restrictions. That selection must not mutate lexical identity, reading certainty, or historical state. A consensus value follows the same rule.

## Certainty policy

`certaintyOf` must inspect the semantic state in addition to span arbitration:

- `unique` requires an applied span, no competing output span, and resolved semantic fields required by the requested profile/output. For historical Ruby, a historical reading with valid basis/evidence is required.
- `conditional` is used when one display/output candidate survives but lexical identity, reading, or historical applicability remains ambiguous or depends on a preference/consensus.
- `unresolved` is used when required semantic information is missing, no authorized output exists, or arbitration did not apply.

Thus `男女` with a selected display preference is not historical `unique` while lexical identity/readings remain ambiguous. A format change from plain to Ruby cannot upgrade certainty because certainty is computed from semantic state, not from the number of Ruby spans.

The contract must preserve a neutral diagnostic record when no Ruby is emitted, so the UI can explain `historical: unavailable` rather than interpreting absence as a failed lookup.

## Authority policy

Authority is derived from explicit semantic basis and provenance:

- `literal_fact` only for an admitted literal whole-word/native exact fact;
- `source_rule` only for a source-backed deterministic or productive rule with source/evidence references;
- `derived_rule` or `project_rule` only when the corresponding basis is explicit;
- `none` when no authority/provenance exists.

In particular, reconstructed `必要 -> ひつえう` is not `literal_fact`, and a unit with empty `sourceRefs` and `evidenceRefs` is never labeled `source_rule` by adapter fallback. Authority labels must agree with the detail panel and the serialized provenance.

## Detail-panel contract

The adapter must serialize enough information for the UI to show modern reading, historical reading/status, lexical candidates, display preference, basis, authority, and all provenance IDs from the same resolved unit. The UI must not infer certainty from the presence of a `ruby` string.

## Required RED cases

- historical unknown with a modern display reading is not `unique` and has no historical authority;
- `男女` retains multiple lexical/readings candidates and is not `unique` even if `だんじょ` is selected for display;
- source-backed productive reconstruction has `source_rule`/`derived_rule` as specified, never `literal_fact`;
- no-provenance output has `authority: none`;
- plain and Ruby modes produce the same semantic certainty for the same unit;
- actual source-backed literal historical evidence continues to report `literal_fact`.

## Non-goals

This phase does not change source ingestion, select a lexical winner, invent new evidence, or change the canonical Ruby factorization algorithm.
