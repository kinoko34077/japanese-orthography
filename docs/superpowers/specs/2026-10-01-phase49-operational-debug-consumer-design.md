# Phase 4.9 — Operational Debug Consumer and Diagnostic Visualization Design

Status: design specification for `kinoko34077/japanese-orthography#161`  
Date: 2026-10-01  
Baseline: `japanese-orthography@93998fab2ce39b95de1f17b1d599108c708bf14c`  
Existing consumer baseline: `txt-auto-replace@198f8560613d23417cb0f87172ae8662e722ca30`

## 1. Purpose

Phase 4.9 turns the accepted Phase-4.8 resolver into an operational debugging surface before Phase 5.

The goal is not to add another orthography authority. The goal is to expose what the existing resolver actually decided, why it decided it, and where it refused to decide, while exercising the resolver on practical text and real web pages.

The selected user requirements are:

- a localhost surface comparable to the practical verification loop used near the start of Phase 4/4.5;
- a source/result side-by-side converter suitable for ordinary manual use;
- a browser-extension path that transforms real page text;
- per-occurrence visual diagnostics:
  - no applicable transformation: no highlight;
  - uniquely and safely resolved transformation: green;
  - competing/ambiguous branches existed but explicit accepted precedence/context/profile policy selected a result: orange;
  - ambiguity/conflict/evidence failure remains unresolved: red;
- hover inspection for compact diagnostic information;
- click/pin inspection for full lexical, morphological, candidate, branch, provenance and downstream-decision detail.

Phase 4.9 is an operational/debug consumer phase. It does not redefine historical truth and it does not start the Phase-5 `kinotch-api` integration.

## 2. Repository and branch ownership

### 2.1 Canonical design and reusable diagnostic semantics

`japanese-orthography` owns:

- the diagnostic result contract;
- reusable diagnostic transform/runtime logic;
- the mapping from accepted Phase-4.8 resolver/arbitration state into diagnostic records;
- source/output offset normalization;
- the core localhost playground and diagnostic viewer;
- diagnostic contract tests.

This keeps the latest accepted resolver and its diagnostic interpretation in one repository and avoids making a stale consumer snapshot the development authority.

### 2.2 Existing consumer

`txt-auto-replace` owns only browser/consumer concerns:

- DOM text-run collection and restoration;
- MutationObserver integration;
- extension enable/disable and per-tab state;
- Chrome storage/background/content-script orchestration;
- page-range highlighting;
- hover/click UI attached to page ranges;
- composition of generic core diagnostics with KiNoTch profile and legacy fallback diagnostics.

During Phase-4.9 design, `txt-auto-replace/main` is untouched.

After the written design and implementation plan are accepted, any consumer implementation starts on a dedicated `txt-auto-replace` branch. That branch explicitly updates its source lock to an accepted `japanese-orthography` Phase-4.9 head; it does not silently follow upstream `main`.

### 2.3 Why the localhost surface lives upstream

The current accepted `txt-auto-replace` core snapshot still points to the old resolver baseline `21f4cb0...`, while accepted `japanese-orthography/main` is `93998fab...`.

Putting the first Phase-4.9 playground in `japanese-orthography` therefore gives a direct operational view of the current resolver without first changing consumer production behavior. The extension integration can then consume the reviewed diagnostic contract as a separate bounded unit.

## 3. Existing capabilities reused

Phase 4.9 reuses rather than replaces:

- Phase-4.8 typed lexical entities and JMdict evidence;
- lexical/morphological span DAG analysis;
- occurrence arbitration;
- accepted/blocked/unresolved productive-relation decisions;
- historical/native/Sino-Japanese authority and provenance;
- compact/hot runtime semantics;
- `real-text-evaluation-runtime` trace concepts;
- existing `txt-auto-replace` DOM run processing, dynamic-DOM observation, restore/reapply behavior, editable exclusions, Ruby handling and TransformEngine debug events.

Phase 4.9 must not fork a second resolver.

## 4. Diagnostic contract

### 4.1 Contract objective

Every diagnostic surface consumes one normalized result instead of inferring semantic state from whether the final string changed.

Conceptually:

```ts
interface DiagnosticTransformResult {
  sourceText: string;
  outputText: string;
  offsetUnit: 'utf16-code-unit';
  semanticMode: 'generic-core' | 'effective-consumer';
  segments: DiagnosticSegment[];
  summary: DiagnosticSummary;
  engine: DiagnosticEngineIdentity;
}
```

Browser-facing and cross-subsystem positions are normalized to UTF-16 code-unit offsets because DOM `Range` uses JavaScript string offsets. Internal algorithms may keep their existing indexing where appropriate, but diagnostic boundaries must be converted before leaving the owning runtime.

### 4.2 Segment

```ts
type DiagnosticEffect =
  | 'unchanged'
  | 'changed';

type DiagnosticCertainty =
  | 'none'
  | 'resolved_unique'
  | 'resolved_by_precedence'
  | 'unresolved'
  | 'error';

type DiagnosticAuthority =
  | 'generic_core'
  | 'project_profile'
  | 'legacy_fallback';

interface DiagnosticRange {
  start: number;
  end: number;
  text: string;
}

interface DiagnosticSegment {
  id: string;
  source: DiagnosticRange;
  output: DiagnosticRange;
  effect: DiagnosticEffect;
  certainty: DiagnosticCertainty;

  authorityChain: DiagnosticAuthorityStep[];
  decisionReasons: string[];

  lexical: DiagnosticLexicalEvidence | null;
  acceptedCandidates: DiagnosticCandidate[];
  blockedCandidates: DiagnosticCandidate[];
  unresolved: DiagnosticUnresolvedRegion | null;

  historical: DiagnosticHistoricalEvidence | null;
  evidenceRefs: string[];
}
```

Exact file/type naming may change during implementation only if semantic meaning remains identical and the design Issue is updated before implementation proceeds.

### 4.3 Authority chain

A final visible output can pass through several authorities. The contract must preserve them rather than collapse them into a single “rule”.

Example:

```text
source
 -> generic_core: unresolved / preserve
 -> project_profile: no decision
 -> legacy_fallback: changed
 -> final output
```

This final output is changed, but it is not semantically resolved by the generic core. A debug consumer must therefore be able to render it as red while still showing the actual fallback output.

Each authority step records at minimum:

```ts
interface DiagnosticAuthorityStep {
  authority: DiagnosticAuthority;
  before: string;
  after: string;
  effect: DiagnosticEffect;
  decision: string;
  reasonCodes: string[];
  ruleRefs: string[];
  evidenceRefs: string[];
}
```

## 5. Certainty semantics

### 5.1 `none`

No applicable transformation candidate or explicit diagnostic concern exists for the segment. Ordinary unchanged text uses this state.

An explicit preserve rule may also use no visual warning when preservation is intentional and fully resolved. The reason remains inspectable if a diagnostic record is requested.

### 5.2 `resolved_unique`

Exactly one semantically admissible result is established by accepted evidence/rules for the relevant occurrence.

Examples include a unique lexical/historical authority or a deterministic safe transformation after the required lexical/morphological gate succeeds.

### 5.3 `resolved_by_precedence`

Multiple live branches, competing spans, or policy choices existed, but an accepted deterministic rule resolved them.

This includes cases such as:

- same-start longest accepted while shorter live matches were shadowed;
- equivalent overlap branches produce the same semantic output;
- accepted context/domain evidence selects one candidate;
- an explicit KiNoTch profile choice selects among known generic candidates;
- another documented precedence rule selects one output without discarding the existence of competitors from diagnostics.

This state is not used merely because a pipeline has an execution order. There must have been a meaningful competing branch or candidate relevant to the occurrence.

### 5.4 `unresolved`

A meaningful candidate/decision exists but the accepted semantics intentionally refuse to select one result.

Representative reason codes already present in Phase 4.8 include:

- `ambiguous_lexical_boundary`;
- `ambiguous_lexical_identity`;
- `ambiguous_morphology`;
- `morphology_unavailable`;
- `morphology_unsupported`;
- `lexical_analysis_unavailable`;
- `conflicting_productive_outputs`;
- `unresolved_shifted_overlap`.

Unresolved remains unresolved even when later compatibility/profile/legacy logic emits a changed final string.

### 5.5 `error`

The intended diagnostic/semantic path could not be evaluated because a required runtime/artifact/parser failed.

Fail-closed behavior is preserved. Error is not silently treated as ordinary unchanged text.

## 6. Presentation mapping

Color is a consumer/UI concern, never generic semantic authority.

The default debug viewer maps certainty/effect to presentation as follows:

| Diagnostic state | Default presentation |
| --- | --- |
| `certainty=none` and no unresolved concern | no highlight |
| `resolved_unique` + changed | green |
| `resolved_by_precedence` + changed | orange |
| `unresolved` | red, whether output changed or stayed unchanged |
| `error` | red |
| resolved but unchanged identity/preserve | no highlight by default |

The viewer may expose icons/patterns in addition to color for accessibility, but the semantic status is always retained independently of CSS.

A changed string is never classified green solely because `sourceText !== outputText`.

## 7. Candidate and branch evidence

Diagnostic generation must expose enough information to answer:

1. what candidates existed;
2. which were admissible;
3. which were blocked;
4. why each blocked candidate lost;
5. whether all optimal lexical analyses agreed;
6. what morphology/context evidence was used;
7. which relation/source/provenance supplied historical authority;
8. whether downstream profile/legacy behavior changed the core result.

For occurrence arbitration, diagnostic projection uses the existing `accepted`, `blocked`, and `unresolved` result rather than rerunning an independent UI arbitration.

For lexical span analysis, the viewer must not enumerate an unbounded DAG merely for display. It may present summarized branch counts/support and lazily expand bounded relevant paths. The semantic result remains based on the accepted all-optimal-path logic, not on a truncated viewer enumeration.

## 8. Localhost operational playground

### 8.1 Location

The Phase-4.9 core playground belongs in `japanese-orthography`.

It must run locally without a remote `kinotch-api` dependency and must not transmit entered text externally.

### 8.2 Primary layout

The default desktop layout is a two-column source/result surface:

```text
+------------------------+-------------------------+
| Source                 | Result / diagnostic     |
| editable plain text    | rendered colored spans  |
|                        |                         |
+------------------------+-------------------------+
| summary / filters / selected-segment inspector   |
+--------------------------------------------------+
```

The source side remains an editable text input. The result side is a rich rendered preview because per-span styling is required.

The copy action copies the plain `outputText`, not diagnostic markup.

### 8.3 Interaction

Hover over a diagnostic segment shows a compact card containing:

- source -> output;
- certainty;
- selected authority;
- lemma/reading when available;
- primary reason;
- primary evidence/source reference.

Click pins the segment and opens the full inspector containing:

- lexical identity/candidates;
- morphology;
- span/boundary evidence;
- accepted candidates;
- blocked candidates and reason codes;
- unresolved regions;
- historical route;
- source/provenance references;
- authority chain;
- raw diagnostic object as a collapsible expert view.

### 8.4 Filters

The viewer provides filters for:

- all;
- changed;
- green / uniquely resolved;
- orange / precedence-resolved;
- red / unresolved or error.

Filtering is visual only and never changes transform semantics.

### 8.5 Core versus effective result

The upstream playground's required mode is `generic-core`.

An `effective-consumer` view is not simulated in upstream by copying consumer-local legacy/profile data into the generic repository.

After 4.9C exists, the consumer may reuse the viewer contract/rendering concepts to show its effective authority chain.

This prevents consumer-local policy from being imported into generic canonical data merely to make the playground look complete.

## 9. Browser-extension debug mode

### 9.1 Consumer isolation

Extension implementation begins only after this design and the implementation plan are accepted.

It occurs on a dedicated `txt-auto-replace` branch. Existing `main` remains the accepted consumer until the branch passes its own verification/review/merge gates.

### 9.2 Source-lock transition

The branch must source-lock an accepted `japanese-orthography` commit that includes the Phase-4.9 diagnostic runtime needed by the consumer.

The consumer must verify exact artifact/runtime identity and regeneration equality according to its existing source-lock pattern.

### 9.3 Opt-in debug state

Diagnostic visualization is opt-in and scoped per tab by default.

Normal extension mode must not retain large detailed diagnostic graphs for every transformed page unless required for normal semantics.

Debug mode enables:

- detailed transform diagnostics;
- page-range classification;
- highlighting;
- hover inspection;
- click-pinned detail;
- optional diagnostic export for a selected segment/page.

### 9.4 Highlighting strategy

The preferred implementation uses non-structural text ranges where supported, rather than wrapping every transformed word in new page elements.

Requirements:

- diagnostic state remains extension-managed state, not DOM state;
- the page DOM is not treated as the source of semantic truth;
- highlighting must not alter copied page text;
- highlighting must not interfere with restore/reapply;
- a feature-detected fallback may use a controlled overlay/decoration strategy, but must not silently mutate semantic page structure.

Tooltip/detail UI should be isolated from page CSS, for example through an extension-owned Shadow DOM container.

### 9.5 Dynamic content

Existing MutationObserver/run batching remains the source of page-change detection.

When a run is reprocessed:

- old diagnostic ranges for that run are invalidated;
- transform runs against the preserved original text according to accepted restore/reapply semantics;
- new output and diagnostic ranges are installed atomically for that run;
- stale hover/pinned references are either re-bound by stable diagnostic identity or visibly invalidated.

## 10. TransformEngine/profile/legacy diagnostics

The consumer's existing TransformEngine already emits events such as dictionary/token/fallback/stage-result events. Phase 4.9C must normalize these into the same authority-chain concept rather than invent a separate debug UI model.

For accurate source/output highlighting, consumer diagnostic events must provide or reconstruct stable input/output ranges. A stage-level before/after string alone is insufficient once earlier transformations change string length.

Legacy/profile diagnostics never become generic `japanese-orthography` authority. They remain attributed as `project_profile` or `legacy_fallback`.

If a legacy rule has multiple output candidates and selects one through a non-semantic deterministic mechanism such as hashing, the effective output may be shown, but the diagnostic certainty must not be promoted to `resolved_unique`.

## 11. Performance and loading

Debug mode is allowed to be heavier than normal conversion, but it must remain operational.

The design therefore requires:

- lazy initialization of detailed diagnostic assets where practical;
- per-tab opt-in for page diagnostics;
- no full-page reanalysis solely because the mouse moved;
- hover reads already-computed diagnostic records;
- mutation processing remains bounded to affected runs;
- measurements for initialization time, transform time and retained diagnostic memory on representative text/pages.

Performance numbers are acceptance evidence, not fixed design targets until measured.

## 12. Error and fail-closed behavior

Diagnostic failure must not fabricate certainty.

For the upstream playground:

- runtime/artifact failure leaves source text intact;
- status visibly reports the failure;
- affected diagnostic state is `error`.

For the extension branch:

- failure of the new generic diagnostic runtime must not silently corrupt page text;
- any retained legacy/profile fallback remains explicitly attributed;
- if fallback changes text after generic failure/unresolved state, the segment remains warning/error severity rather than green;
- restore remains available.

## 13. Real-world acceptance loop

4.9D uses the tool as an evidence collector, not as an automatic rule generator.

Practical testing records orange/red occurrences and classifies each finding as one of:

- expected ambiguity / intentionally fail-closed;
- missing lexical/morphological evidence;
- source/data gap;
- precedence/arbitration defect;
- consumer integration defect;
- project-profile decision needed;
- legacy behavior that should remain legacy;
- performance/UI defect.

A finding does not authorize a new orthography rule by itself. Semantic/data changes require a bounded owner Issue with appropriate source/provenance evidence.

Unpublished or private text may be tested locally but must not be committed as fixtures or copied into public GitHub Issues without explicit user direction. Public/synthetic minimized reproductions are preferred for durable regression tests.

## 14. Bounded implementation units

### 4.9A — reusable diagnostic contract and core runtime

Repository: `japanese-orthography`.

Deliver:

- diagnostic types/schema;
- projection from current resolver/span/arbitration state;
- UTF-16 external offset contract;
- transform result with diagnostic segments;
- unit/regression tests proving diagnostics do not change accepted transform semantics.

Acceptance:

- current Phase-4.8 outputs remain identical;
- accepted/blocked/unresolved reasons are represented without UI inference;
- unresolved cannot be mislabeled as unique;
- source/output ranges are exact on BMP and surrogate-pair fixtures;
- full `npm run check` remains green.

### 4.9B — upstream localhost playground

Repository: `japanese-orthography`.

Deliver:

- local static/dev server entry;
- side-by-side source/result UI;
- green/orange/red projection;
- hover summary;
- click-pinned inspector;
- copy-safe output;
- filters and summary;
- public/synthetic fixture set for unique, precedence-resolved and unresolved cases.

Acceptance:

- playground uses the same runtime as tests, not a mocked rule copy;
- no remote text upload/API dependency;
- displayed colors are derived from diagnostic contract;
- inspector evidence matches runtime result;
- input containing supplementary Unicode characters keeps highlights aligned.

### 4.9C — source-locked debug extension integration

Repository: `txt-auto-replace`, dedicated branch only until accepted.

Deliver:

- source-lock transition to accepted 4.9 upstream;
- debug-mode per-tab control;
- generic diagnostic integration with profile/legacy authority chain;
- non-structural range highlighting where supported;
- hover/click inspector;
- MutationObserver/restore/reapply compatibility;
- diagnostic-off path preserving normal extension behavior.

Acceptance:

- existing non-debug behavior remains regression-green;
- real page output is transformable and restorable;
- dynamically added text receives current diagnostics;
- editable exclusions remain unchanged unless explicitly selected later;
- core unresolved + legacy changed remains red and attributable;
- no DOM wrapper explosion or page-copy contamination;
- exact-head verification/review and post-merge verification are required before consumer `main` adoption.

### 4.9D — practical operational acceptance

Repositories: evidence owner in `japanese-orthography#161`; defects route to the repository that owns them.

Deliver:

- practical test corpus from public/synthetic text plus local-only private testing where desired;
- diagnostic counts/examples;
- bounded follow-on Issues for actual defects/gaps;
- final statement of which red/orange classes are intentional versus actionable.

Acceptance:

- the tool has been exercised as an actual user-facing converter and as a real-page extension;
- findings are dispositioned rather than silently patched;
- Phase 4.9 completion does not depend on eliminating every legitimate red ambiguity.

## 15. Verification strategy

Each implementation unit follows RED/GREEN where practical and records exact-head verification.

Required verification classes include:

- diagnostic classification unit tests;
- offset/range tests including surrogate pairs and length-changing transforms;
- parity tests proving diagnostic mode does not alter semantic output;
- localhost DOM/UI behavior tests;
- source-lock identity/regeneration tests for the consumer;
- extension DOM-run, dynamic mutation, restore/reapply and debug-off regressions;
- representative real-browser manual verification for range/highlight/hover behavior;
- full repository checks on Ubuntu and Windows where the owning repository's accepted CI requires them.

Formal review must state reviewer independence accurately.

## 16. Non-goals

Phase 4.9 does not:

- start Phase 5 or integrate `kinotch-api`;
- freeze a stable public package/API;
- release or publish the extension;
- bulk migrate Stage-60/profile rules;
- complete broader #46/#47 work;
- make legacy/profile rules generic merely because they produced useful practical output;
- replace accepted Phase-4.8 ambiguity semantics with a “best guess”;
- force all red cases to become green;
- store private/unpublished text as public diagnostics;
- change credentials, permissions or shared history;
- require RDC.

## 17. Rollback and safety

4.9A/B are additive upstream diagnostic surfaces. Removing the new diagnostic adapter/playground must leave the accepted Phase-4.8 semantic runtime unchanged.

4.9C is isolated on a consumer branch until accepted. Its rollback point is the current accepted `txt-auto-replace@198f856...`. The source-lock transition and debug UI must be removable without deleting the existing accepted restore/fallback path.

Debug metadata is observational. Failure to render diagnostics must never justify destructive text mutation.

## 18. Completion state and next phase

Phase 4.9 is complete only when 4.9A-D are accepted and the current repository/control/roadmap surfaces are reconciled.

Completion means the Phase-4.8 resolver can be practically operated and inspected through:

1. a current upstream localhost converter/debugger; and
2. a source-locked real-page browser extension debug path.

It does not automatically select Phase 5 or Phase 6.

After this design is approved, the next required artifact is a written implementation plan. No product implementation starts from design approval alone.
