# Phase 4.8E — Occurrence-level applicability and overlap arbitration

Owner: #137 (parent #132). Shared core: `runtime/occurrence-arbitration.js` (UMD; used by both
`tools/productive-orthography.ts` and `runtime/productive-relation-runtime.js`). Lexical evidence:
`lexicalOccurrenceContext()` in `tools/lexical-span-analysis.ts`. Tests:
`test/phase48e-occurrence-applicability.test.ts`.

## Pipeline

1. Every productive match in the text is collected (no left-to-right cursor decides).
2. **Applicability gate** per occurrence, against the lexical occurrence context (the best
   analysis paths: fewest unknown characters, then fewest segments; all ties kept). A match must be
   admissible on **every** best path:
   - `anywhere` — no lexical condition (explicitly retained substring behaviour);
   - `lexical_boundary` (default for `substring_productive` when lexical evidence is supplied) —
     both ends on a lexical boundary; component split points of reading-aligned compositions count,
     so `弁護` in `弁護士` / `国選弁護士` qualifies while `弁護` in `勘弁 + 護衛` does not;
   - `left_boundary` / `right_boundary`; `whole_lexeme` — the match is a lexical unit;
   - `lexicalIdentity` — the unit's analysed lexemes must contain the identity.
   Admissible on some but not all best paths -> `ambiguous_lexical_boundary` (region unresolved).
   Without lexical evidence, the accepted Phase-4.7 behaviour is unchanged (except that
   `lexicalIdentity` cannot be verified and is blocked only when evidence is requested).
3. **Same-start longest** match shadows shorter ones (accepted 4.7 rule).
4. **Overlap components** (including shifted `AB` / `BC`) are arbitrated by maximal covered length.
   A unique optimal selection wins (`outranked_by_overlap` for the rest); optimal selections with
   identical output are equivalent; otherwise the region stays `unresolved`
   (`unresolved_shifted_overlap`, or `conflicting_productive_outputs` for identical spans).
5. Preserve blocks and upstream locked segments still win over productive matches.

Every blocked occurrence is traced with its reason. Results depend only on spans, outputs,
policies and lexical evidence, never on relation/input order.
