# Phase 2D bounded deterministic safe-character slice

Owner: #40

This slice establishes one source-backed unconditional character-rendering boundary and deliberately does not promote the existing KiNoTch compatibility map into generic project safety authority.

## Accepted anchor

```text
学 -> 學
```

The mapping is admitted as a deterministic character-form relation, not as a lexical restoration rule.

Authority is split explicitly:

- Culture Agency official character-form evidence records `学(學)` among current/older form relations;
- project ruling #2 comment `5881690205` classifies `学 -> 學` as a deterministic-layer control outside contextual lexical corpus ownership;
- the accepted KiNoTch compatibility profile also contains `学: 學`, but its manifest says `genericSafety: not_implied`, so it is retained only as behavioral regression evidence.

## Runtime boundary

`SafeCharacterRuntime.createSafeCharacterRuntime(slice)` validates the bounded safe-character slice before exposing a frozen `characterMap` and `apply()` function.

Validation is fail-closed for:

- unsupported slice schema/kind;
- evidence records pointing to unknown source descriptors;
- mappings pointing to unknown evidence records;
- modern or historical mapping sides that are not exactly one Unicode code point;
- duplicate modern source characters;
- mappings whose modern character is explicitly excluded from unconditional safety.

The runtime is browser/Worker neutral and is injected into the existing `OrthographyResolver` through its existing `safeKanjiMap` boundary. It does not create a second rendering pipeline.

## Explicit negative controls

### 弁

`弁` is not admitted to the unconditional map. Project ruling #2 comment `5881995193` records that modern `弁` merges multiple historically distinct targets and retains original uses, so lexical/sense evidence is required.

### 台

`台` is not admitted to the unconditional map. Project ruling #2 comment `5882033932` establishes a base `台(臺)` relation but also documents contextual overrides and preserves such as `台風 -> 颱風`, `台頭 -> 擡頭`, and original/Tendai `台` uses. Any future `台 -> 臺` fallback must therefore be guarded by a separate lexical/contextual safety contract.

These exclusions demonstrate that a historical character relation is not sufficient by itself to establish an unconditional reverse map.

## Composition with accepted Phase 2 paths

The new safe-character layer composes after accepted lexical/historical/contextual resolution.

For the accepted Phase 2B anchor:

```text
学校
  -> real lexical identity
  -> historical Sino reading がくかう
  -> deterministic 学 -> 學 rendering
  -> plain: 學校
  -> explicit whole Ruby: ｜學校《がくかう》
```

The safe-character slice itself does not change `台風`; contextual `台風 -> 颱風` remains owned by the Phase 2C relation/binding path.

## Data authority boundary

`data/profiles/kinotch/legacy-kanji.json` remains a compatibility profile. Its broader character map contains entries with different safety semantics, including contextual/merged families, and cannot be treated as a generic-safe corpus merely because the profile has historically emitted them.

Phase 2D therefore accepts exactly the bounded mapping whose generic safety is independently established and keeps compatibility-only behavior separate.

## Non-goals

- wholesale adoption of the KiNoTch legacy character map;
- broad shinjitai/kyujitai table import;
- IVS or compatibility-codepoint catalog expansion;
- guarded `台 -> 臺` fallback;
- contextual `弁` expansion;
- consumer integration;
- Phase 3 production resolver bundling;
- package/API stabilization;
- release, deploy or publication.
