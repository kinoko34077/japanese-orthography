# JO #349 — S3-E2-P7 固定原典123枝の設定付き内部候補ゲート

## 成果の範囲
既存のP0〜P5は、固定TAR source PIN `198f8560613d23417cb0f87172ae8662e722ca30` に限り、原典編集entry126件を123出力枝／63 Programへ対応させ、コンパイラ、VM、実BrowserPackにおける発行位置の意味を照合した。P6ではplain/ruby双方の候補選択前に「元候補から除外するだけ」の内部ゲートを追加した。

本P7は両者の間で不足する「**固定原典の編集entryの有効条件に従い、生候補を除外できる計算**」をビルド内部の関数として定義する。

`createFixedTarOriginCandidateGate` は、信頼できるビルド入力である固定原典sidecar・正規IR・Program・受入BrowserPack v3 manifest・manifestから独立したPack digestを使い、既存P3/P4の監査を毎回通して閉包を構築する。設定revisionとsidecar全126編集entryのimmutable eligibilityを必須とし、ユーザーoverrideは既知entryのみ許す。

候補が `kinotch-fixed / profile / to-modern / surface`、単独Program実行、VM実発行位置、原文範囲と出力がすべて一致するときだけ、対応する編集entryのうち有効なものがあるかを判定する。共有出力はOR。sourceLock／profile制約／親子グループ制約などの不変の適用可否は**呼出前にeligibilityで交差済みであることが前提**で、override=trueでも復活させない。値変形・未証明枝・未知profile・CALL・証拠不足・別規則はそのまま保持する。

内部フィルタが返すものは候補の同一object参照と元順序の部分列だけ。P6の候補前ゲートへ接続できる関数形状に限定する。設定を変更する場合は新revisionの別ゲートを構築する。

## セキュリティ境界
`pack.packDigest`の一致だけで任意のJavaScript objectが真正なBrowserPackになったと主張できない。呼出し側は、既存`openBrowserPack`により実section bytesがmanifestのhashと一致すると確認したPackだけを渡さなければならない。元のsidecar、IR、Program、immutable eligibilityも信用できるビルド生成物から渡す必要がある。

このモジュールは`tools/`配下であり、既存Worker／公開サイトから呼ばず、生成済み設定メニューも提供しない。外部postMessageに`enabledByEntry`を受け付ける新仕様でもない。したがって今段階の成果は**内部での意味論・受入証拠**であり、実サイト上で利用者が規則を切替できることの証明ではない。

固定123枝以外のTAR有効4,008／意図的無効28、stable logical IDs、永続保存・版移行、root/group/entry設定UI、キャッシュrevision無効化、全profile、長文性能・RAM20MBの受入は別工程。実Pack A/B #343の安全ブロックは保持する。

## 検証
既存の全件TAR原典→IR→Program→VM統合テストを使い、実際のVM発行位置、編集原典の一件OFF、共有出力OR、原典権限falseの上書き不可、設定revision、未知設定と偽造枝の拒否、別profile・異Packの判定を検証する。今回、本番BrowserPackの再生成もPages再公開も行わない。
