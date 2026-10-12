# S3-E2-P0 — 固定TARの原典枝と正規コンパイラのemit列との照合（読取専用）

## 目的
既受入のS3-E0は固定TARの候補120枝・共有3枝／編集entry126個を正規Rule IRの`Program ID + input + output`へ対応させた。一方S3-E1は、**信頼済みproducerから候補に`certifiedOrigin`が渡された場合に限る**調停前maskの実験であり、現行VMには当該情報がない。

本工程はその中間の欠落条件の一つ、**正規コンパイラが実際に発行するdirect postingsまたはbytecode EMITが、当該枝に対応しているか**を固定IR digestと同じsource上で検査する。実行時の認証済みorigin付与は未実装。

## 判定
- `auditTarOriginSidecar(root)`で固定原典、実IR digestと正本Program件数を確認する。
- 同じlive normalizationと`compileRuleIR`、`compilePrograms`から実行用Programを再生成し、`sourceCommit`、`irDigest`、Program index、IRのRule ID・input・branch canonical ID、プログラムevidenceを再照合する。
- 対象123枝に限り`origin=tar / profile / to-modern / surface`、Sequence Poolの実input posting、exact output SequenceId、branchのcandidate flagを確認する。
- direct programはoutput/flag配列の全順序、bytecodeはOP.EMITの全列がIRのbranchesと一対一一致することを要求する。CALL／MECH／PRESERVEの出力経路は**unsupportedで拒否**し、原典枝の対応を推測しない。
- 123枝以外のProgramや、ほかの実行stage/direction/channelを認証済みと呼ばない。

## 境界
これは**compile-timeの配列/bytecode内容のread-only audit**である。VMが実行した特定のedgeに枝のsource keyを付ける機構でも、Pack digestと公開サイトの実行時照合でもない。実行時の`edge.programs`はCALLや複数候補の経路・合成で枝IDを失い得る。また`adaptTarOutput`で値が変わる場合はliteral outputだけから逆引きできない。個別toggleを本番接続するには、これらを解決する信頼済みproducerメタデータと、**局所合成より前**のmask導入を別途証明する必要がある。

本工程によってTAR全件（有効4,008、意図的無効28）の個別ON/OFFを完成としない。VM/Worker/Pack/UI/Pagesも変更しない。実メモリ20MB・Wikipedia級長文体感性能についても証拠にならない。
