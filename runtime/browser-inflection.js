(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.BrowserInflection = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Browser deinflection (#196 F). JMdict lists dictionary forms only; an inflected surface
  // (味わおう, 思わない, 書きます, 高かった, 勉強した) is mapped back to a dictionary form whose JMdict
  // part of speech admits that inflection. A rule never creates a lexeme: a deinflected candidate
  // exists only if the base form is in the lexicon *and* carries a matching conjugation class.
  // Every result keeps all matching (lexeme, rule) pairs; nothing is chosen here.
  //
  // Conjugation-form labels follow the UniDic vocabulary used by the accepted resolver morphology.

  const GODAN = {
    v5u: { end: "う", a: "わ", i: "い", e: "え", o: "お", te: "って", ta: "った" },
    v5k: { end: "く", a: "か", i: "き", e: "け", o: "こ", te: "いて", ta: "いた" },
    "v5k-s": { end: "く", a: "か", i: "き", e: "け", o: "こ", te: "って", ta: "った" },
    v5g: { end: "ぐ", a: "が", i: "ぎ", e: "げ", o: "ご", te: "いで", ta: "いだ" },
    v5s: { end: "す", a: "さ", i: "し", e: "せ", o: "そ", te: "して", ta: "した" },
    v5t: { end: "つ", a: "た", i: "ち", e: "て", o: "と", te: "って", ta: "った" },
    v5n: { end: "ぬ", a: "な", i: "に", e: "ね", o: "の", te: "んで", ta: "んだ" },
    v5b: { end: "ぶ", a: "ば", i: "び", e: "べ", o: "ぼ", te: "んで", ta: "んだ" },
    v5m: { end: "む", a: "ま", i: "み", e: "め", o: "も", te: "んで", ta: "んだ" },
    v5r: { end: "る", a: "ら", i: "り", e: "れ", o: "ろ", te: "って", ta: "った" },
    "v5r-i": { end: "る", a: "ら", i: "り", e: "れ", o: "ろ", te: "って", ta: "った" },
    v5aru: { end: "る", a: "ら", i: "い", e: "え", o: "ろ", te: "って", ta: "った" }
  };

  const rules = [];
  const add = (pos, inflected, base, form) => rules.push({ pos, inflected, base, form });
  for (const [pos, r] of Object.entries(GODAN)) {
    add(pos, `${r.a}ない`, r.end, "未然形-一般+ない");
    add(pos, `${r.a}なかった`, r.end, "未然形-一般+なかった");
    add(pos, `${r.a}ず`, r.end, "未然形-一般+ず");
    add(pos, `${r.a}れる`, r.end, "未然形-一般+れる");
    add(pos, `${r.a}せる`, r.end, "未然形-一般+せる");
    add(pos, `${r.i}ます`, r.end, "連用形-一般+ます");
    add(pos, `${r.i}ました`, r.end, "連用形-一般+ました");
    add(pos, `${r.i}ません`, r.end, "連用形-一般+ません");
    add(pos, `${r.i}たい`, r.end, "連用形-一般+たい");
    add(pos, `${r.i}ながら`, r.end, "連用形-一般+ながら");
    add(pos, r.te, r.end, "連用形-音便+て");
    add(pos, r.ta, r.end, "連用形-音便+た");
    add(pos, `${r.ta}ら`, r.end, "連用形-音便+たら");
    add(pos, `${r.te}いる`, r.end, "連用形-音便+ている");
    add(pos, `${r.e}ば`, r.end, "仮定形-一般+ば");
    add(pos, `${r.e}る`, r.end, "可能");
    add(pos, `${r.o}う`, r.end, "意志推量形");
  }
  for (const [suffix, form] of [["ない", "未然形-一般+ない"], ["なかった", "未然形-一般+なかった"], ["ず", "未然形-一般+ず"], ["られる", "未然形-一般+られる"], ["させる", "未然形-一般+させる"],
    ["ます", "連用形-一般+ます"], ["ました", "連用形-一般+ました"], ["ません", "連用形-一般+ません"], ["たい", "連用形-一般+たい"], ["ながら", "連用形-一般+ながら"],
    ["て", "連用形-一般+て"], ["た", "連用形-一般+た"], ["たら", "連用形-一般+たら"], ["ている", "連用形-一般+ている"], ["れば", "仮定形-一般+ば"], ["よう", "意志推量形"], ["ろ", "命令形"]]) {
    add("v1", suffix, "る", form);
  }
  for (const [suffix, form] of [["く", "連用形-一般"], ["くて", "連用形-一般+て"], ["かった", "連用形-促音便+た"], ["くない", "連用形-一般+ない"], ["ければ", "仮定形-一般+ば"], ["さ", "語幹+さ"]]) {
    add("adj-i", suffix, "い", form);
  }
  for (const [suffix, form] of [["する", "終止形-一般"], ["した", "連用形-一般+た"], ["して", "連用形-一般+て"], ["します", "連用形-一般+ます"], ["しました", "連用形-一般+ました"],
    ["しない", "未然形-一般+ない"], ["しよう", "意志推量形"], ["すれば", "仮定形-一般+ば"], ["される", "未然形-一般+れる"], ["させる", "未然形-一般+させる"], ["している", "連用形-一般+ている"]]) {
    add("vs", suffix, "", form);
  }
  rules.sort((a, b) => b.inflected.length - a.inflected.length || (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0) || (a.inflected < b.inflected ? -1 : 1));
  const MAX_SUFFIX = Math.max(...rules.map((r) => r.inflected.length));

  /** Rules whose inflected ending `surface` carries; the base form is `surface - inflected + base`. */
  const deinflect = (surface) => {
    const out = [];
    for (const rule of rules) {
      if (surface.length <= rule.inflected.length || !surface.endsWith(rule.inflected)) continue;
      out.push({ ...rule, baseSurface: surface.slice(0, surface.length - rule.inflected.length) + rule.base });
    }
    return out;
  };

  /** Does a JMdict POS list admit this rule's conjugation class? (`vs` covers vs, vs-i, vs-s.) */
  const admits = (partOfSpeech, rule) => partOfSpeech.some((p) => p === rule.pos || (rule.pos === "vs" && (p === "vs" || p === "vs-i" || p === "vs-s")));

  /** The reading of the inflected form: the base reading with the same ending rewritten. */
  const inflectReading = (baseReading, rule) => {
    if (typeof baseReading !== "string" || !baseReading.endsWith(rule.base)) return null;
    return baseReading.slice(0, baseReading.length - rule.base.length) + rule.inflected;
  };

  /**
   * Ending positions in `text` where some rule's inflected suffix ends, with the stems (bounded by
   * `maxStem` UTF-16 units) whose base form should be looked up. Used to prepare index shards.
   */
  const scan = (text, maxStem) => {
    const sites = [];
    for (let end = 1; end <= text.length; end += 1) {
      for (const rule of rules) {
        const suffixStart = end - rule.inflected.length;
        if (suffixStart < 1 || text.slice(suffixStart, end) !== rule.inflected) continue;
        for (let start = Math.max(0, suffixStart - maxStem); start < suffixStart; start += 1) {
          const code = text.charCodeAt(start);
          if (code >= 0xdc00 && code <= 0xdfff) continue; // never start inside a surrogate pair
          sites.push({ start, end, rule, baseSurface: text.slice(start, suffixStart) + rule.base });
        }
      }
    }
    return sites;
  };

  return { deinflect, admits, inflectReading, scan, rules, MAX_SUFFIX };
});
