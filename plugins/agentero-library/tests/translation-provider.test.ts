import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, test } from 'vitest';
import { TranslationProvider } from '../src/infrastructure/translation-provider.js';

const cleanups: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'workbench-translation-'));
  cleanups.push(async () => { if (!resolve(root).startsWith(`${resolve(tmpdir())}${sep}`) || !basename(root).startsWith('workbench-translation-')) throw new Error('Unsafe cleanup target'); await rm(root, { recursive: true, force: true }); });
  return root;
}
async function server(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const value = createServer(handler);
  await new Promise<void>(resolve => value.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => { value.closeAllConnections(); value.close(() => resolve()); }));
  const address = value.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
  return `http://127.0.0.1:${address.port}/v1`;
}
test('saves credentials privately and another process-facing instance reads current settings without echoing the key', async () => {
  const root = await temporary(); const first = new TranslationProvider(root); const second = new TranslationProvider(root);
  expect((await first.read()).provider).toBe('cli');
  const publicValue = await second.update({ provider: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'local-model', apiKey: 'local-test-token', targetLanguage: 'en' });
  expect(publicValue).toMatchObject({ provider: 'openai', hasApiKey: true, targetLanguage: 'en' });
  expect(JSON.stringify(publicValue)).not.toContain('local-test-token');
  expect(await first.read()).toEqual(publicValue);
  expect(await readFile(join(root, 'secrets/translation.json'), 'utf8')).toContain('local-test-token');
  await first.update({ model: 'other-model', apiKey: '' });
  expect((await second.read()).hasApiKey).toBe(true);
  await second.update({ clearApiKey: true }); expect((await first.read()).hasApiKey).toBe(false);
});
test('uses a compatible request and returns real Unicode content without sending extra provider-specific defaults', async () => {
  const root = await temporary(); let received: unknown; let authorization: string | undefined;
  const url = await server(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; received = JSON.parse(body); authorization = req.headers.authorization; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '保留公式 $x^2$ 的译文。' } }] })); });
  const provider = new TranslationProvider(root); cleanups.push(() => provider.close());
  await provider.update({ provider: 'openai', baseUrl: url, model: 'local-model', apiKey: 'local-test-token' });
  const result = await provider.translate({ vaultId: 'test', text: 'Preserve $x^2$.', to: 'zh-CN' });
  expect(result.text).toBe('保留公式 $x^2$ 的译文。'); expect(result.targetLang).toBe('zh-CN'); expect(authorization).toBe('Bearer local-test-token');
  expect(received).toMatchObject({ model: 'local-model', stream: false, messages: [{ role: 'system' }, { role: 'user', content: 'Preserve $x^2$.' }] });
  expect(received).not.toHaveProperty('temperature');
});
test('reports truncated model output rather than accepting an incomplete paragraph', async () => {
  const root = await temporary(); const url = await server((_req, res) => res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'incomplete' } }] })));
  const provider = new TranslationProvider(root); cleanups.push(() => provider.close()); await provider.update({ provider: 'openai', baseUrl: url, model: 'test' });
  await expect(provider.translate({ vaultId: 'test', text: 'sample' })).rejects.toMatchObject({ code: 'TRANSLATION_TRUNCATED' });
});
test('cancel and close abort owned requests instead of completing after their UI has gone away', async () => {
  const root = await temporary(); let started!: () => void; const incoming = new Promise<void>(resolve => { started = resolve; });
  const url = await server(() => { started(); });
  const provider = new TranslationProvider(root); await provider.update({ provider: 'openai', baseUrl: url, model: 'test' });
  const request = provider.translate({ vaultId: 'test', text: 'sample' }).catch(error => error);
  await incoming; provider.close(); expect(await request).toMatchObject({ code: 'OPERATION_CANCELLED' });
  await expect(provider.translate({ vaultId: 'test', text: 'sample' })).rejects.toMatchObject({ code: 'SERVICE_CLOSED' });
});
