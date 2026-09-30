# Phase 2C bounded real contextual binding slice

Owner: #38

This slice connects one already-canonical contextual-kanji relation to the accepted real UniDic lexical path without broadening the contextual corpus or adding a new runtime semantic layer.

## Accepted anchor

```text
台風 / たいふう
  -> UniDic-CWJ 2025.12 source lemma 21903
  -> source lexical namespace
     6aba6e8a20610ece73a028ed4dd9e64aefaaff3eec3f9a8bb56fd33c3bdfb144
  -> lexical identity unidic-cwj:2025.12:lemma:21903
  -> canonical constraint-taifu
  -> canonical rel-taifu
  -> 颱風
```

The relation remains owned by the existing canonical contextual pack. The Phase 2C binding slice does not duplicate `台風 -> 颱風` as a second corpus rule.

## Two namespace roles

The existing contextual compiler requires the project binding namespace `pmin-current`. The accepted UniDic source slice has its own source-qualified lexical namespace id.

These are intentionally not collapsed:

- `bindingNamespaceId = pmin-current` identifies the contextual pack's compilation/binding contract;
- `sourceLexicalNamespaceId = 6aba6e...` identifies the exact accepted UniDic source namespace from which the lexical identity is derived.

`createContextualCompilationBindings` validates the source namespace, dictionary/version, archive-member SHA-256, source lemma, surface, lexical origin and reading before producing the contextual compiler binding.

## Bounded overlay

Only `constraint-taifu` is real-bound in this slice. Other contextual constraints are not assigned fabricated UniDic identities merely to make the whole pack appear production-complete.

`overlayContextualCompilationBindings` can replace a previously supplied binding only when the binding namespace matches. It copies the base map instead of mutating it.

This allows tests to keep still-unproven fixture bindings outside the accepted anchor while proving that canonical `rel-taifu` compiles with:

```text
lexicalBindingIds = [unidic-cwj:2025.12:lemma:21903]
```

## Resolver behavior

The compiled canonical relation is consumed by the existing `OrthographyResolver`.

- matching real lexical identity -> contextual status `resolved`, surface `颱風`;
- wrong/non-covering identity -> no contextual target, original `台風` retained with review-safe disposition;
- no global `台 -> 颱` or `台 -> 臺` rule is introduced.

Existing candidate/preserve semantics remain owned by the canonical corpus and resolver. This slice does not select unresolved `合弁` targets, change `武弁` preservation, or expand `台頭`/`台密` into fabricated real bindings.

## Non-goals

- broad contextual-kanji corpus expansion;
- bulk UniDic binding of every contextual constraint;
- third-party contextual dataset import;
- Phase 2D safe-character expansion;
- production resolver bundle or stable public API;
- consumer integration;
- release, deploy or publication.
