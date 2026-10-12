# S3-E2-P3 — 実VM発行位置と監査済み原典枝の限定結合

## 目的
JO #312 / #349 の固定TAR snapshotで、E0の原典entry対応（120候補枝＋3共有出力枝）、P0の正規コンパイラ出力照合、P1の実VM実行照合、P2のopt-in `edge.emission={programId,branchOrdinal}` を、**同じ123枝だけ**に対し結合する。

## 実装
`createAuditedTarEmissionJoin(sidecar,ir,programs)` はまず既存の `auditTarCompiledEmissions` を再利用し、sourceCommit（固定PIN）・IR digest・実Program出力配列・index posting・stage/direction/channel・canonical枝・outputの一致を要求する。検証済みIRの枝配列位置を `branchOrdinal` として記録し、63 Program／123枝の一意性・123件の編集元集合を保持する。内部のMapは外へ公開しない。

`match({edge,input,stage,direction,channel,profileId})` は、opt-in実VMの単一Program trace・発行位置・実出力、入力文字列・profile・laneが一致する場合だけ `matched` を返す。それ以外は `unsupported` を返し、候補を削除しない。同一出力へ複数編集entryが合流する3枝は、複数`editableEntryKeys`を保ったまま扱う。

既存の正規TAR全件試験で、同じコンパイル済みProgramから実VMを発行し、固定123枝すべてについて結合を検証する。偽出力・入力改竄・未知枝番号・複合trace・不正profile・証拠なしの負例も拒否する。

## 未証明事項／安全境界
これは**ビルド・テスト内部の監査済みjoin**である。ランタイム`edge.emission`や受信したデータを外部が偽造できない保証は、呼出側のtrusted producerで別途必要。本関数への`sidecar`、`ir`、`programs`は信頼できるビルド入力とする。実BrowserPackの配信SHA/manifest/IRとの一致は未確認。未知のProgram、CALL複合、動的形態変換、pattern、別profileやstageは「未対応」のまま残す。

この結果だけで本番の`certifiedOrigin`、Workerのplain/ruby全経路調停前mask、階層設定・revision移行、全entry ON/OFFを実装したとみなさない。Worker/Pack/UI/Pagesへの配線・公開はこの段階では行わない。JS heap、配布容量、スマホ性能に関する受入も別ゲート。
