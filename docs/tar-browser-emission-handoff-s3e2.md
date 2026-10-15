# S3-E2-P5 — 実BrowserPackのVM発行枝を生候補へ限定伝搬

## 目的
S3-E2-P2はVMが発行した`(programId,branchOrdinal)`をopt-inで識別し、P3/P4は固定TAR123枝・正規IR・実ProgramおよびBrowserPack v3 manifestの意味的同一性を確認した。ただし`browser-program-runtime.js`はVMの発行位置を生候補に渡していない。候補調停より前の本番経路に必要な情報を、**明示診断モードのみ**で追加する。

## 限定仕様
`createBrowserProgramRuntime(pack, { traceEmissions: true })`を明示した場合にのみ、VMに`traceEmissions`を渡し、`run()`のedgeを診断できるようにする。

`transformText()`の生候補には、以下を**全て**満たす場合に限り`emission:{programId,branchOrdinal}`を付与する。

- 実Pack loaderがロードしたVM edgeに`emission`が存在し、その発行Programが単一の`edge.programs`と一致する。
- 検索が元のraw SequenceIdを使い、別のbasic_form・かな照合による`contextOnly`探索ではない。
- 実候補の出力がVMの出力文字列と同一であり、`adaptTarOutput`などによる値変更がない。
- 枝位置は非負の整数で、実際のVMから導出されている。

`pattern`は機構による動的出力なのでタグ付け対象外。複数ProgramのCALL、原典と値の不一致、未確認の経路について、発行枝位置から編集元を推定しない。

## 回帰・既定動作
既存`test/browser-program-runtime.test.ts`で、実`openBrowserPack`がdigest検証済みのsectionをロードしてVMを構築する経路に対し、直一致候補の2枝の位置、既定モードでの追加フィールド欠落、変換値・Program trace不変、活用／かな異表記における未証明tag不付与を確認する。

opt-inを指定しない現行Workerは従来動作のままであり、公開サイトの設定画面・利用者から`traceEmissions`を受け付けるAPIを追加しない。

## 未証明と今後の判断
この情報は**発行したVM枝位置**であって、それ自体が編集原典に対する証明済み`certifiedOrigin`ではない。安全な実用化には、同一Packのsource/IR/manifest/section bytesへの信頼境界、原典entryの安定した識別子との結合、plain/ruby両経路での局所候補調停前mask、sourceLock/profile/global/group/entry設定revisionとTARの全件回帰が残る。

独立の実Pack A/B #343安全ブロックを迂回せず、本工程を理由に通常のPagesへ機能を公開しない。メモリ20MB・実文長文の処理時間達成は別受入条件。
