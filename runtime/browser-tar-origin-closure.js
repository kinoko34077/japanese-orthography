(function (root, factory) {
  const commonJs = typeof module === "object" && module.exports;
  const packLock = commonJs ? require("./browser-tar-pack-lock.js") : root.BrowserTarPackLock;
  const programRuntime = commonJs ? require("./browser-program-runtime.js") : root.BrowserProgramRuntime;
  const workerRuntime = commonJs ? require("./browser-transform-worker.js") : root.BrowserTransformWorker;
  const api = factory(root, packLock, programRuntime, workerRuntime);
  if (commonJs) module.exports = api;
  root.BrowserTarOriginClosure = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, PackLock, ProgramRuntime, WorkerRuntime) {
  "use strict";

  // #349 P10b3c2: 正規生成JSONから独立して受入済みdigestを固定する。
  // この値を外部JSON/manifest/ユーザー設定から導出・上書きしない。
  const PIN = Object.freeze({
    sha256: "500fa882847aa1ac8e8f1cbb1f619527f28e1608819e1105adb5233a3c5d102e",
    sourceCommit: "198f8560613d23417cb0f87172ae8662e722ca30",
    irDigest: "8c397f06dcdf2b6bfb8e0846067fdd05e91c5864f427b3de3ed80f9d598e83bd",
    packDigest: "0aaa39bd627dda40e73413026fbf25dae5fcdff326cf9ea254f1920dadfd470b",
    programDigest: "2093ffc1f30615d3a56614fd9e2759301518fb0fcfd5ad531830a41da1ed8e32"
  });
  const unsupported = (reason) => Object.freeze({ status: "unsupported", reason });
  if (typeof PackLock?.openFixedTarPack !== "function"
    || typeof ProgramRuntime?.createBrowserProgramRuntime !== "function") {
    throw new Error("TAR fixed origin closure requires accepted Pack and VM runtimes");
  }
  const hex = (buffer) => [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");

  // 呼出側は生candidate/Pack/VMを指定できない。固定受入データだけを同一閉包に構築。
  const openFixedTarOriginClosure = async (manifest, sectionProvider, originBytes) => {
    if (!(originBytes instanceof ArrayBuffer) && !ArrayBuffer.isView(originBytes)) {
      throw new TypeError("TAR origin closure requires raw JSON bytes, not caller-supplied parsed objects");
    }
    // digest計算中に外部が元Bufferを変更してもparse対象が揺れないよう、検証前に複製。
    const data = (originBytes instanceof ArrayBuffer
      ? new Uint8Array(originBytes)
      : new Uint8Array(originBytes.buffer, originBytes.byteOffset, originBytes.byteLength)).slice();
    if (data.byteLength !== 31798 || !root.crypto?.subtle) {
      throw new Error("TAR origin closure: pinned source size or WebCrypto unavailable");
    }
    const hash = hex(await root.crypto.subtle.digest("SHA-256", data));
    if (hash !== PIN.sha256) throw new Error("TAR origin closure: independent index digest mismatch");
    const index = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
    if (index?.schemaVersion !== "1" || index?.kind !== "fixed-tar-browser-origin-index-s3e2"
      || index.sourceCommit !== PIN.sourceCommit || index.irDigest !== PIN.irDigest
      || index.packDigest !== PIN.packDigest || index.programDigest !== PIN.programDigest
      || index.branchCount !== 123 || index.editableOriginCount !== 126
      || !Array.isArray(index.rows) || index.rows.length !== 123) {
      throw new Error("TAR origin closure: source/IR/Pack/Program identity mismatch");
    }
    const byBranch = new Map();
    const editableKeys = new Set();
    let candidateBranches = 0;
    let sharedBranches = 0;
    for (const entry of index.rows) {
      if (!Number.isSafeInteger(entry?.programId) || entry.programId < 0
        || !Number.isSafeInteger(entry.branchOrdinal) || entry.branchOrdinal < 0
        || typeof entry.input !== "string" || typeof entry.output !== "string"
        || !Array.isArray(entry.editableEntryKeys) || !entry.editableEntryKeys.length
        || !entry.editableEntryKeys.every((key) => typeof key === "string" && key.length > 0)
        || !["candidate", "shared-output"].includes(entry.kind)) {
        throw new Error("TAR origin closure: invalid fixed branch row");
      }
      if (entry.kind === "candidate") candidateBranches++;
      else sharedBranches++;
      const key = entry.programId + ":" + entry.branchOrdinal;
      if (byBranch.has(key)) throw new Error("TAR origin closure: ambiguous branch identity");
      byBranch.set(key, Object.freeze({
        input: entry.input, output: entry.output, kind: entry.kind,
        programId: entry.programId, branchOrdinal: entry.branchOrdinal,
        editableEntryKeys: Object.freeze([...entry.editableEntryKeys])
      }));
      for (const originKey of entry.editableEntryKeys) editableKeys.add(originKey);
    }
    if (candidateBranches !== 120 || sharedBranches !== 3 || editableKeys.size !== 126) {
      throw new Error("TAR origin closure: editable origin coverage drift");
    }
    const locked = await PackLock.openFixedTarPack(manifest, sectionProvider);
    if (locked.packDigest !== PIN.packDigest
      || locked.programDigest !== PIN.programDigest
      || locked.runtimeOriginAuthenticated !== false
      || !locked.isSameVerifiedPack(locked.pack)) {
      throw new Error("TAR origin closure: verified Pack identity drift");
    }
    const hot = await ProgramRuntime.createBrowserProgramRuntime(locked.pack, { traceEmissions: true });
    if (typeof hot.ownsTracedEmission !== "function") {
      throw new Error("TAR origin closure: genuine VM ownership required");
    }
    // Workerの調停前ゲートと独立診断を同じ判定機構で評価し、二重VM生成を避ける。
    const inspectCandidate = (candidate, sourceText, profileId) => {
        if (!hot.ownsTracedEmission(candidate)) return unsupported("candidate not owned by this VM");
        if (profileId !== "kinotch-fixed" || candidate?.origin !== "program"
          || candidate.stage !== "profile" || candidate.direction !== "to-modern"
          || candidate.channel !== "surface" || !Number.isSafeInteger(candidate.start)
          || !Number.isSafeInteger(candidate.end) || candidate.start < 0
          || candidate.end <= candidate.start || candidate.end > sourceText.length
          || !Array.isArray(candidate.programIds) || candidate.programIds.length !== 1
          || !Number.isSafeInteger(candidate.programIds[0])
          || !Number.isSafeInteger(candidate.emission?.programId)
          || !Number.isSafeInteger(candidate.emission?.branchOrdinal)
          || candidate.programIds[0] !== candidate.emission.programId) {
          return unsupported("candidate outside fixed literal TAR lane");
        }
        const entry = byBranch.get(candidate.emission.programId + ":" + candidate.emission.branchOrdinal);
        if (!entry || entry.input !== sourceText.slice(candidate.start, candidate.end)
          || entry.output !== candidate.output) return unsupported("candidate not in accepted origin branches");
        return Object.freeze({
          status: "matched", start: candidate.start, end: candidate.end,
          programId: entry.programId, branchOrdinal: entry.branchOrdinal,
          kind: entry.kind, editableEntryKeys: entry.editableEntryKeys
        });
    };
    const inspect = (sourceText, profileId, options = {}) => {
      if (typeof sourceText !== "string" || typeof profileId !== "string") {
        throw new TypeError("TAR origin closure: invalid transform input");
      }
      const observation = hot.transformText(sourceText, profileId, options);
      return Object.freeze((observation.candidates ?? [])
        .map((candidate) => inspectCandidate(candidate, sourceText, profileId)));
    };
    const createReadOnlyWorkerService = () => {
      if (typeof WorkerRuntime?.createTransformService !== "function") {
        throw new Error("TAR origin closure requires the existing Worker runtime");
      }
      let createdVMReuseCount = 0;
      let lastAudit = Object.freeze({ seen: 0, matched: 0, unsupported: 0 });
      // このoverrideは閉包で受入済みの同一Pack/同一VMだけを返す。
      const sharedVM = Object.freeze({
        createBrowserProgramRuntime: async (p, options) => {
          if (p !== locked.pack || options?.traceEmissions !== true) {
            throw new Error("TAR origin closure: foreign Pack or VM options");
          }
          createdVMReuseCount += 1;
          return hot;
        }
      });
      const service = WorkerRuntime.createTransformService({
        openPack: async () => locked.pack,
        executionMode: "vm-authoritative",
        programRuntime: sharedVM,
        trustedCandidateGate: ({pack, sourceText, profileId, candidates, isOriginalVmCandidate}) => {
          if (pack !== locked.pack || !locked.isSameVerifiedPack(pack)) {
            throw new Error("TAR origin closure: Worker Pack identity drift");
          }
          let matched = 0;
          let unsupportedCount = 0;
          for (const candidate of candidates) {
            const result = inspectCandidate(candidate, sourceText, profileId);
            if (result.status === "matched" && !isOriginalVmCandidate(candidate)) {
              throw new Error("TAR origin closure: Worker VM ownership drift");
            }
            if (result.status === "matched") matched += 1;
            else unsupportedCount += 1;
          }
          lastAudit = Object.freeze({seen:candidates.length, matched, unsupported:unsupportedCount});
          // 診断のみ：候補削除や優先順位・順序の変更を行わない。
          return [...candidates];
        }
      });
      return Object.freeze({
        handle: (message) => service.handle(message),
        opens: () => service.opens(),
        sharedVMReuses: () => createdVMReuseCount,
        lastAudit: () => lastAudit,
        runtimeOriginAuthenticated: false
      });
    };

    return Object.freeze({
      kind: "fixed-tar-origin-closure-s3e2-p10b3c2-readonly",
      sourceCommit: PIN.sourceCommit, packDigest: PIN.packDigest, irDigest: PIN.irDigest,
      programDigest: PIN.programDigest, auditedBranches: byBranch.size,
      editableOriginCount: editableKeys.size,
      runtimeOriginAuthenticated: false,
      inspect,
      createReadOnlyWorkerService
    });
  };
  return Object.freeze({ openFixedTarOriginClosure });
});
