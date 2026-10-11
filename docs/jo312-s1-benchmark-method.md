# JO #314 — S1固定入力ベンチの実行と評価

## 実行入口（本番ランタイム無変更）
```sh
node --import tsx tools/bench-jo312-baseline.ts --lengths=1000,10000,50000,100000 --timeout-ms=15000 --heap-mb=512 --source=published
node --import tsx tools/bench-jo312-baseline.ts --lengths=1000,10000 --profile=historical --timeout-ms=15000 --source=published
# 生成済みdata/browser-pack-v3/*.binが手元に存在する場合のみオフライン比較
node --import tsx tools/bench-jo312-baseline.ts --lengths=1000 --source=local
```

- **本文はプログラム内で生成した反復合成日本語文**。Wikipedia等の実記事・権利許諾実文を代表する測定ではない。入力はlength、SHA-256、profileで固定し、`cold`／同文`warm-repeat`／別文`warm-new-text` を区別。
- 実際の `runtime/browser-transform-worker.js` と `data/browser-pack-v3/manifest.json` を使う。デフォルトの `published` はHTTP公開Pack（manifestのdigestをrepositoryのmanifestと照合）をsection providerとして使用する。`local` は生成済みbinary sectionのある作業環境専用。通常のshallow cloneにはmanifestしかなく、`local` はENOENTとなる点を明示する。
- 子プロセスを長さごとに隔離し、`--timeout-ms`超過で強制終了・`status=timeout`。続く小／大ケースを破棄せず別行に記録する。デフォルト15秒は初期安全上限で**速度合格閾値ではない**。
- `--heap-mb` はV8 old-space上限。プロセス全体RSS／OS物理RAMの厳密上限ではないため、システム低メモリ時には手動停止する。
- `published` の通信・CDNキャッシュ・回線状況は計測に含まれる。HTTPセクションの取得byte数はデコード済みbodyで、gzip圧縮のwire byteではない。`local`はファイル読込で条件が異なり、両者のwallを同じ環境の直接比較値として扱わない。
- `process.memoryUsage` は「呼出し前後」の観測であり、peakメモリでもブラウザ実測でもない。`reportedElapsedMs` はWorker返答値、`wallMs`はprocess側計測。NULLは未計測値として保持。
- 自動処理は一ケースにつき一観測なのでmedian/p95を報告しない。正式ベースラインでは反復回数・端末OS/CPU/RAM・Node versionと端末性能を固定し、複数回実行の分布を別記録。
- 現在報告値（BrowserPack全187.6MB／gzip73.2MB）は既存レポート `data/reports/browser-pack-v3-measurements.json` の全セクション合計。通常使用時のresident RAMやChrome JS heapと同じではない。

## 指標と欠落境界
このCLIで測れる: Worker RPC相当のhandle呼出し時間、返答出力、取得セクションのデコード済み生byte、プロセスJS heap/arrayBuffers/RSS時点、同一serviceのwarm挙動。

このCLIでは測れない: DOM描画、ネットワーク往復時間、実ブラウザWorkerメモリピーク、UIの初期可視部分、実Wikipediaテキストの多様性・許諾、プロファイラによるfunction単位のhotspot。これらは後続ブラウザ実測に分離する。

## 次段階の受入
1. GitHub CIのテスト・型チェック・静的生成物検証成功。
2. 固定commit/同一環境で初期small caseを実行して結果を #314に記録。大ケースはtimeoutを正規結果として記録し、失敗を隠蔽しない。
3. そこからネットワーク／lexical／Program／競合解決の時間を区分するプロファイラ改修案を採点。仮説だけでTrie/FST/WASM等の方式を採用しない。
4. ベンチ専用PoCの統合は独立Reviewの合格後。Pagesの新たな公開操作は行わない。

## 初回実査で確認した環境差
最初のcloneで`--source=local`方式を試したところ`symbol-registry.bin`が無く、変換開始前にENOENTとなった。これは速度測定の失敗でなく、生成済みセクションがGit管理外であるという測定準備の制約。この失敗を#314に記録し、再現可能な配信済みPackのdigestを照合する`published`方式へ拡張した。
