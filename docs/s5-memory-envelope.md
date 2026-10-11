# S5-A #328 — 20 MBの実装可能性を判断する前のデータ容量会計

## 目的と計測
`tools/audit-runtime-memory-envelope.ts`で固定`data/browser-pack-v3/manifest.json`の全1,846 section（`sectionId`重複検査あり）と承認済`data/reports/browser-pack-v3-measurements.json`の種類・loading別合計値を照合する。Pack digestまたはcategory内訳の不一致は検証エラー。

```sh
node --import tsx tools/audit-runtime-memory-envelope.ts
node --import tsx --test test/audit-runtime-memory-envelope.test.ts
```

対象の**オンディスク未圧縮のバイナリ領域**は、全体187,597,926 B、セクション個別gzip合計73,238,827 B。後者は最終配信の転送量ではなく、全データが一度にブラウザに常駐する証拠でもない。

### 区分
- hot中核の7カテゴリ：`symbol-registry`、`sequence-pool`、`rule-programs`、`rule-program-index`、`rule-predicates`、`rule-lexeme-sets`、`rule-runtime-meta`。**16,494,276 B**（純粋なbinary payload）。
- 別の`eager`全sectionとの集合和では、重複したsectionを二重計上しない。**この集合和でもlexeme・reading・surface index・contextual Data全部は含まない**。
- 語彙・読み・表層index・形態素・字音componentの7カテゴリを別途会計。これらを巨大dataの単なるlazinessで無くした扱いにしない。
- evidence-map・program-evidence・detail-shardは出典追跡に必須な一方、各本文変換で全行を同時保持する必要があるかは別検証。能力保持と即時常駐を混同しない。

## 20MB目標の判定制限
このツールは現在のpackの**静的ファイル長**を照合するだけで、Runtimeの実メモリ測定値ではない。TypedArray.decode、JS object Map、V8文字列、候補/trace、Worker、GC等の実メモリは別に測る。オンディスク生の合計16MB台を「20MBの実行系完成」「20MBが物理的な下限」と断言しない。これまでのNode250字結果の末尾RSS約367〜374MBもNode/V8 overhead等を含むため、ルールデータだけに帰属させない。

次の測定単位は、同じdigestで `pack open`、hot Rule Program load、lexical prepare、最初のtransform、warm transform各段階の `heapUsed/arrayBuffers/external/RSS` 増分・可能なpeak・実端末上の通信量/容量を別観測すること。厳しい20MB制約では、静的データの分割・圧縮方式の比較とJS runtime object削減を分けて判断する。

この監査自体はread-onlyで、仕様、Pages公開、Rule VM出力に変更を加えない。
