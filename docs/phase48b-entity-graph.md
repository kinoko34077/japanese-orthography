# Phase 4.8B — Typed lexical entity graph and shared reading-convergence DAG

Owner: #134 (parent #132). Code: `tools/lexical-entity-graph.ts`; tests: `test/phase48b-entity-graph.test.ts`.

## Typed identity

Every entity id is `<namespace>:<key>`; namespaces are
`symbol`, `form`, `reading-atom`, `reading-path`, `pattern` (ReadingConvergencePatternId),
`lexeme`, `morpheme`, `category`, `relation`, `source`, `evidence`, `context`.
`ENTITY_SCHEMA` declares, per collection field, the namespace(s) a reference must point into.
`validateEntityGraph` fails closed on untyped ids, wrong-namespace references, dangling
references, unknown fields, duplicate ids and duplicate bindings.

Repository semantic keys are derived from content (`form:装丁`, `reading-path:そう|てい`) or
minted explicitly (`lexeme:<key>`). Source-local identifiers (e.g. `jmdict:<date>:seq:<n>`) are
kept in `sourceRefs` beside the semantic id and never become it.

## Shared convergence DAG

- `ReadingConvergencePattern` = `from` historical ReadingPath -> `to` modern ReadingPath, optional
  `environment` (`leftEndsWith` / `rightStartsWith` on neighbouring modern atoms). Patterns may be
  chained, so path-level classes such as `ぶんはふ -> ぶんぽう` are
  `はふ -[hafu>hou]-> ほう -[hou>pou / ん_]-> ぽう`, with both mechanisms stored once and shared.
- Binding key: `(SymbolId, modern ReadingPathId, ContextId | null) -> PatternId[] + EvidenceId[]`.
  A symbol with several modern readings or contexts has several bindings; there is no
  `Symbol -> Pattern` shortcut. An empty pattern list attests "no historical change".
- Reverse traversal (`reconstruct`) walks only the bound patterns backwards from the modern path,
  honours environments, and returns **every** admissible predecessor sorted by value (never by
  storage order). Context selection mirrors the accepted 4.6E runtime: no context -> all bindings;
  a context -> exactly matching bindings; an unmatched context on a context-qualified symbol ->
  nothing. `法 / ほう` therefore stays `はふ | ほふ`; `仏教用語` selects `ほふ`; no
  non-Buddhist default is introduced.

## Canonical / compact

`canonicalizeEntityGraph` sorts every collection and set-like reference list, so storage order
carries no meaning. `compactEntityGraph` emits per-namespace dense tables whose reference columns
are indexes into the namespace declared by the embedded schema; `inflateEntityGraph` rejects a
schema mismatch or out-of-range index and round-trips to the canonical graph.

Not in 4.8B: JMdict compilation and 4.6E projection (4.8C), occurrence applicability (4.8D/E),
historical authority joins (4.8F).
