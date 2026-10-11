# #331：TAR副詞条件とJMdict品詞証拠の安全な照合

本工程は #310 S310-B1、親 #312 の自然入力条件付き規則の前提監査。**本番Workerには一切接続しない**。

## 固定データ
- TAR `context-rules.json` 670件から、`conditions={current:{pos:'副詞'}}` だけを持ち、ruleType/sequence/matchOptions/matchTargetが無い224件を選別する。
- 選別後の入力表層は222種類。異なる2規則が同字面を持つ場合、出力が同じでも別原典として保持。特に`すぐ`は出力が複数あり、無条件にwinnerを決めない。
- JMdict固定extract `tools/jmdict-intake.ts` からreading一致を照合し、品詞カテゴリの集合がちょうど`adv`、同じ読みを持つ辞書エントリが1件、sense表記制約（stagk）が不明でない場合のみ「単一の語彙的副詞証拠」と分類する。
- この分類は、文中のその位置が単語境界であること、実際のlexical candidateが1件だけであること、前後語の品詞、原典の優先順等を証明しない。さらにUniDic `pos1=一般`をJMdictカテゴリから勝手に補完しない。

## 出力
`tools/audit-tar-adv-reading-evidence.ts`をNodeで直接実行すると、辞書根拠で一意／曖昧／未収に分けた件数、同字面異出力の件数、例と辞書source seqを出力する。
```sh
node --import tsx tools/audit-tar-adv-reading-evidence.ts
node --import tsx --test test/audit-tar-adv-reading-evidence.test.ts
```

この監査は「将来試験できる候補」を洗い出すだけで、TAR条件付き670件の自然文自動発火達成や#310 S310-Aの本番受入拡大を意味しない。辞書extractと実BrowserPackのlexical postingが1対1と証明されるかは別検証とする。

## 次工程
限定eligible候補について、実Workerの`candidatesFor`、より長い重なり、境界、文脈で原典POSが裏付くかを一件ずつ調べる。陽性例だけでなく語中部分一致、同音異義、profile漏出、未定義POSの負例を必ず含む。実装が成立した場合に限り別PRで接続し、CIと実ブラウザ受入を実施。Pages新公開は別Human gate。
