# JO #349 S3-E2-P10b3c4 — Workerの明示opt-in読取診断

## 目的と本番既定動作

P10b3c2で独立SHAによる原典indexとPack/VMを同一閉包に構築し、P10b3c3で同一Pack・同一VMをWorker変換へ再利用できることを確認した。本工程は既存`attachToWorkerScope`へ明示`configure.tarOriginDiagnosticReadOnly === true`の場合だけ閉包を遅延結合する。UIクライアントがこのフラグを送らない**既定の経路は、従来のconfigure ACK、runtime import数、追加fetch、変換結果・候補を変えない**。

明示フラグがある場合、最初の`open`または`transform`で一回だけブラウザ互換`browser-tar-pack-lock.js`と`browser-tar-origin-closure.js`を`importScripts`する。manifest URLの直下の`tar-origin-index.json`をバイト取得し、受入済SHA256を独立固定した閉包で先に検証する。正規BrowserPackの必要実セクションのハッシュが成立した後、同じPack/VMインスタンスをWorker serviceへ返す。`trustedCandidateGate`はread-onlyで元候補を全件同順保持する。

## 保証と負例

`test/browser-worker-readonly-bootstrap.test.ts`：既定configureは旧ACKとimport/fetch 0、明示opt-in configure時点も同期ACKで遅延ロード、認証失敗は要求IDを保持したerror応答。

Ubuntuの非公開`build:site`後、`tools/verify-tar-worker-readonly-optin-site.ts`が生成物のmanifest/index/実Packセクションを用いて、同一Worker内のplain/ruby変換・manifest/index各1回・runtime module import一回を確認する。index改竄は**Pack section取得前**に拒否し、既定変換へサイレントfallbackしない。生成物内に必要なruntimeファイルが存在することも検証する。

本工程は**あくまで既存Workerのread-only内部診断**。公開済Pages実配信byte、全TARのroot/bundle/group/entry制御、sourceLockedOff、shared ORとpriority/revision、本番mask動作、RAM20MB達成を証明しない。明示opt-inフラグは原典個別ON/OFFのユーザ設定ではない。

## 保持する境界

`runtimeOriginAuthenticated:false`、実候補削除無し、デフォルトクライアントUI無変更、Pages deploy/release無し。#343実Pack性能A/B安全HOLD、#346 RAM別owner。CI両OSとUbuntu実PackE2Eを通過しても実配信Workerへの切替は別途受入。
