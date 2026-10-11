# #325 — Rule Program raw prefix guard（限定実装）

## 目的と不変条件
S2の2文字prefix候補比較 #321 から、**既存のVM・候補列挙・文脈表記を完全に維持しつつ**不要な raw SequencePool.find のみ省略する。全文検索器への置換ではない。

## 実装
- `runtime/sequence-pool-runtime.js` に `createIndexPrefixGuard(indexedSequenceIds,symbolsOf)` を追加。digest検証済み `rule-program-index` の SequenceIdに存在する1文字キーと2文字以上の先頭2 SymbolIdを `Set` / `Map<SymbolId,Set<SymbolId>>` に格納する。数字の乗算圧縮はせず、IDの桁数による衝突を防ぐ。
- `runtime/browser-program-runtime.js` で既存 `indexSection` の全入力IDから一度ガードを構築。各spanで登録可能なraw prefixがない場合に限り `pool.find(tokens.slice(...))` を省略する。
- 未登録 Symbol（symbolizerが数値を返せない位置）はprefix累積和で判定し、元の `every(typeof number)` と同じspanをスキップする。
- 元から存在する `basic_form`、`toHiragana`、`toKatakana` は**raw一致しなかった場合にも**引き続き計算し、旧 `contextOnly`/profile predicate/Stage/Program/trace/priorityをすべて通す。空Sequenceは常に旧判定へ戻す。

## 受入
- [ ] 不成立prefixを旧Program検索へ送らない単体試験と65536以上SymbolIdの安全性。
- [ ] 既存 `browser-program-runtime`／TAR4,008 pass + DISABLED28／profile・Ruby・先後文脈回帰、Ubuntu/Windows CI。
- [ ] 実Pack固定digestで旧／新 workerのsame SHA・候補・trace比較、cold/warm/RSS/heap。改善しない場合はrevert可能なPRを統合しない。
- [ ] 公開Pages再配信は別Human gate。pack manifest/生成物の変更なし。

この最適化で20MBやWikipedia長文の応答基準を達成したとは**主張しない**。独立検索PoC #322の2-symbolバケットをそのまま移植したものでもない。
