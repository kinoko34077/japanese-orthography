import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  compileKinotchTokenStyleOverlay,
  type CompiledTokenStyleOverlayArtifact
} from '../tools/profile-compiler.ts';
import { loadKinotchTokenStyleOverlay } from '../tools/profile-loader.ts';
import { createProfileSchemaValidator, validateTokenStyleOverlayDocument } from '../tools/profile-validator.ts';

const root = process.cwd();

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

test('canonical token-style overlay owns only exact-token こと -> ヿ as KiNoTch style/render policy', async () => {
  const overlay = await loadKinotchTokenStyleOverlay(root);
  assert.equal(overlay.schemaVersion, '1');
  assert.equal(overlay.profileId, 'kinotch-authoring');
  assert.equal(overlay.authority, 'project_profile');
  assert.equal(overlay.responsibility, 'style_render');
  assert.equal(overlay.packId, 'token-style');
  assert.equal(overlay.kind, 'token-rules');
  assert.equal(overlay.genericSafety, 'not_implied');
  assert.deepEqual(overlay.sourceSnapshot, {
    repository: 'kinoko34077/txt-auto-replace',
    commit: '48ceade01db46af3fad7acfb8743c3d841885c33',
    path: 'transforms/20-lexical-replacements.json5',
    blobSha: '32d4acff7532b5dd21d0bab1d1ba414298f27687'
  });
  assert.deepEqual(overlay.rules, [{
    from: 'こと',
    to: 'ヿ',
    match: 'exact_token',
    priority: 100
  }]);
});

test('token-style overlay schema and semantic validation reject wrong authority/responsibility', () => {
  const validate = createProfileSchemaValidator();
  const invalid = {
    schemaVersion: '1',
    profileId: 'kinotch-authoring',
    authority: 'generic_core',
    responsibility: 'semantic_override',
    packId: 'token-style',
    kind: 'token-rules',
    genericSafety: 'not_implied',
    sourceSnapshot: {
      repository: 'kinoko34077/txt-auto-replace',
      commit: '48ceade01db46af3fad7acfb8743c3d841885c33',
      path: 'transforms/20-lexical-replacements.json5',
      blobSha: '32d4acff7532b5dd21d0bab1d1ba414298f27687'
    },
    rules: [{ from: 'こと', to: 'ヿ', match: 'exact_token', priority: 100 }]
  };
  assert.ok(validate(invalid, 'kinotch-token-style-overlay-v1').some((item) => item.code === 'E_SCHEMA'));
  assert.ok(validateTokenStyleOverlayDocument(invalid).length > 0);
});

test('token-style compiler emits deterministic consumer token-rules and content-addressed manifest', async () => {
  const overlay = await loadKinotchTokenStyleOverlay(root);
  const first = compileKinotchTokenStyleOverlay(overlay);
  const second = compileKinotchTokenStyleOverlay(overlay);
  assert.deepEqual(first, second);

  const artifact: CompiledTokenStyleOverlayArtifact = first;
  const bundle = JSON.parse(artifact['20-kinotch-token-style.json5']);
  assert.deepEqual(bundle, {
    id: 'kinotch-token-style',
    label: 'KiNoTch. token style',
    kind: 'token-rules',
    rules: [{ from: 'こと', to: 'ヿ', type: 'literal', priority: 100 }]
  });

  const manifest = JSON.parse(artifact['manifest.json']);
  assert.equal(manifest.artifactSchemaVersion, '1');
  assert.equal(manifest.profileId, 'kinotch-authoring');
  assert.equal(manifest.authority, 'project_profile');
  assert.equal(manifest.responsibility, 'style_render');
  assert.equal(manifest.buildSourceIdentity, 'canonical-content-addressed');
  assert.deepEqual(manifest.adoptedSource, overlay.sourceSnapshot);
  assert.deepEqual(manifest.files.map((file: any) => file.path), ['20-kinotch-token-style.json5']);
  assert.equal(manifest.files[0].payloadDigest, sha256(artifact['20-kinotch-token-style.json5']));
  assert.equal(manifest.files[0].byteLength, Buffer.byteLength(artifact['20-kinotch-token-style.json5'], 'utf8'));
});
