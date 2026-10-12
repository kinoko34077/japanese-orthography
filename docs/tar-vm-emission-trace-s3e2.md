# JO #349 S3-E2-P2 — VM発行枝位置のopt-in追跡

## 対象
前工程E2-P0では正規IRの123枝とコンパイル済みdirect/EMITを照合し、P1では`VM.run`を使って固定TARの63 Program・123枝を照合した。しかし実行edge自体は`programs`の経路しか保持せず、**同一Program内のどの出力枝が発行されたか**を明示していない。

## 最小追加仕様
`createRuleVM({…,traceEmissions:true})`または`createVM(programs, registry, {traceEmissions:true})`を内部検証側が明示した場合にのみ、VMの出力edgeに`emission:{programId,branchOrdinal}`を付ける。

- `programId`は実際に`direct`または`OP.EMIT`を発行したProgram。CALLがあれば呼出元ではなく**実際の発行先**を示す。既存`edge.programs`は変更しない。
- `branchOrdinal`は実際のdirect出力配列indexまたはそのProgram内の`OP.EMIT`の0始まり順番。実行時ProgramIdや序数は永続的な原典entry IDではない。
- デフォルトは`traceEmissions:false`。既存edgeの構造、値、優先度、候補フラグ、呼び出し順、性能・Packは変更しない（opt-inパスを本番Workerで起動しない）。
- 追加情報だけでは原典で認証した`editableEntryKeys`や`canonicalRuleId`にならない。原典source snapshot・IR digest・Pack digestとProgram枝の安全な結合は別途必要。

## 回帰
既存`test/rule-program-vm.test.ts`でdirect候補出力の各ordinal、profile bytecode EMIT、binding CALLによる実発行先、デフォルト無変更、出力と候補フラグ同一を検証。従来の固定TAR parityと全regrは正式CIに委ねる。

## 非対象と採否条件
本番`browser-program-runtime.js`・Workerの`certifiedOrigin`付与、ruby/plain全経路調停前mask、設定hierarchy/revision、BrowserPackデータ再生成、Pagesデプロイは対象外。将来のproduction opt-in採用時はPack identity証明・連続実行差分と容量/時間も別途受入する。安全に証明できない枝を暗黙に切替可能へ昇格させない。
