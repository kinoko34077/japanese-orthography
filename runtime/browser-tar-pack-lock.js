(function (root, factory) {
  const packRuntime = typeof module === "object" && module.exports
    ? require("./browser-pack-runtime.js") : root.BrowserPackRuntime;
  const api = factory(packRuntime);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BrowserTarPackLock = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (BrowserPackRuntime) {
  "use strict";

  // #349 P10b3b: 正本受入記録から独立固定。取得manifestから期待値を導出しない。
  const FIXED_PACK_DIGEST = "0aaa39bd627dda40e73413026fbf25dae5fcdff326cf9ea254f1920dadfd470b";
  const FIXED_PROGRAM_DIGEST = "2093ffc1f30615d3a56614fd9e2759301518fb0fcfd5ad531830a41da1ed8e32";
  const HOT_KINDS = Object.freeze([
    "symbol-registry", "sequence-pool", "rule-programs", "rule-program-index",
    "rule-predicates", "rule-lexeme-sets", "rule-runtime-meta"
  ]);
  if (!BrowserPackRuntime || typeof BrowserPackRuntime.openBrowserPack !== "function") {
    throw new Error("Fixed TAR Pack lock requires BrowserPackRuntime");
  }

  // このfactoryは候補や任意のopened packを受け取らず、必ず正規ローダーを実行する。
  const openFixedTarPack = async (manifest, sectionProvider) => {
    if (manifest?.packDigest !== FIXED_PACK_DIGEST ||
        manifest?.compilerVersion !== "3" ||
        manifest?.ruleRuntime?.programDigest !== FIXED_PROGRAM_DIGEST ||
        !Array.isArray(manifest.profiles) ||
        !manifest.profiles.some((profile) => profile.profileId === "kinotch-fixed") ||
        !Array.isArray(manifest.sections)) {
      throw new Error("Fixed TAR Pack lock: independent accepted identity mismatch");
    }
    for (const sectionId of HOT_KINDS) {
      const matches = manifest.sections.filter(
        (section) => section.sectionId === sectionId && section.kind === sectionId
      );
      if (matches.length !== 1 || !Number.isSafeInteger(matches[0].byteLength) ||
          matches[0].byteLength <= 0) {
        throw new Error("Fixed TAR Pack lock: missing or ambiguous hot section " + sectionId);
      }
    }
    const pack = await BrowserPackRuntime.openBrowserPack(manifest, sectionProvider);
    if (pack.packDigest !== FIXED_PACK_DIGEST) {
      throw new Error("Fixed TAR Pack lock: opened Pack identity mismatch");
    }
    for (const sectionId of HOT_KINDS) {
      if (!pack.hasSection(sectionId)) throw new Error("Fixed TAR Pack lock: hot section missing");
      // 正規PackローダーのbyteLength/SHA256検証を必ず通す（別ローダーは作らない）。
      await pack.loadSection(sectionId);
    }
    return Object.freeze({
      kind: "fixed-tar-pack-lock-s3e2-p10b3b-readonly",
      pack,
      packDigest: FIXED_PACK_DIGEST,
      programDigest: FIXED_PROGRAM_DIGEST,
      verifiedHotSectionIds: HOT_KINDS,
      // 同じインスタンス以外への値コピーは認証しない。
      isSameVerifiedPack: (candidatePack) => candidatePack === pack,
      runtimeOriginAuthenticated: false
    });
  };
  return Object.freeze({ openFixedTarPack });
});
