# JO #344 — TAR共有Programの原典entry OR制御（S3-D、読取専用）

## 対象と根拠
親 #312、受入済み #313（階層toggle契約）・#327（枝別原典由来監査）に対する補完。固定TAR原典 `198f8560613d23417cb0f87172ae8662e722ca30` で、sourceCase 2件を同じProgram・同じ出力枝にまとめた **simple-exact 3関係** に限定する。#327で別途確定した60 candidate groupの120個の別出力枝を重複実装しない。

## 入出力の区別
- `sourceCaseId`: fixtureのテストケース識別子。永続設定キーにしない。
- `sourceKeys`: #327 `sourceEntryKey` による、**この固定原典snapshot内**での個別編集entry識別子。flat locatorは更新をまたいで安定する保証がない。
- `canonicalRuleId`: 正本規則の識別子。共有出力時に必ずしも個別TAR entryに一対一対応しない。
- `programId`: 生成物内の配列index。永続的なtoggle identityではない。

#327 の `simpleShared` は、それぞれ **2個のsourceCase**・**2個の異なるsourceKeys** が存在することを検証する。ただしsourceCaseとeditable entryの**各組の対応を追加立証したものではない**。このPoCはsourceCaseの位置からentryを推測しない。原典snapshot更新・ID移行の契約は将来の独立工程とする。

## 出力枝の生存条件
同じProgram・同じ出力枝を `B` とし、対応するsource entryを `e1,e2` とする。

`B.enabled = (eligible(e1) && userEnabled(e1)) || (eligible(e2) && userEnabled(e2))`

`eligible` は **利用者がONにできない条件すべての論理積**であり、profile allow/deny、原典固定DISABLED、source lock、global/bundle/group祖先の状態を、#313等の上位契約が計算して必須で渡す。本PoCがそれらを代わって計算・復元することはない。

- 2件とも有効→枝を1本選択、どちらか1件だけ有効→枝を1本選択、両方無効→枝を除外。
- 自動的なProgram全体OFFは禁止。他の独立origin/出力枝を巻き込まない。
- 未知entry、sourceKey欠損、同一枝の重複対応、eligible入力欠損はfail-closedで例外とする。
- override `null` は未設定への復帰であり、原典既定の可否を拡張しない。

## 今回の受入限界
`tools/tar-shared-output-or.ts` は共有枝の選択を示す **read-only PoC**。`test/tar-shared-output-or.test.ts` で、個別OFF／両OFF／policy deny・source lock相当の外部eligibility／未知ID／固定原典3関係を検証する。

実Worker/VMへのoverlay接続、安定ID移行、設定revisionによるcache無効化、priority/stageでの再競合、TAR 4,008ケースの自然文自動適用は、この変更では達成しない。TAR既定DISABLED28、配布Pack、本番Pagesは不変。
