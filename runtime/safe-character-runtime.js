(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.SafeCharacterRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const createSafeCharacterRuntime = (slice) => {
    if (slice?.schemaVersion !== "1" || slice?.kind !== "japanese-orthography-safe-character-slice") {
      throw new TypeError("Unsupported safe-character slice");
    }

    const map = {};
    for (const mapping of Array.isArray(slice.mappings) ? slice.mappings : []) {
      map[mapping.modern] = mapping.historical;
    }
    const characterMap = Object.freeze({ ...map });

    const apply = (value) => Array.from(`${value ?? ""}`).map((char) => (
      Object.prototype.hasOwnProperty.call(characterMap, char) ? characterMap[char] : char
    )).join("");

    return { characterMap, apply };
  };

  return { createSafeCharacterRuntime };
});
