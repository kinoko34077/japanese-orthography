# Browser Rule Program cutover設計 (#229)

## 目的

BrowserPack v3のRule Program runtimeを、legacy adapterの横でaudit traceを作るだけの経路から、production transformationの実authorityへ切り替える。

parity受入まではbounded compatibility pathを保持する。

## 責務境界

### Worker / orchestration層が担当してよいもの

- request/response
- profile/render modeの受渡し
- pack/version/digest検証
- protected spanの境界管理
- inputの一回のsymbolization開始
- hot section/indexのロード・cache
- execution resultのassembly
- diagnostics/detailのlazy取得
- legacy/VM比較modeの明示的な切替

### Rule Program / hot runtimeがproduction authorityとして担当するもの

accepted #208 contractに従い、少なくともproduction transformの実行判断を次の経路へ置く。

```text
Unicode input
-> SymbolId/raw token
-> Sequence / index lookup
-> LexemeId / ProgramId postings
-> direct Program または VM
-> candidate / semantic result
-> output SequenceId
-> Unicode output
```

lexical/readings/context/profile/renderに必要なexecutable transformationを、legacy resolverが先に決めたoutputへ後付けする方式にしない。

### VM-authoritative modeで禁止するもの

- `adapter.transformWithResolver(...)`等のlegacy outputをproduction textのsourceとして使用する。
- legacy semantic winnerをVMへ渡し、VMが追認するだけでcutoverと称する。
- `traceText()`の成功だけをproduction cutoverの証拠にする。
- 同一inputを不要に全体再symbolize・全stage再scanしてauditする。

legacy codeをlibraryとして一部再利用する場合も、production semantic decisionをlegacy pathへ委譲していないことをテストで証明する。

## Migration mode

migration中は明示的に3 modeを区別する。

1. `legacy-only`: 既存比較用。
2. `parity`: legacyとRule Programを両方実行し、semantic/output差分を計測。
3. `vm-authoritative`: Rule Program resultだけをproduction response authorityとし、legacyはproduction output生成へ参加しない。

parity gateでは最低限以下を比較する。

- transformed text
- span / unit boundary
- lexical/readings state
- historical state
- Ruby metadata
- certainty
- authority
- provenance class/handle

gate通過後にのみ`vm-authoritative`を通常production pathへする。

legacy removalは別のbounded changeとし、本cutoverと同時に削除しない。

## Pack requirements

WorkerはVM admission前に、必要なhot sectionを検証する。

- Symbol Registry
- shared Sequence Pool
- Program table / code
- direct Program postings
- surface/reading indexes
- predicate/lexeme-set等のrequired tables
- manifest / compiler / ISA metadata
- digest整合

required section不足やdigest mismatch時:

- compatibility modeが明示的に有効ならlegacyへfail closedし、その事実をdiagnosticへ出す。
- vm-authoritativeを要求した状態では、silent legacy fallbackで「VM稼働中」と見せず明示errorにする。

public pack再生成・Pages公開は本Phaseに含めない。

## Hot-path条件

- input symbolizationは通常1回を基本とする。
- hot lookupの主要keyとしてUnicode full string再構成を要求しない。
- exact one-step ruleはdirect Program postingを使用できる。
- contextual/conditional/branching caseはVMへ残せる。
- source URL、長いtype名、verbose evidenceはhot pathへ重複保持しない。
- actual executed ProgramIdをtrace/provenanceへ残す。

## Parity corpus / measurement

umbrella designのreal-text corpusを、対応する5 render modeで検証する。

含めるもの:

- protected span
- ASCII
- emoji
- unknown text
- lexical ambiguity
- source-backed literal historical fact
- productive Sino reconstruction
- modern/historical display境界

measurementはcoldとwarmを分ける。

最低限:

- legacy-only
- parity/dual
- vm-authoritative
- transferred bytes
- request count
- hot section load
- index construction
- first-result time
- warm transform time
- JS heap / ArrayBufferが取得可能なら記録

現在productionで発生しているlegacy output + Rule Program auditの二重実行を、authority cutover後の通常pathから除去する。

## Required RED cases

- Worker responseが実際にVM resultをsourceとしていることを証明する。
- legacy resultを意図的に変えてもvm-authoritative outputが変わらないfixtureを用意し、legacy dependencyが残っていないことを検査する。
- VM/legacyがacceptance corpusでsemantic parityするまでauthority switchしない。
- required hot section不足はVM admissionを拒否し、状態が観測可能。
- VMがdiagnostics Phaseで確定したcertainty/provenance distinctionを保持する。
- cold/warm measurementを分離して出力する。
- 5 render modeをWorker boundaryで選択可能。
- authoritative pathで不要な`traceText()`二重実行を行わない。

## 非対象

- canonical source data変更
- Sino applicability拡張
- Ruby semantics変更
- UI redesign
- Pages deploy
- legacy path完全削除
