import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { createWorkerClient } = createRequire(import.meta.url)('../site/worker-client.js');

test('#310 Pages alone opts into source-backed token inference', async () => {
  const sent: any[] = [];
  const listeners = new Map<string, (event: any) => void>();
  const client = createWorkerClient({
    manifestUrl: 'https://example.invalid/browser-pack/manifest.json',
    createWorker: () => ({
      addEventListener: (name: string, callback: (event: any) => void) => listeners.set(name, callback),
      postMessage: (message: any) => {
        sent.push(message);
        queueMicrotask(() => listeners.get('message')?.({
          data: { type: 'result', requestId: message.requestId, result: { renderedText: message.text } }
        }));
      },
      terminate: () => {}
    })
  });
  await client.transform('もちろん', 'kinotch-fixed', 'plain');
  await client.transform('もちろん', 'historical', 'plain');
  await client.transform('もちろん', 'modern', 'plain');
  assert.deepEqual(sent.map((item) => item.type), ['transform', 'transform', 'transform']);
  assert.deepEqual(sent.map((item) => item.sourceBackedTokenInference), [true, false, false]);
  assert.ok(sent.every((item) => item.text === 'もちろん'));
});
