# #321：SymbolId候補検索方式の独立比較

本資料は性能判断の実験手順。**現行productionのBrowserProgramRuntimeは変更しない**。

## 比較する同一規則集合
`data/browser-pack-v3`の固定manifestに基づく `sequence-pool`、`symbol-registry`、`rule-program-index` を読んで、既存の `SequenceId -> [(stage,direction,channel,ProgramIds)]` postingsを保持する。

- ベースライン：現行runtimeの `start×登録候補長` 走査と `pool.find(SymbolId[])` 二分探索。存在しないSequenceIdは捨てる。
- PoC①：同じ登録入力配列をprefix Trieに一度挿入し、同じ各`start`からprefixが切れたら探索を止める。
- PoC②：全件ノードを作らず、先頭Symbolだけで検索キーをバケット化し、同じキー列を直接照合。候補順が保持されるよう長さ昇順に整列。追加メモリは抑えられるが頻出先頭Symbolで遅く、初回PoCではbaselineに劣後した。
- PoC③：先頭2 Symbolの組合せ（ただし長さ1は単独Map）で検索キーを絞り、各バケットを長さ順に比較。多段Trieのオブジェクト増加を避けつつ候補を減らす。
- 完全一致判定：各候補の`(start,end,SequenceId,stage,direction,channel,ProgramIds順)`を比較し、候補数だけの一致では合格させない。重複Programや別channelを除去しない。
- 実験データ：固定種で実packに存在するSymbolId列を結合する合成シーケンス。**実記事・実日本語自然文や外部ブラウザ速度を代表しない**。


- **衝突ガード（追加検証）**：2文字ペアIDを `first * 2^26 + second` で構成し、各SymbolIdが2^26未満であることを実行時確認する。候補判定時は先頭2字も再照合する。65536境界で旧数式が衝突する反例を回帰テストに追加。合成文区切りIDも実キーの最大値+1で選ぶ。過去の先頭2字方式の実測は修正前コードによるもので、**修正版の本pack再測定までは採用数値を更新しない**。

## 実行
```sh
node --import tsx --test test/rule-search-index-lab.test.ts
node --max-old-space-size=1024 --import tsx tools/rule-search-index-lab.ts --lengths=250,1000,3000 --source=published
```
2行目は公開済BrowserPackのmanifestを取得し、ローカル正本manifestのpackDigestと、読込む3 sectionのSHA-256を厳密検査する。オフライン測定には`--source=local`を指定し、`data/browser-pack-v3`配下に対応するsection bodyが必要。最大10,000 SymbolId、4ケースまでの明示制限あり。CPU/メモリを抑制できない環境では別プロセスのwall上限付きで実行する。

## 解釈上の禁止
Trie方式のMap nodeはオブジェクト領域が増える可能性がある。初回の実Pack単発PoCでは181,488キー、35長さ、491,500Trieノード、構築時heapUsed差約108MB、RSS差約131MBだったため、20MB目標との不整合を検知した。2 Symbolバケットは別試行で先頭prefix10,123組＋単独776組、構築約105ms、メモリ増分約4.37MB（いずれもGC未正規化）を示した。250/1000/3000 Tokenの探索でbaseline比、概ね1.7/4.4/7.1倍高速化し、同じ候補順・Program一覧・digestを維持した。**この速度は候補検索単体であり、本文全変換やUIへ外挿しない**。生の`nodes`、索引build ms、`process.memoryUsage`前後、検索wall msは測るが、peak RSS・GC正規化・定常20MB達成は示さない。本文変換のtokenContext、basic_form、kana alternates、Ruby保護、lexeme判定、stage/priority/VMはPoC範囲外。これらを持つproduction runtimeの全出力が一致した証拠とはせず、採用前に別途端末・本文・profile・TAR fixtureの回帰試験を必須とする。

## 次の判定
1. 合成SymbolId候補の完全一致が成立すること。
2. 本pack規模でTrieの追加メモリ／構築時間を確認し、20MB目標に対して実用的かを評価。
3. 速度・容量両面で不利ならTrie採用を見送り、長さ別探索へのmicro最適化または候補優先のpartial indexなどに経路変更。
4. production接続・公開Pagesは本PoCから自動実行しない。
