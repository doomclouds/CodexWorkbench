import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { sdkProtocolDebugPlugin } from './app-sdk-debug.mjs';

const require = createRequire(new URL('../plugins/agentero-library/package.json', import.meta.url));
const { transform } = await import(pathToFileURL(require.resolve('esbuild')));
const plugin = sdkProtocolDebugPlugin(transform);

test('production protocol handling omits payload debug but still delivers messages and errors', async () => {
  const input = `const payload = { base64: 'private-pdf-bytes' };
    console.debug('Sending message', payload);
    if (payload) console.debug('Parsed message', payload), deliver(payload);
    console.error('protocol error'); console.warn('actionable warning');`;
  const result = await plugin.transform(input, 'C:/node_modules/@modelcontextprotocol/ext-apps/dist/src/app.js');
  const debug = [], errors = [], warnings = [], messages = [];
  runInNewContext(result.code, { console: { debug: (...args) => debug.push(args), error: message => errors.push(message), warn: message => warnings.push(message) }, deliver: message => messages.push(message) });
  assert.equal(debug.length, 0);
  assert.equal(messages[0].base64, 'private-pdf-bytes');
  assert.deepEqual(errors, ['protocol error']);
  assert.deepEqual(warnings, ['actionable warning']);
});

test('does not rewrite application code or worker raw strings', async () => {
  assert.equal(await plugin.transform('console.debug("app diagnostic")', 'C:/work/src/app/bridge.ts'), null);
  assert.equal(await plugin.transform('console.debug("worker")', 'C:/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?raw'), null);
});
