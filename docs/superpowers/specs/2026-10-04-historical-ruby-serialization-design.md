# Historical Ruby authority / serialization設計 (#267/#223)

## 目的

historical semanticsとserializationを分離する。

historical Rubyはhistorical decisionからのみ生成し、modern `displayReading`をhistorical fallbackとして使用しない。

## Resolver contract

historical profileのunitは、少なくとも以下を独立して保持する。

- `reading.modernSurface`
- `displayReading`
- `historical.kana`
- `historical.route`
- `historical.basis`
- source/evidence/canonical IDs
- historical status: resolved / candidate / unavailable / unknown

`historical.basis`は例として次を区別する。

- `literal_whole_word`
- `native_exact_surface`
- `sino_component_reconstruction`
- `deterministic_identity`

historical profileでautomatic Rubyを出す場合、rendererはadmittedな`historical.kana`だけを使用する。

historical stateがunknown/unavailableならautomatic historical Rubyを出さない。

以下をhistorical fallbackに使用しない。

- `displayReading`
- lexical reading consensus
- JMdict priority preference
- modern lexical reading
- modern surface

modern profileは、そのprofileのdisplay policyに従ってmodern readingをRuby表示してよい。ただしhistorical fieldsへ書き戻さない。

## 期待する区別

- `学校`はpositive historical relationにより`學校《がくかう》`を出せる。
- #268前の`必要`にhistorical evidenceが無ければhistorical Rubyなし。
- #268によりpositive component reconstructionが成立した後は、`必要 / ひつよう -> ひつえう`をproductive basis/provenance付きで出せる。
- `必ずしも`、`東南アジア`、`好む`は、historical readingが未確定の状態ではautomatic historical Rubyを出さない。
- `男女`のmodern display preferenceはmodern表示にのみ利用でき、lexical ambiguityやhistorical unavailabilityを消さない。

## Safe Ruby range factorization

factorizationはhistorical readingの決定後、serializationの直前に行う。

入力:

```text
final rendered surface
selected historical Ruby reading
protected/author-Ruby boundary metadata
```

処理:

1. surfaceとreadingの先頭から、literalに同一なkana code point列を最長で求める。
2. surfaceとreadingの末尾から、prefixと重ならない範囲でliteralに同一なkana code point列を最長で求める。
3. 共通prefix/suffixをRuby targetの外へ出す。
4. 残るbaseとreadingを両方non-emptyに保つ。
5. 残るbaseが意図したHan targetを含むことを要求する。
6. protected span、explicit author Ruby、lexical boundaryを跨がない。
7. normalization、異体字同一視、発音推定等を使って一致を捏造しない。
8. 安全性を立証できなければ、より広いwhole-unit Rubyまたはno Rubyへfail closedする。

この処理は**whole-word historical readingが既に正当に確定していれば実行可能**であり、component reading evidenceを追加必須条件にはしない。

component evidenceはcomponent Ruby modeやsemantic reconstructionのauthorityには関係するが、literalなkana edge factorizationそのものとは別責務である。

### serializer regression例

以下は、各語についてadmittedなwhole historical readingが既に与えられているfixtureを前提とする。期待値を作るためにhistorical readingを新規捏造してはならない。

```text
必ずしも / かならずしも
-> 必《かなら》ずしも

東南アジア / とうなんアジア
-> 東南《とうなん》アジア

好む / このむ
-> 好《この》む
```

## `｜`のcanonical policy

factorization後のautomatic Ruby targetについて、

- targetがnon-empty
- contiguous
- Han-only
- 直後の`《...》`との対応が曖昧でない

ならcanonical user-facing outputはimplicit formを優先する。

例:

```text
學校《がくかう》
必《かなら》ずしも
```

次の場合はexplicit `｜`を保持できる。

- targetにnon-Hanを含む
- boundaryが曖昧
- protected/author syntaxが要求
- compatibility/debug explicit mode

## Serialization mode

runtimeの5 modeは維持する。

- `plain`
- `ruby-whole-explicit`
- `ruby-whole-implicit`
- `ruby-components-explicit`
- `ruby-components-implicit`

factorizationはautomatic whole-word serializationの前処理として適用し、その後explicit/implicit表現を決める。

mode変更で変えてよいのはRuby範囲・記号表現であり、historical reading、semantic state、authority、provenanceを変更しない。

## Required RED cases

- historical no-evidence unitがmodern `displayReading`をhistorical Rubyとして出さない。
- modern profileではauthorized modern lexical readingを表示できる。
- historical known-identicalとhistorical unknownを区別する。
- admitted whole historical readingだけでsafe literal factorizationできる。
- incomplete component evidenceからinvented partial Rubyを出さない。
- explicit/implicit modeでsemantic metadataが不変。
- `displayReading` priority/consensusはdisplay-only。
- author Ruby/protected boundaryを跨いでfactorizationしない。

## 非対象

- source data追加
- lexical ambiguity解消
- GUI certainty label定義
- Rule Program runtime authority切替
