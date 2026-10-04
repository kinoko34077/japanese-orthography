# Semantic certainty / provenance設計 (#230/#244/#236)

## 目的

diagnosticsを「serializeされたspan数」ではなくsemantic factから導出する。

preferred display readingは有用なpresentation dataだが、lexical/historical certaintyではない。

## 独立semantic state

summarized unitとapplied spanは、少なくとも次を独立して保持する。

- `lexicalIdentity`: resolved / ambiguous / unknown
- `reading`: resolved / ambiguous / unknown
- `historical`: resolved / candidate / unavailable / unknown
- `displayReading`: optional value + source
- `provenance`: sourceRefs / canonicalIds / evidenceRefs / ProgramId等
- `outputArbitration`: applied / competed / blocked等

candidate IDs、allowed reading set、restriction、historical route/basis/evidenceを失わない。

`displayReading` sourceは少なくとも以下を区別する。

- lexical
- consensus
- JMdict priority
- explicit input

display valueの選択はlexical identity、reading certainty、historical stateを書き換えない。

## Certainty policy

certaintyは「その出力判断に必要なsemantic axis」が確定しているかで決める。

### historical Ruby

`unique`に必要:

- output spanがapplied
- competing output spanがない
- historical readingがresolved
- historical basisが有効
- 必要なprovenanceが存在

lexical identityがそのhistorical decisionの適用条件ならlexical identityもresolvedであることを要求する。

### lexeme-scoped transform

lexeme-specific / contextual ruleの適用には、そのruleが要求するlexical identity / context axisの確定を要求する。

### identity-independent deterministic transform

lexical identityに依存しないglobal deterministic character/form ruleは、lexical ambiguityが存在するだけで一律に非`unique`へ落とさない。

つまり、

```text
「lexical ambiguityがある」
!=
「全ての変換が非unique」
```

であり、operationごとのrequired semantic axisを検査する。

### display preference / consensus

複数lexeme・複数reading候補の中からdisplay policyだけで1表示値を選んだ場合、それをsemantic winnerへ昇格させない。

historical outputに必要なaxisが未解決なら`conditional`または`unresolved`とし、historical `unique`にはしない。

## Format invariance

plain / Ruby modeの変更だけでsemantic certaintyを昇格・降格させない。

no Rubyの場合もneutral diagnostic recordを保持し、

```text
historical: unavailable
```

等を説明できるようにする。

「spanが存在しない」を「lookup失敗」と同義にしない。

## Authority policy

authorityはexplicit semantic basis + provenanceから導出する。

- `literal_fact`: admitted literal whole-word/native exact fact
- `source_rule`: source-backed deterministic/productive ruleでsource/evidence referenceが存在
- `derived_rule`: accepted derived basisが明示
- `project_rule`: project-defined basisが明示
- `none`: authority/provenanceなし

例:

- `必要 -> ひつえう`のcomponent reconstructionはwhole-word literal factではない。
- `sourceRefs=[]`かつ`evidenceRefs=[]`のoutputをadapter fallbackだけで`source_rule`にしない。
- detail panelの表示とserialized provenanceを一致させる。

## Detail panel contract

adapterは同一resolved unitから以下を表示できる情報を渡す。

- modern reading
- historical reading/status
- lexical candidates
- display preferenceとそのsource
- historical basis
- authority
- sourceRefs
- canonicalIds
- evidenceRefs
- ProgramId / execution trace handle

UIはRuby stringの存在やspan candidate数だけからcertaintyを推定しない。

## Required RED cases

- historical unknown + modern display readingはhistorical `unique`にならず、historical authorityを持たない。
- `男女`はdisplayに`だんじょ`が選ばれても、複数lexical/readings candidateを保持し、historical `unique`にならない。
- source-backed productive reconstructionはbasisに応じた`source_rule`/`derived_rule`であり、whole-word `literal_fact`へ誤昇格しない。
- no-provenance outputは`authority: none`。
- plain/Ruby modeでrequired semantic axesの状態が同一。
- identity-independent deterministic ruleは無関係なlexical ambiguityだけで失敗しない。
- literal historical evidenceは引き続き`literal_fact`。
- display preference/consensusはsemantic winnerを作らない。

## 非対象

- source ingestion変更
- lexical winnerの新規選択
- evidence捏造
- canonical Ruby factorization algorithm変更
