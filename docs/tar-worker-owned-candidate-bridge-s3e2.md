# JO #349 S3-E2-P10b3a — Worker内部ゲートのVM生候補所有照合（診断限定）

## 実装範囲

現行Workerの`createTransformService`は内部`trustedCandidateGate`指定時のみ同Packに対して`createBrowserProgramRuntime(pack,{traceEmissions:true})`を作成する。本工程は、既存`gateProgramObservation`がその**同一`hot`ランタイム**から得た候補をゲートへ渡す時に、`isOriginalVmCandidate(candidate)`の読取専用照合器だけを追加する。

照合は`hot.ownsTracedEmission(candidate) === true`を要求し、実VM由来候補の同一objectを区別する。通常plainは`composeProgramSurfaceCandidates`前、ruby直接入口はdedupe前。ruby内部へのplain候補再利用では既存`rawGateApplied`により二重適用を避ける。

`test/browser-worker-transform.test.ts`はplain/ruby双方で、同一VMランタイムが登録した原candidateはtrue、値コピーや偽originはfalseを確認する。ゲートは候補を削除せず、既定公開Workerの`trustedCandidateGate:null`を維持するのでユーザー出力や配信ファイルは変更しない。

## 認証できない境界

これは**runtimeインスタンス局所の参照識別を内部callbackへ渡しただけ**であり、同じインスタンスの生成元Packが独立ロックに一致したことや、固定TAR sidecar/IR/Programと安全に結合したことは証明しない。`createTransformService`はテスト等で`programRuntime`を任意注入できるため、モックランタイムの`ownsTracedEmission`を真としただけで本番の原典認証に昇格してはならない。

今後、Workerで独立Lock済みの配信Pack検証と固定sidecar/IRを同一閉包で生成・固定し、所有関数を任意注入できない実経路だけで候補の事前maskを許可する必要がある。未証明枝、Pack不一致、設定revision不一致はOFFしてはいけない。

`runtimeOriginAuthenticated:false`維持。TAR全entry設定/UI、Worker本番ON/OFF、Pages公開、実Pack A/B安全HOLDのPR #343、別ownerのRAM #346は変更しない。
