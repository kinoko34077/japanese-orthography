# JO #349 S3-E2-P10b2a — 実VM生候補のインスタンス所有を区別

## 達成する最小境界

`runtime/browser-program-runtime.js`の`createBrowserProgramRuntime(pack,{traceEmissions:true})`に限り、既存VMが発行した枝を直接受けた、変形なし・単一Program・exact SequenceId経路の生候補だけをインスタンス内のprivate `WeakMap`へ登録する。登録対象は従来`candidate.emission`を付けていた候補と同じ範囲に限定する。

`ownsTracedEmission(candidate)`は登録した**同一object**、かつ登録時に保存した値と現在の全項目が一致する場合だけ`true`。値コピー、同値Packの別runtime、書換えた枝番号、登録されていない候補はfalse。標準`traceEmissions:false`経路は追加APIを持たず、候補内容・候補順・Worker応答は変更しない。登録が必要な内部opt-inだけ追加`WeakMap`を利用する。

## この限定受入では証明していないこと

この所有判定は**生成経路の局所的な同一参照判定**に過ぎない。内部runtimeを正しいPack bytesで生成したことや、正本TARのsidecar/IR/Program digestと生成中候補の意味が一致することは認証しない。`createBrowserProgramRuntime`自身は既存の任意Pack objectを入力可能なため、外部任意Pack／偽ProgramRuntimeを安全と扱うことは禁止する。関数を返すruntime objectの交換や`ownsTracedEmission`という名前の関数の偽装自体にも本機構は対応しない。

P10b2以降では、同一`openVerifiedTarHotPack`で検証されたPackインスタンスにruntime生成と内部候補所有判定を密閉し、固定TAR source/IR/Program identity＋実VM emission対応を内部サービスへ結ぶ。同一instance外・検証失敗時・未証明枝は無条件の既存候補保持とし、推測OFFを行わない。

本PRは本番Worker／設定UIと接続しない。真正producer完成や`runtimeOriginAuthenticated:true`の宣言をしない。実Pack A/B #343安全HOLD、RAM #346別owner、Pages公開なし。
