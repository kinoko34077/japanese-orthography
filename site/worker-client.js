(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.WorkerClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // UI-thread side of the transform worker (#185 G). Requests are matched to replies by id; a newer
  // transform supersedes an older one so stale results never overwrite fresh ones.

  const createWorkerClient = ({ createWorker, manifestUrl }) => {
    let worker = null;
    let next = 1;
    const pending = new Map();

    const start = () => {
      worker = createWorker();
      worker.addEventListener("message", (event) => {
        const message = event.data;
        const entry = pending.get(message?.requestId);
        if (!entry) return;
        pending.delete(message.requestId);
        if (message.type === "error") entry.reject(new Error(message.message));
        else entry.resolve(message);
      });
      worker.addEventListener("error", (event) => {
        for (const entry of pending.values()) entry.reject(new Error(event.message || "worker error"));
        pending.clear();
      });
    };

    const send = (payload) => new Promise((resolve, reject) => {
      if (!worker) start();
      const requestId = `r${next++}`;
      pending.set(requestId, { resolve, reject });
      worker.postMessage({ ...payload, requestId });
    });

    let latestTransform = null;
    return {
      open: async () => {
        await send({ type: "configure", manifestUrl });
        return send({ type: "open" });
      },
      transform: async (text, profileId, renderMode = "plain") => {
        const token = {};
        latestTransform = token;
        const reply = await send({ type: "transform", text, profileId, renderMode });
        return { ...reply, stale: latestTransform !== token };
      },
      detail: (resultId, detailRef) => send({ type: "detail", resultId, detailRef }),
      /** Drop the worker (and its in-memory pack) and start fresh: used to recover from errors. */
      restart: () => {
        if (worker) worker.terminate();
        worker = null;
        for (const entry of pending.values()) entry.reject(new Error("restarted"));
        pending.clear();
      }
    };
  };

  return { createWorkerClient };
});
