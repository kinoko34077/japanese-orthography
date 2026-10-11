# JO #349 S3-E1 — 由来証明済み候補の調停前mask実験（本番未接続）

## 動機
S3-E0は固定TARの120独立候補枝＋3共有出力枝について、正規IRと照合した123行／126編集entryを提供した。しかし現行Workerの`browser-program-runtime.js`が生成する候補に**編集原典の枝別証明は存在しない**。さらに`composeProgramSurfaceCandidates`は局所`planner.assemble`を先に実行し、後で複数Programの由来をunionする。したがってその後で単純なProgram ID maskをかけると、下位候補や共有出力の由来を失う。

## 実験の限定契約
`maskCertifiedCandidatesBeforeArbitration`は、**将来の信頼済みproducerが確実な`certifiedOrigin`を供給することを仮定した純関数**。現行ブラウザ・Workerはこのtagを供給しておらず、そのまま本番配線できない。

1. 固定`sourceCommit`と`irDigest`、一意な`programId+canonicalRuleId+input+output`を持つsidecarを要求する。
2. 編集元は全件に明示的な`eligibilityByEntry`（原典lock・profile deny・親OFFを交差済み）を要求し、未知設定を拒否する。上書き`enabledByEntry=true`は`eligibility=false`を解除できない。
3. 候補の`programIds`は一つであること、区間の元文字列・出力・段・方向・channelが認証済みtagと完全一致すること、枝に属する編集元配列の一致を要求する。形態素変形・複数Program合成・その他未証明は**元候補を消さず`unsupported`へ分類**する。
4. 証明済み編集元が全て無効なら、その候補を**最初の調停前**に除外する。複数編集元が同一出力枝を共有する時はOR。単一出力枝だけを落とし、別枝やProgram全体は落とさない。
5. `planner.assemble`の実関数を合成fixtureから呼び、`高優先OFF→下位候補が選択`、`共有出力は片側だけONでも生存`、`profile deny / sourceLockをユーザONでは解除できない`を検査する。

## 本番適用前に別途必要
- 現行VMの`edge.programs`とcompiler IR枝の信頼できるorigin tag付加経路。Producer tagはユーザ入力・未検証のProgramId推測から作らない。
- `composeProgramSurfaceCandidates`および`transformWithProgramRuby`の**局所assemble・同出力unionの前**にmaskを適用し、plain/ruby/parity/legacyと各profileで出力・診断を保つこと。
- 実証済みの`stage/direction/channel`権限。E0 sidecar自体にはこの完全なjoin証明がない。
- 固定snapshotから更新した場合のstable logical entry IDと移行、cache revisionを含む設定契約。
- 本番E2ではTAR fixture4,008 PASS・DISABLED28保持、値と診断の全経路回帰、両OS CI、実ブラウザ性能/RAM、ユーザ承認済み公開gate。

**今回の成果はS3-E1のread-only証明に限る。設定画面への公開、新しいPackやVMへのorigin追加を今回の成果としない。**
