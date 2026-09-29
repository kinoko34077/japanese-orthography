# End-to-End Orthography Resolution Vertical Slice — Design

Status: Draft for review
Owner Issue: #19
Parent objective: #1
Related owners: #2 contextual kanji, #3 external data/provenance, #4 shared-core/consumer boundary, #5 completed lexical-analysis/runtime research

## 1. Purpose

`japanese-orthography` is not intended to be a sequence of unrelated string replacements. Its long-term purpose is to identify the lexical and orthographic properties of relevant words or subunits, resolve the historical/alternate forms that apply, and render those results accurately while remaining practical in browser and Worker-class runtimes.

The resolver therefore needs to recover or accept, as applicable:

- lexical identity;
- modern reading and its evidence source;
- lexical origin / 語種;
- reading class and component-level lexical readings where required;
- morphology;
- native historical kana or 字音仮名 route;
- contextual kanji / merged-character restoration;
- deterministic safe old-character / variant rendering;
- preserve / override / candidate / unresolved states;
- provenance/evidence references.

The same semantic result should then support plain-text and Ruby serialization without forcing presentation syntax to define the analysis granularity.

The first implementation must prove this architecture vertically on a small representative corpus before broad data expansion.

## 2. Core design principle: analysis first, rendering late

The accepted pipeline is:

```text
input syntax
  -> syntax/Ruby evidence extraction
  -> lexical/span identification
  -> reading + lexical-origin + morphology resolution
  -> component/subspan resolution when required
  -> historical-kana route
  -> contextual-kanji resolution
  -> deterministic old-character/variant rendering
  -> semantic resolution result
  -> serializer
```

String mutation must not destroy lexical evidence needed by a later decision. Historical targets may be decided during analysis, but textual output is produced only after the semantic result is complete enough for the selected profile.

This keeps four concerns distinct:

1. evidence acquisition;
2. lexical/orthographic resolution;
3. historical target selection;
4. output serialization.

## 3. Required semantic anchors

### 3.1 `学校`

`学校` is the main first-slice acceptance anchor.

Starting from plain modern input:

```text
学校
```

the system must be able to establish the information needed for the KiNoTch. historical-orthography workflow:

```text
lexeme = 学校
modern surface reading = がっこう
lexical origin = Sino-Japanese
component lexical readings:
  学 = がく
  校 = こう
```

The important requirement is that the surface reading `がっこう` is not treated as the only recoverable reading structure. The resolver must retain or recover the lexical/component identity needed by the 字音 route so that historical kana can be resolved as:

```text
学 / がく -> 學 / がく
校 / こう -> 校 / かう
```

and rendered equivalently to:

```text
學校《がくかう》
```

The architecture must not hard-code `学校`; the example exists to prove that surface phonology and component lexical readings can coexist in the result model.

### 3.2 `台風`

`台風` proves the separation between lexical/contextual restoration and generic character fallback.

Expected semantic outcome under the selected restoration data:

```text
台風 -> 颱風
```

This is not evidence for a global `台 -> 颱` character rule. The lexeme-specific relation determines the target. Other `台` lexemes may resolve to `臺`, `擡`, another candidate, or preserve `台` depending on evidence and policy.

### 3.3 ambiguous merged-character case

At least one `弁`-family case must prove that the resolver can preserve candidate/unresolved semantics instead of treating a compatibility-profile fallback such as `弁 -> 辨` as generic context-free truth.

### 3.4 native inflected word

At least one native-Japanese inflected form must prove that historical-kana resolution can use lemma/morphology rather than only a surface reading string.

## 4. Ruby semantics

### 4.1 Ruby is evidence, not a separate conversion pipeline

Ruby presence changes how reading evidence is acquired, not which historical-resolution stages exist.

Equivalent forms such as:

```text
学校
｜学校《がっこう》
学校《がっこう》
｜学《がく》校《こう》
学《がく》校《こう》
```

should converge on the same lexical/orthographic result when they identify the same lexeme and readings.

The principal difference is evidence provenance:

```text
Ruby present -> explicit reading evidence
Ruby absent  -> analyzer/dictionary/compiled lexical evidence
```

Ruby does not bypass lexical-origin resolution, historical-kana/字音 resolution, contextual-kanji restoration, deterministic old-character rendering, preserve rules, or ambiguity handling.

### 4.2 Analysis granularity and output granularity are independent

For `学校`, the semantic model may retain:

```text
word:
  学校 / がっこう
components:
  学 / がく
  校 / こう
historical:
  學 / がく
  校 / かう
```

That result may be serialized as whole-word Ruby:

```text
｜學校《がくかう》
```

or component Ruby:

```text
｜學《がく》校《かう》
```

and, where Narou-style parsing is unambiguous, compact forms may also be supported:

```text
學校《がくかう》
學《がく》校《かう》
```

The canonical serializer form is not fixed by the resolver contract. It is chosen only after round-trip/parser behavior is tested. Explicit `｜` remains available where precise target-range marking improves determinism.

### 4.3 Minimal first-slice syntax scope

The first slice only needs enough syntax support to test:

- explicit whole-word Ruby;
- implicit kanji-followed-by-Ruby form;
- explicit or implicit component Ruby;
- plain text;
- one protected/non-transform span.

Supporting every Narou/Aozora notation is out of scope for this slice.

## 5. Minimal semantic result contract

The design should expose only fields justified by the first-slice cases. Names below are illustrative.

```text
ResolvedOrthographyUnit {
  sourceSpan
  sourceSurface

  lexicalIdentity

  reading {
    modernSurface
    lexical?
    source
  }

  lexicalOrigin
  readingClass?
  morphology?

  components[]? {
    sourceSpan
    surface
    lexicalIdentity?
    lexicalReading?
    lexicalOrigin?
    readingClass?
  }

  historical {
    kana?
    contextualKanji?
    deterministicKanji?
    disposition
  }

  evidenceRefs[]
}
```

Required properties:

- source spans remain recoverable;
- explicit and inferred reading evidence are distinguishable;
- component/subspan information is optional but available where required;
- ambiguity is represented as data, not converted into a fabricated certainty;
- the result does not expose Kuromoji/UniDic/Sudachi-specific schema directly;
- renderer choices are not stored as semantic truth.

## 6. Component/subspan resolution

The first-slice contract must not assume:

```text
one tokenizer token = one historical orthography unit
```

A word-level token may require component-level lexical evidence for historical resolution. `学校` demonstrates this because a modern surface reading may contain phonological change while the historical 字音 route needs the lexical readings associated with its constituent kanji/morphemic units.

The first slice therefore requires one of the following equivalent capabilities:

- a compiled lexical artifact that directly exposes component/subspan identity/readings; or
- a deterministic relation from the resolved word identity to the component records needed by the orthography resolver.

The design must not commit to a specific tokenizer implementation merely to satisfy this requirement.

## 7. Data ownership by resolution dimension

The resolver composes evidence from distinct canonical owners rather than flattening all rules into one table.

### Lexical evidence

Use the completed #5 direction: a backend-neutral runtime contract backed by compact current-UniDic-derived lexical evidence or another compatible source. Do not restart generic tokenizer comparison unless this vertical slice exposes a concrete unresolved capability gap.

### Contextual kanji

#2 owns lexical/contextual restoration, preserve, override, candidate and safety semantics. `台風 -> 颱風` and ambiguous merged-character cases bind here.

### Safe deterministic character rendering

A generic safe-character pack remains separate from contextual restoration and from the KiNoTch. compatibility profile. The first slice may use the smallest safe relation required by its cases; it must not classify broad consumer compatibility mappings as generic safe truth.

### Historical kana / 字音

Native historical-kana and Sino-Japanese 字音 resolution remain distinct rule/data routes. They feed the same semantic result model but do not collapse into a single `modernKana -> oldKana` lookup.

### Profile overrides

Project-specific choices remain a profile/override layer and must not redefine generic evidence semantics.

## 8. First-slice acceptance corpus

The design and later implementation must include at least these semantic cases:

1. Plain `学校` resolves its lexeme, modern reading, Sino route, component readings, historical 字音 result and deterministic old-character result.
2. Whole-word Ruby `学校` resolves to the same semantic result as case 1 except reading-evidence provenance.
3. Component-Ruby `学校` resolves to the same historical semantic result.
4. Whole-word and component serializers can be generated from the same semantic result without re-analysis.
5. `台風` resolves to `颱風` lexically and does not establish a global `台 -> 颱` mapping.
6. A `弁`-family example demonstrates explicit candidate/preserve/contextual semantics.
7. A native inflected word demonstrates morphology-aware historical-kana resolution.
8. An unknown/ambiguous word remains typed as unresolved/candidate rather than receiving an invented answer.
9. A protected/non-transform syntax range survives analysis/rendering without corruption.

Golden tests should compare semantic results independently of presentation serialization wherever possible.

## 9. Correctness invariants

The first slice should enforce:

1. equivalent Ruby/plain inputs may differ in evidence source but not in resolved lexical/historical identity when the evidence is consistent;
2. contextual-kanji decisions occur before generic deterministic rendering can erase the distinction;
3. deterministic old-character rendering cannot override an explicit contextual target;
4. unresolved ambiguity is not silently converted by a generic fallback unless an explicit selected profile defines that fallback;
5. serializer selection cannot change lexical, reading, historical-kana or kanji-resolution fields;
6. component information must survive whole-word Ruby serialization;
7. source/provenance references remain recoverable from accepted decisions;
8. generated runtime sections must obey existing manifest/namespace/digest compatibility rules where they use artifact-local identifiers.

## 10. Performance design

`fast` and `lightweight` must be measured rather than asserted.

The first slice should establish a reproducible baseline using the already-completed compact lexical/runtime research, then record deltas caused by the resolver slice.

Minimum observables:

- bytes of canonical and generated runtime data added/touched by the slice;
- cold initialization wall-clock measurement under a fixed harness;
- retained memory after initialization;
- lookup/resolve latency over a fixed deterministic corpus;
- end-to-end transform throughput over representative text;
- number and size of unavoidable data copies during load;
- cache hit/miss behavior when a cache is part of the tested path.

No arbitrary production threshold is fixed in this design. The initial implementation plan should first preserve correctness and collect a reproducible baseline; optimization is justified only by measured bottlenecks against browser/Worker constraints.

## 11. Runtime and dependency boundary

The resolver must remain runtime-neutral at the semantic boundary.

The first implementation should not require:

- migration of `txt-auto-replace`;
- migration of `kinotch-api`;
- new HTTP/Cloudflare behavior;
- browser DOM/UI/storage changes;
- package publication;
- adoption of a full production tokenizer/dictionary dependency solely for this slice.

Existing shared runtime modules remain canonical. This slice may add resolver-specific modules/data/contracts but should not rewrite `transform-engine.js`, `transform-shared.js`, or `structured-dictionary.js` merely to modernize style or module format.

## 12. Proposed implementation boundary after design approval

The later implementation plan should be divided so that each stage is independently verifiable:

1. RED semantic fixtures for the representative corpus;
2. minimal semantic result types/contracts;
3. Ruby/plain evidence normalization sufficient for the fixtures;
4. lexical/component evidence adapter against a small deterministic fixture or accepted compiled artifact slice;
5. historical-kana/字音 resolution for the minimum cases;
6. contextual-kanji bridge for `台風` and one merged-character case;
7. deterministic safe-character render bridge for the minimum case;
8. serializer variants from the same semantic result;
9. performance/integrity harness and baseline;
10. full repository regression, deterministic build and artifact compatibility checks.

Each stage should add only the data required by the selected cases. Broad corpus import is a later expansion after the vertical slice proves the contract.

## 13. Non-goals

This design does not include:

- complete historical-Japanese lexical coverage;
- all Narou/Aozora syntax variants;
- public API/package/binary-format freeze;
- production dependency adoption;
- wholesale tokenizer/runtime replacement;
- consumer migration;
- release/deploy/publication;
- Cloudflare resource changes;
- credential or permission changes;
- unrelated ESM/TypeScript refactoring.

## 14. Review checklist

Before implementation planning, review this design against the following questions:

- Does `学校` prove recovery of component lexical readings rather than merely surface Ruby rewriting?
- Does `台風` remain lexical/contextual and avoid a global `台 -> 颱` rule?
- Can Ruby-present and Ruby-absent inputs converge on one semantic result?
- Can whole-word and component Ruby be rendered without re-analysis?
- Are native historical kana and 字音 distinct routes?
- Can ambiguity remain unresolved?
- Are #2/#3/#4/#5 responsibilities preserved?
- Does the first slice reuse accepted compact lexical/runtime findings rather than restart backend research?
- Are performance claims measurable?
- Is the slice small enough to implement and verify without broad corpus completion?

If all answers are yes, the next artifact is an implementation plan, not more broad architecture research.
