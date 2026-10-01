/* Service worker for repeat-use speed (#185 H).
 *
 * - BrowserPack sections are requested with `?v=<sha256>` (content-addressed): cache-first.
 *   A new pack has new URLs, so sections of two pack identities are never mixed.
 * - The manifest and the app shell are network-first (fresh when online, cached copy offline).
 * - `prune` keeps only the sections listed by the current manifest.
 * - Nothing the user types is stored: only GET requests for site/pack files are cached.
 */
"use strict";

const SHELL_CACHE = "browser-pack-shell-v1";
const SECTION_CACHE = "browser-pack-sections";

const isSection = (url) => url.pathname.includes("/browser-pack/") && url.searchParams.has("v");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isSection(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(SECTION_CACHE);
      const hit = request.cache === "reload" ? null : await cache.match(request);
      if (hit) return hit;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      const hit = await cache.match(request);
      if (hit) return hit;
      throw error;
    }
  })());
});

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message?.type === "prune" && Array.isArray(message.keep)) {
    event.waitUntil((async () => {
      const keep = new Set(message.keep);
      const cache = await caches.open(SECTION_CACHE);
      let removed = 0;
      for (const request of await cache.keys()) {
        if (!keep.has(request.url)) { await cache.delete(request); removed += 1; }
      }
      event.source?.postMessage({ type: "pruned", removed });
    })());
  }
  if (message?.type === "clear") {
    event.waitUntil((async () => {
      await caches.delete(SECTION_CACHE);
      await caches.delete(SHELL_CACHE);
      event.source?.postMessage({ type: "cleared" });
    })());
  }
});
