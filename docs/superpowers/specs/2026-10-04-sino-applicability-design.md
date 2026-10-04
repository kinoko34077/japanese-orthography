# Positive 字音 applicability設計 (#268)

## 目的

既存の字音資料をruntime applicabilityへ正しく投影し、普通の漢語がsource-backed component reconstructionを利用できるようにする。

ただし、`lexicalOrigin=unknown`をSinoとみなす方式には戻さない。

## Sourceの役割分離

### `字音仮名遣い表.html`

以下のauthorityを担当する。

- 明示されたhistorical kana relation
- identity relation
- heading reading
- admitted / excluded等の既存disposition
- 「表にない音は現代仮名遣いと同じ」とするsource規則

### `仮名遣等資料/字音仮名_まとめ.xlsx`

主にreading-class evidenceを担当する。

- `呉音のみ`
- `呉音漢音共通`
- `漢音のみ`
- `慣用音等`

例:

```text
必 / ヒチ -> 呉音側
必 / ヒツ -> 漢音側
```

XLSXのclass情報だけからhistorical spellingを新規生成してはならない。historical kana valueはHTML等のadmitted relation、identity rule、または両資料を機械的にreconcileして得られる明示根拠から取得する。

## Source normalization

各admitted workbook cellを、少なくとも以下へ正規化する。

- canonical symbol / kanji identity
- modern component reading
- reading-class flag: `go`, `kan`, `go_kan`, `customary`
- source row/column identity
- canonical evidence reference
- admitted / ambiguous / excluded / unclassified disposition

identity-vs-changeは、HTML等のhistorical relation authorityとのreconciliation結果として保持する。

blank、malformed、excluded、unclassified cellをpositive runtime evidenceへ昇格させない。

reconciliationはsource row orderではなくcanonical symbol + normalized modern readingを基準にする。

compilerはadmitted / ambiguous / excluded / unclassified件数を出力し、予期しないunclassified recordのsilent dropをfailさせる。

## Component alignment contract

JMdict等から得られるwhole-word readingを、最初からcomponent readingへ分割済みだと仮定しない。

Han surfaceとselected modern whole readingに対し、次の手順でsource-backed alignmentを求める。

1. 各Han characterについて、admittedな`(character, modern component reading)` edgeだけを候補にする。
2. whole readingを先頭から末尾まで完全に消費するalignmentを列挙する。
3. non-Han部分が語内にある場合は、そのliteral reading/surface境界を既存lexical evidenceに従って固定し、Han component routeと混同しない。
4. source-backed alignmentが0件なら`unresolved / missing`。
5. 1件ならpositive component alignment。
6. 複数件ならstorage orderで選ばず`candidate / conflict`として保持する。
7. 既存runtimeに同等のsource-backed segmentation処理がある場合は再利用してよいが、この0/1/複数の意味契約を維持する。

単に「音読みらしいkana列へ分割できる」ことはpositive evidenceではない。

## Applicability predicate

Sino component reconstructionへ入れるのは、少なくとも次のいずれかが成立するcandidateだけとする。

1. candidate自身がadmittedなSino lexical-origin evidenceを持つ。
2. 上記alignment contractにより、必要なHan componentすべてについてsource-backed reading/class relationが一意に成立する。

`lexicalOrigin=unknown`単独では不許可。

missing / conflicting / incomplete component evidenceはSinoへ昇格させない。

### 代表例: 必要

```text
必要 / ひつよう

必 / ひつ
  -> XLSX: 漢音側のpositive evidence
  -> HTML/source規則: historical identityとして扱える

要 / よう
  -> HTML: よう -> えう

=> ひつえう
```

`必要`全体が17件のUniDic first-sliceへ存在することを要求しない。

## Runtime projection

reconciled evidenceをBrowserPackへcompactなID/flagとしてcompileする。

hot runtimeへ必要なのは例として以下。

- SymbolId / SequenceId
- modern-reading ID
- reading-class bit flags
- applicability/provenance handle
- failure reason: `missing` / `conflict` / `not-positive`

browserでXLSX本体をロードしたり、毎回full dictionary scanを行ったりしない。

projectionはpack manifest/version/digestの対象とする。

## Required RED cases

- `必要 / ひつよう -> ひつえう`がsource-backed component routeで成立する。
- `必 / ひつ`がXLSXの漢音reading-class evidenceとしてpositiveになる。
- `学/學 / がく`が「historical unknown」ではなくknown identityとして保持される。
- unknown originかつcomponent evidenceなしのcandidateはSino routeへ入らない。
- 呉音only / 漢音only / 共通 / 慣用等を無差別にmergeしない。
- modern readingが字音classを実質的に区別できる例を回帰に含める。
- HTMLとXLSXのconflictをsource orderで解決せずcandidate/conflictとして残す。
- alignment 0件 / 1件 / 複数件をそれぞれテストする。

## 非対象

- 新しい外部辞書sourceの追加
- broad JMdict再scan
- lexical sense winnerの選択
- Ruby serialization変更
- GUI label変更
- Worker cutover
- public BrowserPack再生成・Pages deploy
- future unknown-reading acquisition cache

## 検証

compiler-level reconciliation、runtime-pack lookup、adapter-level positive/negative testを追加する。

次Phaseへ進む前に、source accounting、focused test、pack projectionの差分をowning Issueへ記録する。
