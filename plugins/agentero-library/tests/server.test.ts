import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LibraryService } from '../src/core/library-service.js';
import { createLibraryServer } from '../src/server/server.js';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function connect() {
  const dataRoot = await mkdtemp(join(tmpdir(), 'codex-workbench-server-test-'));
  cleanup.push(() => rm(dataRoot, { recursive: true, force: true }));
  const service = new LibraryService({ dataRoot });
  const server = createLibraryServer(service, { html: '<!doctype html><title>Library</title>' });
  const client = new Client({ name: 'contract-test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  cleanup.push(async () => { await client.close(); await server.close(); await service.close(); });
  return { client, service, dataRoot };
}

test('unconfigured server exposes native settings and Thread app without requiring a CLI', async () => {
  const { client } = await connect();
  const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));
  const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  expect(client.getServerVersion()?.version).toBe(manifest.version);
  expect(manifest.version).toBe(packageInfo.version);
  expect(client.getServerCapabilities()?.experimental?.['openai/settings']).toEqual({ readTool: 'settings_read', updateTool: 'settings_update' });
  const { tools } = await client.listTools();
  const open = tools.find((tool) => tool.name === 'library_open');
  expect(open?._meta?.['openai/ui']).toMatchObject({ entrypoints: [{ type: 'thread' }] });
  expect(tools.find((tool) => tool.name === 'pdf_read_chunk')?._meta?.ui).toMatchObject({ visibility: ['app'] });
  const settings = await client.callTool({ name: 'settings_read', arguments: {} });
  expect(settings.isError).not.toBe(true);
  expect(settings.structuredContent).toMatchObject({ schema: { type: 'object' }, values: { allowAgentPdfText: false } });
  const resources = await client.listResources();
  const html = await client.readResource({ uri: resources.resources[0].uri });
  expect(html.contents[0]).toMatchObject({ mimeType: 'text/html;profile=mcp-app', text: '<!doctype html><title>Library</title>' });
});

test('native settings accept partial updates and preserve omitted values', async () => {
  const { client } = await connect();
  const before = await client.callTool({ name: 'settings_read', arguments: {} });
  await client.callTool({ name: 'settings_update', arguments: { set: { allowAgentPdfText: true } } });
  const read = await client.callTool({ name: 'settings_read', arguments: {} });
  expect(read.structuredContent).toMatchObject({ values: { ...((before.structuredContent as { values: Record<string, unknown> }).values), allowAgentPdfText: true } });
  const invalid = await client.callTool({ name: 'settings_update', arguments: { set: { unknownField: 'bad' } } });
  expect(invalid.isError).toBe(true);
});

test('schema rejects unbounded PDF chunks and unsupported note modes', async () => {
  const { client } = await connect();
  const invalidChunk = await client.callTool({ name: 'pdf_read_chunk', arguments: { vaultId: 'test', paperPath: 'papers/demo', length: 1024 * 1024 + 1 } });
  expect(invalidChunk.isError).toBe(true);
  expect(invalidChunk.structuredContent).toBeUndefined(); // Rejected by MCP input validation, before the unconfigured backend.
  const invalidWrite = await client.callTool({ name: 'note_write', arguments: { vaultId: 'test', path: 'notes/x.md', content: 'hello', revision: null, mode: 'create' } });
  expect(invalidWrite.isError).toBe(true);
  expect(invalidWrite.structuredContent).toBeUndefined();
});
