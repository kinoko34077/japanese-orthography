# Browser Rule Program cutover design (#229)

## Goal

Make the accepted BrowserPack v3 Rule Program runtime execute production transformations instead of running beside the legacy adapter only for audit tracing, while preserving a bounded parity fallback until acceptance.

## Runtime boundary

The worker will expose one transformation contract whose semantic result contains resolved units, spans, render metadata, diagnostics, and provenance. The legacy adapter and Rule Program VM must consume the same profile, protected-span, lexical, and source-backed inputs. The VM may use Sequence Pool IDs, Rule Program IDs, and compact indexes; source evidence remains cold-path data.

During migration:

1. legacy output remains available behind an explicit compatibility path;
2. the Rule Program output is compared against legacy output and semantic metadata on the acceptance corpus;
3. a parity gate requires matching transformed text, spans, unit boundaries, historical state, Ruby metadata, certainty, authority, and provenance class;
4. only after the gate passes does the worker select Rule Program output as production authority;
5. legacy removal is a later bounded change and is not bundled with the initial switch.

An audit trace from `traceText()` is not evidence of cutover. The test must prove that the worker response used the VM result as its output source.

## Pack requirements

The worker validates that the pack contains the required `sequence-pool`, `rule-programs`, indexes, and manifest/version metadata before enabling the VM. A missing or digest-mismatched section fails closed to the explicit compatibility path and reports a diagnostic; it does not silently claim the new runtime is active.

The pack digest and compiler version are carried in the acceptance evidence. No public pack regeneration or Pages publication is performed in this phase.

## Parity corpus and measurements

Run the real-text corpus from the umbrella design in plain, whole explicit/implicit Ruby, and component explicit/implicit Ruby where supported. Include protected spans, ASCII, emoji, unknown text, lexical ambiguity, source-backed literal historical facts, and productive Sino reconstruction.

Measure cold initialization separately from warm transforms, including hot section loading and index/Map construction. Record legacy-only, dual/parity, and VM-authoritative timings. The goal is to remove the production double execution while retaining enough bounded comparison to detect drift.

## Required RED cases

- worker output changes only when the selected runtime result changes, not merely when an audit trace is present;
- VM and legacy agree on the semantic corpus before authority switches;
- missing pack sections prevent VM admission and are observable;
- VM preserves certainty/provenance distinctions from the diagnostics phase;
- warm and cold timings are reported separately;
- all five runtime render modes remain selectable at the worker boundary.

## Non-goals

This phase does not alter canonical source data, broaden Sino applicability, change Ruby semantics, redesign the UI, deploy Pages, or delete the legacy path.
