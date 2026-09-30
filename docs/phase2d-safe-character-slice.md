# Phase 2D bounded safe-character slice

Owner: #40

This slice establishes one source-backed unconditional deterministic character-rendering relation without promoting the existing compatibility profile into generic safety authority.

## Accepted anchor

```text
学 -> 學
```

The mapping is admitted as a same-character historical-form relation in the deterministic character layer. It is not inferred from lexical context and does not duplicate contextual-kanji restoration.

Primary/admission evidence retained in `data/deterministic/safe-character-first-slice.json`:

- Culture Agency character-form evidence including `学(學)`;
- repository #2 ruling that `学 -> 學` is a bare deterministic control outside contextual corpus ownership.

The existing KiNoTch compatibility profile also renders `学 -> 學`, but its manifest explicitly says `genericSafety: not_implied`; that profile is therefore regression evidence only.

## Negative controls

The bounded unconditional map explicitly excludes:

- `弁`: modern `弁` merges multiple historical characters and requires lexical/sense restoration;
- `台`: a base `台(臺)` relation exists, but accepted contextual overrides/preserves such as `台風 -> 颱風`, `台頭 -> 擡頭`, and original-`台` classes require a guarded fallback contract.

Neither exclusion is evidence that the historical relation never exists. It means the relation is unsafe as an unconditional character substitution.

## Runtime contract

`runtime/safe-character-runtime.js` is browser/Worker-neutral and validates:

- slice schema/kind;
- source and evidence-reference closure;
- mapping and exclusion evidence-reference closure;
- one-code-point modern and historical mapping members;
- duplicate modern mapping sources;
- one-code-point exclusion records and exclusion provenance;
- overlap between excluded characters and unconditional mappings.

The runtime exposes a frozen `characterMap` and a code-point `apply` helper. Callers can copy the map without mutating runtime behavior.

## Resolver composition

The map is consumed through the existing `OrthographyResolver.safeKanjiMap`; Phase 2D adds no second rendering pipeline.

Accepted combined behavior:

```text
学校
  -> real lexical identity
  -> Phase 2B historical Sino relation がくかう
  -> deterministic safe rendering 学 -> 學
  -> 學校
  -> ｜學校《がくかう》
```

Contextual restoration remains ahead of deterministic fallback:

```text
台風
  -> real lexical identity
  -> canonical Phase 2C relation 台風 -> 颱風
  -> safe map contains no 台 entry
  -> 颱風
```

Thus Phase 2D does not turn `台風` into `臺風` and does not weaken Phase 2C lexical/contextual authority.

## Non-goals

- wholesale promotion of `data/profiles/kinotch/legacy-kanji.json`;
- broad Jōyō/shinjitai/kyujitai table import;
- IVS or compatibility-variant catalog expansion;
- guarded `台 -> 臺` fallback;
- contextual `弁` expansion;
- consumer integration;
- Phase 3 production bundle or stable public API;
- release, deploy or publication.
