import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

type RuntimeManifest = {
  schemaVersion: number;
  semanticsVersion: string;
  modules: Array<{
    id: string;
    path: string;
    byteLength: number;
    gitBlob: string;
    adoptedGitBlob: string;
    requires?: string[];
  }>;
};

const loadUmd = async (path: string, globals: Record<string, unknown> = {}) => {
  const source = await readFile(path, "utf8");
  const sandbox: Record<string, unknown> = { ...globals };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: path });
  return sandbox;
};

function computeGitBlobSha(payload: Buffer): string {
  const header = Buffer.from(`blob ${payload.byteLength}\0`, "utf8");
  return createHash("sha1").update(header).update(payload).digest("hex");
}

function readCanonicalGitBlob(path: string): Buffer {
  return execFileSync("git", ["cat-file", "blob", `HEAD:${path}`]);
}

function readCanonicalGitBlobSha(path: string): string {
  return execFileSync("git", ["rev-parse", `HEAD:${path}`], { encoding: "utf8" }).trim();
}

test("git blob SHA helper matches Git hash-object semantics", () => {
  const probe = Buffer.from("japanese-orthography runtime manifest probe\n", "utf8");
  const gitSha = execFileSync("git", ["hash-object", "--stdin"], { input: probe, encoding: "utf8" }).trim();
  assert.equal(computeGitBlobSha(probe), gitSha);
});

test("canonical runtime manifest pins exact module payloads", async () => {
  const manifest = JSON.parse(await readFile("runtime/manifest.json", "utf8")) as RuntimeManifest;
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.semanticsVersion, "1");

  for (const module of manifest.modules) {
    const payload = readCanonicalGitBlob(module.path);
    assert.equal(payload.byteLength, module.byteLength, module.id);
    assert.equal(computeGitBlobSha(payload), module.gitBlob, module.id);
    assert.equal(readCanonicalGitBlobSha(module.path), module.gitBlob, module.id);
  }
});

test("canonical runtime loads without browser or HTTP dependencies", async () => {
  const sharedSandbox = await loadUmd("runtime/transform-shared.js");
  assert.ok(sharedSandbox.TransformShared);

  const engineSandbox = await loadUmd("runtime/transform-engine.js", {
    TransformShared: sharedSandbox.TransformShared
  });
  const engine = engineSandbox.TransformEngine as {
    loadStagesFromDefinitions: (manifest: unknown, files: unknown) => { stages: unknown[]; stringRuleCount: number };
  };
  assert.equal(typeof engine.loadStagesFromDefinitions, "function");

  const loaded = engine.loadStagesFromDefinitions(
    { bundles: [{ id: "fixture", label: "fixture", kind: "dictionary-rules", path: "fixture.json5", order: 1, enabled: true }] },
    { fixture: { kind: "dictionary-rules", entries: [{ from: "学", to: "學", enabled: true }] } }
  );
  assert.equal(loaded.stages.length, 1);
  assert.equal(loaded.stringRuleCount, 1);

  const dictionarySandbox = await loadUmd("runtime/structured-dictionary.js");
  const dictionary = dictionarySandbox.StructuredDictionary as {
    createEmptyDictionary: () => unknown;
    validateDictionary: (value: unknown) => { errors: unknown[] };
  };
  assert.equal(typeof dictionary.createEmptyDictionary, "function");
  const errors = dictionary.validateDictionary(dictionary.createEmptyDictionary()).errors;
  assert.equal(errors.length, 0, JSON.stringify(errors));
});
