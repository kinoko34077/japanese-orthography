# Phase 2A bounded native historical-kana acceptance slice

Owner: #35

This slice proves one source-backed native historical-kana runtime boundary without broad dictionary import or a global phonetic reversal rule.

Accepted source pin:

- `okikae/kkh@19b24f88ab55809a186d88c465959548495b26a2`
- `kana-jisyo` blob `6a69cdc140994a0b8d5f6acb86d7b3b8c3ef20be`
- repository license recorded as BSD-2-Clause

Primary runtime/data anchor:

```text
思う / おもう
  -> UniDic-CWJ 2025.12 identity unidic-cwj:2025.12:lemma:5255
  -> lexical origin native
  -> morphology 五段-ワア行
  -> KKH `思う /思ふ ;ハ行四段`
  -> historical surface 思ふ
```

The relation is keyed by lexical identity, native origin and required morphology. It does not create a global `う -> ふ` rule.

The accepted UniDic slice exposes multiple morphology candidates for the surface `思う`. The resolver therefore remains conservative and returns candidates rather than collapsing them merely because they share a lemma and historical relation.

The same KKH pin contains both:

```text
味わおう /味はゝう ;ハ行四段「踊り字」
味わおう /味ははう ;ハ行四段「意志推量：おう」
```

Both are preserved as source records. This slice does not promote either one to an automatic runtime relation, so source ambiguity is not flattened into certainty.

Native historical relations may change the rendered surface while leaving `historical.kana` null when no independent historical reading evidence has been accepted. Ruby input remains modern reading evidence on the same resolver path; the runtime does not invent a historical Ruby reading solely to decorate output.

This slice does not authorize full `kana-jisyo` ingestion, broad native historical-kana coverage, Phase 2C/2D expansion, consumer integration, package/API stabilization, release, deploy or publication.
