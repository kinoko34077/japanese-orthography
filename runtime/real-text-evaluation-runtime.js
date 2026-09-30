(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.RealTextEvaluationRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ensureBundle = (bundle) => {
    if (!bundle || typeof bundle.resolveUnit !== "function" || typeof bundle.render !== "function") {
      throw new TypeError("createRealTextEvaluator requires a resolver bundle with resolveUnit/render");
    }
  };

  const normalizeSpans = (sourceText, spans) => {
    if (!Array.isArray(spans)) {
      throw new TypeError("evaluate requires an array span plan");
    }
    let previousEnd = 0;
    return spans.map((span, index) => {
      const start = span?.start;
      const end = span?.end;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > sourceText.length) {
        throw new RangeError(`Invalid span at index ${index}`);
      }
      if (start < previousEnd) {
        throw new RangeError("Span plan must be ordered and non-overlapping");
      }
      previousEnd = end;
      return {
        start,
        end,
        protected: span?.protected === true,
        analyzer: typeof span?.analyzer === "string" ? span.analyzer : "explicit-span-plan-v1"
      };
    });
  };

  const unitTrace = (span, sourceText, renderedText, result) => ({
    recordType: "unit",
    analyzer: span.analyzer,
    start: span.start,
    end: span.end,
    sourceText,
    renderedText,
    kind: result?.kind ?? "unresolved",
    disposition: result?.historical?.disposition ?? null,
    lexicalIdentity: result?.lexicalIdentity ?? null,
    lexicalCandidates: Array.isArray(result?.lexicalCandidates) ? result.lexicalCandidates : [],
    reading: result?.reading ?? { modernSurface: null, source: "unknown" },
    historical: {
      route: result?.historical?.route ?? null,
      kana: result?.historical?.kana ?? null,
      contextualKanji: result?.historical?.contextualKanji ?? null,
      deterministicKanji: result?.historical?.deterministicKanji ?? null
    },
    evidenceRefs: Array.isArray(result?.evidenceRefs) ? result.evidenceRefs : []
  });

  const literalTrace = (start, end, text) => ({
    recordType: "literal",
    analyzer: null,
    start,
    end,
    sourceText: text,
    renderedText: text,
    kind: "literal",
    disposition: "PRESERVE",
    lexicalIdentity: null,
    lexicalCandidates: [],
    reading: null,
    historical: null,
    evidenceRefs: []
  });

  const summarize = (trace) => trace.reduce((summary, record) => {
    if (record.recordType === "literal") {
      summary.literal += 1;
      return summary;
    }
    if (record.kind === "resolved") summary.resolved += 1;
    if (record.disposition === "AUTO") summary.auto += 1;
    if (record.kind === "candidates" || record.disposition === "CANDIDATES") summary.candidates += 1;
    if (record.kind === "unresolved") summary.unresolved += 1;
    if (record.kind === "protected" || record.disposition === "PRESERVE") summary.protectedPreserved += 1;
    return summary;
  }, {
    resolved: 0,
    auto: 0,
    candidates: 0,
    unresolved: 0,
    protectedPreserved: 0,
    literal: 0
  });

  const createRealTextEvaluator = (bundle) => {
    ensureBundle(bundle);

    const evaluate = (input, spans, options = {}) => {
      const sourceText = `${input ?? ""}`;
      const plan = normalizeSpans(sourceText, spans);
      const trace = [];
      const renderedParts = [];
      const mode = options.mode ?? "plain";
      let cursor = 0;

      for (const span of plan) {
        if (span.start > cursor) {
          const literal = sourceText.slice(cursor, span.start);
          renderedParts.push(literal);
          trace.push(literalTrace(cursor, span.start, literal));
        }

        const unitSource = sourceText.slice(span.start, span.end);
        const result = bundle.resolveUnit(unitSource, { protected: span.protected });
        const shouldRender = result?.kind === "resolved" && result?.historical?.disposition === "AUTO";
        const renderedText = shouldRender ? bundle.render(result, { mode }) : unitSource;
        renderedParts.push(renderedText);
        trace.push(unitTrace(span, unitSource, renderedText, result));
        cursor = span.end;
      }

      if (cursor < sourceText.length) {
        const literal = sourceText.slice(cursor);
        renderedParts.push(literal);
        trace.push(literalTrace(cursor, sourceText.length, literal));
      }

      return {
        sourceText,
        renderedText: renderedParts.join(""),
        offsetUnit: "utf16-code-unit",
        analyzer: { kind: "explicit-span-plan-v1" },
        trace,
        summary: summarize(trace)
      };
    };

    return { evaluate };
  };

  return { createRealTextEvaluator };
});
