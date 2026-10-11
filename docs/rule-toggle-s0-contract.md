# JO #313 — 大規模規則ON/OFFの実行契約（S0実験版）

状態: **契約PoC／本番未接続**。この文書は #312 と #313 の受入検証用であり、現行のRule Program・Pagesの挙動を変更しない。未決事項を実装済み機能と混同しない。

## 1. 参照した既存正本
- JO [#163](https://github.com/kinoko34077/japanese-orthography/issues/163): 区別を維持したRule Composition／period/profile projection。
- JO [#208](https://github.com/kinoko34077/japanese-orthography/issues/208): 同じRule IRを直接postings／条件付きVMへloweringし、generic authorityとKiNoTch profileを分離。
- TAR固定 [tree_schema.md](https://github.com/kinoko34077/txt-auto-replace/blob/198f8560613d23417cb0f87172ae8662e722ca30/docs/tree_schema.md): roots→children→entries、親子enabled、root order、rule priority。v3は構造を保持。
- TAR固定 `transform-settings (8).json`: `runtime_settings.globalEnabled`、root/children/rulesの `enabled`、各entryの `id` を確認。
- TAR固定 `transform-engine.js`: `extractBundleRules` は無効の親子・entryを除外、`compareRuleOrder` はpriority降順とstable compiled order、`resolveCrossStageExactRuleConflicts` は競合の最上位を選択、`compileRuntimePlan` はrevision/planVersionでcacheを分離。
- JO `tools/rule-ir.ts`・`tools/rule-program-compiler.ts`: `IRRule.ruleId`／canonicalIds／profile enabledByを保持。**ProgramIdは配列indexであり、永続設定IDではない**。

## 2. S0の契約（採用候補／本番未適用）

| 属性 | 論理上の契約 |
|---|---|
| 全体ON/OFF | `globalEnabled` がfalseならいかなるentryも適用しない |
| 階層ON/OFF | 有効性はrootから最深group、entryまでのAND。親OFFは子ONに優先 |
| プロファイル | source/profileで許可されない規則をユーザーONで拡張不可 |
| source無効 | 明示的DISABLED28等の固定失効ルールはユーザーONで有効化不可。一般の可変enabled既定falseとは別区分 |
| 個別ルール | 永続キーは論理Rule ID。ProgramId、dense slot、sourceCaseを相互混同しない |
| 重複の統合 | 異なる論理ルールが同一Program／出力へ集約されても個別にOFF可。候補と由来を紐付けたまま判定する |
| 優先順位 | stage依存・bundle順・priority・tie順を保存。規則がOFFなら競合候補の選択をやり直す |
| 設定改訂 | 設定改訂に加えて正規化した有効overrideの完全表現をcache keyに含め、独立インスタンスや分岐が同一revisionでも旧候補・token・Plan・出力を再利用しない |
| 不正設定 | 未知ID／重複ID／欠落親／親循環などはfail-closed。削除・改称された旧IDには明示移行表を要求 |

### IDの対応モデル（実装前に監査必須）
```text
TAR origin+source snapshot+stable entry identity ─┐
                                                    ├─ durable logical Rule ID ─┐
JO graph canonical rule/fact identities ────────────┘                           │
                                                                                ├─ eligibility mask at occurrence/branch
sourceCase ID / source references ─────────────── evidence / test witness        │
                                                                                │
Rule IR ── compiler ── ProgramId / posting / VM ── input candidate + origin tags ┘
```

`programId` は現行compilerにおいてindexのため、再コンパイルで変化し得る。TARのentry IDにも、同一source内の重複ID・曖昧な入出力・別ツリーの同一IDが無いか監査が必要。現段階では**正規化アルゴリズムや永続化移行仕様を未採用**。PoCは正本から与えられた論理IDを検証するのみ。

## 3. PoCの範囲と現行との差分
`tools/rule-toggle-overlay-poc.ts` はpureなsettings mask/候補整列で、productionからimportしない。反例は `test/rule-toggle-overlay-poc.test.ts` に固定する。

- 親OFF／child ON、immutable source OFF、profile deny。
- 同一ProgramIdに由来する別の論理Ruleを別々にOFF。
- 上位候補OFF時の下位候補復活。元候補を破棄した後に後掛けmaskする方式は禁止。PoCの`select`は**有効候補を整列して返すのみ**で、同一occurrenceの最終勝者決定・多段競合解決は未接続。
- stable logical IDによるProgramIdの付け替え耐性、未知ID拒否。
- 設定内容の正規化＋改訂番号によるcache partition。同revision・別初期設定、同親からの異なる分岐での衝突拒否。

**非実装**: 個別entryへの実際の原典source-case mapping、現行Rule VMへのmask投入、TAR stageを含む多段再変換、連鎖依存、profile UI・永続保存、全19.5万Programへのzero-copy bitset、公開Pages。これらはS2/S3/S4の設計検証とCIを経て個別PRとする。

## 4. S1への測定引継ぎ
同一pack／同一入力／同一設定改訂でdirect・bytecode・条件scanを分離して測る。規則toggle直後のplan invalidation、program数増加、全文解析の追加コストは実装後の比較系列として別計測。段階ロード・gzipサイズを全resident memoryや全配布サイズと混同しない。

## 5. 未決事項と採用判断
1. TAR tree entry IDの重複、手動変更、旧スキーマからの移行規約（データ全件監査が先）。
2. 現在のCompilerで集約済みProgramと各原典ruleのoccurrence identityを、どのevidence fieldで永続対応させるか。
3. stage間・同一stage内の依存順、wildcard/regex/sequence/候補/保護ルビ時のfallthrough semantics。
4. TOML/JSON等の設定表現・コンパクトmask方式と、設定のロールバック/未知ID監査。
5. 次のランタイム試験で採用する曖昧性golden・DISABLED28 guard。

**S0の仕様テスト合格だけでS3を受入としない。** 正規CIと独立レビューを経て、採用判断は#313、性能判断は#314へ記録する。

## 独立レビューB1修正
PR #315の初回静的レビューで、初期設定や枝分かれした設定が同じrevision番号となり、`cacheKey`が衝突するB1が発見された。PoCでglobalEnabledとソート済みnode/rule overrideの完全なシリアライズを含めるよう修正した。最終tie-breakもlocaleCompareからUnicodeコードポイント比較へ変更し、priorityを整数へ限定。未知の`globalEnabled:null`は拒否し、反例を契約テストへ追加した。これらはS0 PoCの変更でありproduction適用は未実施。
