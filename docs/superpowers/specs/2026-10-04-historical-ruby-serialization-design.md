# Historical Ruby authority and serialization design (#267/#223)

## Goal

Keep historical semantics independent from serialization. Historical Ruby must come from a historical decision; modern display readings may decorate a modern output but cannot be used as a historical fallback.

## Resolver contract

For a historical profile, a resolved unit exposes separate fields for:

- `reading.modernSurface` and `displayReading`, used for modern lexical display;
- `historical.kana`, the admitted or source-backed historical reading;
- `historical.route`, the route used to obtain it;
- `historical.basis`, the semantic basis (`literal_whole_word`, `native_exact_surface`, `sino_component_reconstruction`, `deterministic_identity`, or equivalent explicit value);
- source/evidence/canonical IDs.

The renderer consumes `historical.kana` only when the selected profile requests historical Ruby. If historical status is unavailable or unknown, it emits no automatic historical Ruby. It must not substitute `displayReading`, a consensus reading, a JMdict priority preference, or the modern surface.

Modern profiles may use `displayReading` according to #244, but that path remains visibly modern and cannot populate historical fields.

The expected distinctions are:

- `学校` can retain `學校《がくかう》` from its positive historical relation.
- Before #268 evidence is available, `必要` has no historical Ruby; after positive reconstruction, it can expose `ひつえう` with a productive basis and provenance.
- `必ずしも`, `東南アジア`, and `好む` have no automatic historical Ruby when their historical state is unavailable.
- `男女` may display a preferred modern reading in a modern context, but lexical ambiguity and historical unavailability remain semantic facts.

## Safe factorization

For canonical implicit output, factor only a contiguous Han-containing lexical unit when the historical reading has complete authority:

1. find the longest identical kana prefix and suffix shared by source reading and the safe modern surface mapping;
2. emit Ruby only for the remaining contiguous Han base;
3. require non-empty base and reading, complete component evidence, and no protected/author-Ruby boundary crossing;
4. otherwise fall back to whole-unit Ruby or no Ruby according to the mode.

Examples covered by regression tests are:

- `必ずしも -> 必《かなら》ずしも`;
- `東南アジア -> 東南《とうなん》アジア`;
- `好む -> 好《この》む`.

Arbitrary text segmentation, partial component evidence, and factorization across kana ambiguity fail closed. Whole-word lexical readings such as 熟字訓 remain whole-unit readings unless an explicit safe factorization rule applies.

## Serialization modes

Retain the existing five runtime modes: plain, whole explicit, whole implicit, component explicit, and component implicit. Explicit modes add the requested `｜`/brackets; implicit modes omit `｜` only when contiguous Han-only output is unambiguous. Changing mode may change punctuation and segmentation, but never the resolved historical reading, semantic state, authority, or provenance.

The browser UI may expose the implicit modes only after the worker and diagnostic contracts support them. UI exposure is not a substitute for runtime tests.

## Required RED cases

- historical no-evidence unit does not render modern `displayReading` as historical Ruby;
- modern profile still renders its modern lexical reading where authorized;
- historical positive identity and changed readings remain distinguishable;
- complete component evidence permits safe factorization, while incomplete evidence falls back without invented partial Ruby;
- explicit and implicit outputs preserve the same semantic unit metadata;
- `displayReading` priority and consensus are display-only.

## Non-goals

This phase does not add source data, resolve lexical ambiguity, define GUI certainty labels, or make the Rule Program runtime authoritative.
