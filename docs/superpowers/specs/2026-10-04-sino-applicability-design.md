# Positive 字音 applicability design (#268)

## Goal

Project the existing 字音 source knowledge into a compact runtime applicability fact so ordinary Sino-Japanese words can use source-backed component reconstruction without treating `lexicalOrigin=unknown` as Sino.

## Source and normalization

The HTML tables remain authoritative for explicit historical relations, identity records, heading readings, and admitted/excluded status. The workbook `仮名遣等資料/字音仮名_まとめ.xlsx` contributes reading-class evidence from the columns `呉音のみ`, `呉音漢音共通`, `漢音のみ`, and `慣用音等`.

The intake/compiler must normalize each admitted workbook cell into a deterministic record containing:

- kanji/symbol identity;
- modern reading and normalized historical reading value;
- one or more reading-class flags (`go`, `kan`, `go_kan`, `customary`);
- source row/column identity and canonical evidence reference;
- admitted/excluded status and identity-vs-change relation where available.

Blank, malformed, excluded, and unclassified cells do not become positive runtime evidence. Reconciliation must be keyed by canonical symbol and normalized reading, not by source row order. The compiler must report counts for admitted, excluded, ambiguous, and unclassified records and fail if an unexpected unclassified record is silently dropped.

## Applicability predicate

For a candidate to enter the positive Sino reconstruction route, at least one of these must hold:

1. the candidate has explicit admitted Sino lexical-origin evidence; or
2. every required kanji component has an admitted source-backed reading/class relation that matches the candidate's modern component reading and the selected reconstruction route.

The second route is the intended bridge for cases such as `必 / ひつ` where the workbook records `ヒツ` under `漢音のみ`, combined with the existing source-backed relation for `要 / よう -> えう`.

`lexicalOrigin=unknown` remains unavailable by itself. A candidate with missing, conflicting, or incomplete component evidence remains unresolved and is not promoted to Sino. Candidate ambiguity is retained for later arbitration and diagnostics.

## Runtime projection

Compile the reconciled fact into the BrowserPack as compact symbol/reading-class identifiers or bit flags plus provenance IDs. The runtime lookup must return applicability, evidence IDs, and the reason for failure (`missing`, `conflict`, or `not-positive`) without loading the workbook or scanning the full dictionary in the browser.

The projection must be versioned with the pack manifest and included in the pack digest. It must not alter existing explicit native historical relations or identity records.

## Required RED cases

- `必要 / ひつよう` reaches the positive component route and produces the source-backed reconstruction `ひつえう` once the Ruby phase consumes it.
- `必 / ひつ` is recognized as positive Han-on evidence from the workbook classification.
- `学 / がく` keeps the admitted identity relation and does not become a changed historical reading.
- a candidate with unknown origin and no component evidence does not enter the Sino route.
- Go-on-only and Han-on-only distinctions remain visible and are not merged into an undifferentiated reading set.
- HTML and workbook conflicts are surfaced as ambiguity/conflict, never resolved by source order.

## Non-goals

This phase does not add new dictionary sources, scan JMdict broadly, choose a lexical sense, change Ruby serialization, change GUI labels, cut over the worker, regenerate public Pages, or deploy a pack.

## Verification

Add compiler-level reconciliation assertions, runtime-pack lookup tests, and adapter-level tests for the positive and negative cases above. Record source counts, pack digest, and focused test output in the owning Issue before moving to the Ruby phase.
