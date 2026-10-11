# JO #349 S3-E0 — 固定TARの原典entry→Program出力枝 sidecar（読取専用）

## 目的と非目標
TARの独立entryを同一Programへコンパイルした場合でも、**Program全体をOFFにせず出力枝を個別評価するための由来データ**を作る。根拠は受入済み#327の候補群枝照合（60群×2＝120枝）と#344のsame-output共有由来（3枝×2編集entry）。本PRは**本番Workerへの切替実装、利用者UI設定、永続設定ID設計を行わない**。

## 同じ定義に置き換えない識別子
- `sourceCaseId`: TAR移植の原典テスト適用ケース。利用者設定IDではない。
- `editableEntryKeys`: 固定snapshot `198f8560613d23417cb0f87172ae8662e722ca30` のentry識別子。構造化IDとflat locatorを混同せず、**snapshotを更新した際の移行・永続性は未証明**。
- `canonicalRuleId`: 正規化後のRule IR論理rule ID。原典編集entryの数とは独立。
- `programId`: Rule IRと同一Digestでコンパイルされた生成順index。再コンパイル後も同じIDとは限らない。
- `provenancePriority`: 原典監査で追跡した候補出力の優先値。共有出力は`null`であり、実行時の競合・適用順を上書きする権限はない。
- `output`: 一つのProgram内部の出力枝。共有出力の可編集原典2つはOR意味論、補助flatのevidence-only参照はON/OFF権限を持たない。

## 現段階の実データ受入境界
`auditTarBranchProvenance(root)` が原典・正規IR・rule-program-summaryの件数とDigest一致を検証した後、既存の`resolveCandidateGroupOrigins`全120件および`joinSharedOutputEditableOrigins`3件を、`projectTarOriginSidecar`で厳密に合成する。

期待値は合計**123個のProgram×output対応枝（63 Programに属する）**、候補側editable **120**、same-output側editable **6**、補助evidence-only **3**。強い編集元のないflat候補entryは固定snapshot下の位置依存キーとしてのみ保有。異snapshot、重複・不明キー、対応の曖昧性はfail-closed。

## 次段階 S3-E1の前提（未実装）
1. 生成時に`sourceCommit + irDigest + ProgramIndex`を一体で検証する。Packの再生成でProgramIdが変われば旧sidecarを拒否。
2. `(programId, input, output, stage, channel, direction)`と候補の真の由来の一致が証明された場合のみ適用できる。今回のsidecarが持つのは`programId/input/output`であり、同一出力の複数適用段・多段・文脈・正規化差を**自動結合しない**。
3. 候補を先に全件生成し、origin allow/deny・親group・profile・sourceLockedOffと利用者設定を交差してから既存調停に渡す。勝者の決定後だけにOFFを挟むことは禁止（次点候補の復帰が失われる）。
4. プロファイル・stage・条件・曖昧性・Ruby保護・TAR4,008 PASS／DISABLED28を回帰検証し、設定revisionをキャッシュキーへ反映する。
5. **全原典への一般化は未証明**。123枝のread-only sidecarを「TAR全ルールON/OFF実装済み」と見なさない。

## 検証方法
`node --import tsx --test test/tar-origin-sidecar-s3e0.test.ts` と正式`npm run check`。正規IR受入digest再生成を含むためCI実行時間・ピークRAMに注意。Ubuntu/Windows双方成功とセルフレビュー後のみread-only範囲を統合する。Pages公開は本PRでは不要（変換Workerに接続しない）。
