# Browser runtime stabilization design

Status: design approved in conversation; implementation remains unselected until this written specification is reviewed.

Baseline: `main@07a1642062376fd9ea3c42df4c3cf7f40f5f1559`

Owning evidence: Issues #222, #223, #227, #229, #230, #236, #244, #250, #267, and #268. The implementation order is deliberately narrower than the full issue graph:

1. Compile positive 字音 reading-class applicability (#268).
2. Restore historical-Ruby authority and safe serialization (#267/#223).
3. Separate semantic certainty, display preference, and provenance (#230/#244/#236).
4. Cut the BrowserPack worker over to the accepted Rule Program runtime (#229).

The order is a dependency order. No Pages publication, BrowserPack republish, broad dictionary rediscovery, or #210 dictionary expansion is part of this design.

## Shared invariants

- `displayReading` is presentation data. It never authorizes a historical transformation or a lexical-identity claim.
- A historical Ruby is emitted only from an admitted historical reading or a deterministic, source-backed reconstruction whose basis is explicit.
- A single serialized output candidate is not semantic certainty. Lexical identity, reading, historical applicability, and output arbitration remain separately inspectable.
- Authority labels are derived from actual basis and provenance. Empty provenance is `none`; it is never upgraded to `source_rule` by fallback.
- Unknown origin is not positive Sino evidence. Positive applicability must be demonstrated by source-backed origin or component evidence.
- Candidate lists and ambiguity are preserved. No storage-order or priority winner may silently become a semantic winner.
- Legacy and Rule Program execution must be comparable until parity is accepted. The new runtime is not considered live merely because it produces an audit trace.

## Phase specifications

- [Positive 字音 applicability](2026-10-04-sino-applicability-design.md)
- [Historical Ruby authority and serialization](2026-10-04-historical-ruby-serialization-design.md)
- [Semantic certainty and provenance](2026-10-04-semantic-certainty-provenance-design.md)
- [Browser Rule Program cutover](2026-10-04-browser-rule-program-cutover-design.md)

## Cross-phase acceptance

Each phase must add RED regressions before implementation, make its focused suite GREEN, and preserve the existing full-check contract. The representative real-text corpus includes `学校`, `必要`, `必ずしも`, `東南アジア`, `好む`, `男女`, `大人層`, `市場特性`, `出版各社`, `日本企業`, `サービス`, an ambiguous lexical case, unknown/ASCII text, emoji, and protected spans.

The end state is accepted only when:

- historical unknown and lexical ambiguity cannot be reported as `unique`;
- Ruby output cannot use a modern `displayReading` as historical evidence;
- source-backed productive reconstruction carries a non-literal basis and real provenance;
- #268 source-backed evidence enables the intended `必要 -> ひつえう` route without making unknown-origin text Sino;
- explicit and implicit Ruby modes preserve semantic decisions while changing only serialization;
- the worker's production output comes from the Rule Program runtime after parity evidence, with cold/warm measurements recorded;
- exact-head verification is performed after the final implementation commit; and
- no deployment or publication occurs without a separate explicit authorization.
