(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.BrowserSectionFetcher = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Section fetching for the Pages site (#185 H). Section URLs are content-addressed by appending the
  // section's sha256 (`?v=<sha256>`), so a cached body can only ever be reused for the identical
  // section of the identical pack; a new pack produces new URLs. A body whose digest does not match
  // (corrupt cache, partial download) is evicted from CacheStorage and fetched once more from the
  // network; a second mismatch fails visibly instead of being used.

  const toHex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const sectionUrl = (manifestUrl, section) => {
    const url = new URL(section.path, manifestUrl);
    url.searchParams.set("v", section.sha256);
    return url.href;
  };

  const createSectionFetcher = ({ manifestUrl, fetchImpl, cachesImpl, subtleImpl, cacheName = "browser-pack-sections" }) => {
    const digest = async (buffer) => toHex(await subtleImpl.digest("SHA-256", buffer));
    const evict = async (url) => {
      if (!cachesImpl) return;
      try { const cache = await cachesImpl.open(cacheName); await cache.delete(url); } catch { /* storage may be unavailable */ }
    };
    const stats = { network: 0, evicted: 0 };
    const fetchSection = async (section) => {
      const url = sectionUrl(manifestUrl, section);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetchImpl(url, { cache: attempt === 0 ? "default" : "reload" });
        stats.network += 1;
        if (!response.ok) throw new Error(`fetch ${section.path}: HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === section.byteLength && (await digest(buffer)) === section.sha256) return buffer;
        await evict(url);
        stats.evicted += 1;
      }
      throw new Error(`section ${section.sectionId} failed verification twice; the pack on the server may be updating — reload the page`);
    };
    return { fetchSection, stats: () => ({ ...stats }) };
  };

  return { createSectionFetcher, sectionUrl };
});
