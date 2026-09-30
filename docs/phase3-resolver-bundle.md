# Phase 3 production resolver bundle acceptance slice

Owner: #43

Phase 3 packages the already-accepted Phase 1/2 evidence paths behind one atomic, production-shaped resolver activation contract. It does not expand corpus coverage and does not integrate consumers.

## Build-time artifact

`tools/resolver-bundle.ts` builds one JSON-serializable artifact from the accepted inputs:

- compiled UniDic lexical artifact;
- Phase 4.6D native historical-kana artifact (retaining the Phase 2A identity+morphology anchor);
- Phase 2B Sino-Japanese historical-reading slice;
- Phase 2C real-bound canonical `rel-taifu` contextual relation;
- Phase 2D safe-character slice.

The builder reuses the existing lexical compiler and contextual binding/compiler authorities. It does not copy contextual semantics into a second rule corpus.

The artifact declares the fixed first-slice capabilities:

```text
lexical
historical-native
historical-sino
contextual-kanji
safe-character
late-rendering
```

Each semantic section has a deterministic SHA-256 content identity. `bundleContentId` is derived from bundle semantics, lexical namespace, capability declaration and selected section identities. Local paths and timestamps are not bundle identity inputs.

## Atomic runtime activation

`runtime/resolver-bundle-runtime.js` activates the artifact only after validating the full-bundle contract.

Required checks include:

- supported bundle schema and semantics;
- complete capability declaration;
- all required section identities present and non-duplicated;
- lexical artifact identity matches the lexical section identity;
- Phase 4.6D native artifact and Phase 2B Sino slice lexical namespaces match the lexical artifact;
- Phase 2C source lexical namespace matches the lexical artifact;
- Phase 2C binding namespace remains the accepted `pmin-current` contract;
- contextual relations/safety sections are present;
- Phase 2D safe-character slice is accepted by its own runtime validator;
- all required runtime modules are available.

A missing or incompatible required section rejects activation. The runtime does not silently downgrade the same object to a partial “full bundle”.

## Composition

After validation the runtime constructs the accepted component runtimes and injects them into the existing `OrthographyResolver`:

```text
lexical lookup
  -> native identity+morphology / exact whole-surface resolution
  -> Sino historical router
  -> contextual relation resolution
  -> deterministic safe-character rendering
  -> existing late serializers
```

The historical router preserves the existing lexical-origin separation. A candidate cannot be silently accepted by both native and Sino routes; a route collision is an error.

## Accepted cross-layer results

```text
学校 -> 學校
学校 -> ｜學校《がくかう》
台風 -> 颱風
植え -> 植ゑ
挨拶 -> ｜挨拶《あいさつ》
アイゴ -> ｜アヰゴ《アヰゴ》
味わおう -> native surface candidates
藍 -> native reading candidates
今日 -> candidates
｜今日《きょう》 -> accepted きょう lexical identity
｜今日《こんにち》 -> accepted こんにち lexical identity
未知語 -> unresolved
protected input -> preserved without semantic transformation
```

Plain `思う` remains ambiguous in the accepted UniDic slice because multiple lexical candidates are not collapsed by exact-surface fallback. The original Phase-2A identity+morphology relation remains available for a uniquely identified compatible candidate, while Phase 4.6D adds source-complete exact-surface/reading authority and explicit candidate indexes for the selected pinned native-kana snapshots.

The same bundle runtime is exercised in browser-class and Worker-class VM sandboxes.

## Non-goals

Phase 3 does not:

- broaden lexical, Sino, contextual or character authority beyond their accepted scopes, or claim native coverage beyond the selected Phase-4.6D snapshots;
- claim full-corpus production coverage;
- change `txt-auto-replace`, `kinotch-api`, or another consumer;
- freeze a stable public package/API, binary format or distribution mechanism;
- publish generated artifacts;
- release or deploy anything.

Consumer integration remains Phase 4/5. Stable package/public API/distribution remains Phase 6.
