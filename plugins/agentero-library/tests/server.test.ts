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

test('keeps exported bytes and UI documents out of model-visible tool content', async () => {
  const { client, service } = await connect();
  service.exportPaper = async () => ({ fileName: 'sample.pdf', mediaType: 'application/pdf', totalBytes: 5, base64: 'SGVsbG8=', content: 'private export content' });
  service.readPaperMarkdown = async () => ({ path: 'papers/sample/PAPER.md', content: 'private paper body', revision: 'revision', exists: true });
  const exported = await client.callTool({ name: 'paper_export', arguments: { vaultId: 'test', paperPath: 'papers/sample', format: 'pdf' } });
  expect(exported.isError).not.toBe(true);
  expect(exported._meta?.export).toMatchObject({ base64: 'SGVsbG8=', content: 'private export content' });
  expect(JSON.stringify(exported.structuredContent)).not.toMatch(/SGVsbG8|private export content/);
  expect(JSON.stringify(exported.content)).not.toMatch(/SGVsbG8|private export content/);
  const document = await client.callTool({ name: 'paper_markdown', arguments: { vaultId: 'test', paperPath: 'papers/sample' } });
  expect(document._meta?.document).toMatchObject({ content: 'private paper body' });
  expect(JSON.stringify(document.structuredContent)).not.toContain('private paper body');
});

test('bounds model annotation context while preserving the complete App collection and excludes cancelled discovery', async () => {
  const { client, service } = await connect();
  service.listMarks = async () => ({ vaultId: 'test', paperPath: 'papers/sample', revision: 'r1', items: Array.from({ length: 130 }, (_, index) => ({ id: String(index), kind: 'highlight' as const, page: 1, space: 'pt' as const, rects: [{ x: 1, y: 1, w: 10, h: 2 }], quote: 'quoted text', note: '' })) });
  const result = await client.callTool({ name: 'mark_list', arguments: { vaultId: 'test', paperPath: 'papers/sample' } });
  expect(result.structuredContent).toMatchObject({ ok: true, data: { truncated: true } });
  expect((result.structuredContent as { data: { items: unknown[] } }).data.items).toHaveLength(100);
  expect((result._meta?.marks as { items: unknown[] }).items).toHaveLength(130);
  const tools = (await client.listTools()).tools;
  expect(tools.some(tool => tool.name === 'paper_discover')).toBe(false);
  for (const name of ['file_picker', 'paper_markdown', 'paper_layout', 'note_asset_read', 'mark_asset_read']) expect(tools.find(tool => tool.name === name)?._meta?.ui).toMatchObject({ visibility: ['app'] });
});

test('annotation mutations preserve full App results without bypassing the model result bound', async () => {
  const { client, service } = await connect();
  const marks = { vaultId: 'test', paperPath: 'papers/sample', revision: 'r2', items: Array.from({ length: 130 }, (_, index) => ({ id: String(index), kind: 'highlight' as const, page: 1, space: 'pt' as const, rects: [{ x: 1, y: 1, w: 10, h: 2 }], quote: `quoted item ${index}`, note: '' })) };
  service.addMark = async () => marks;
  service.updateMark = async () => marks;
  service.deleteMark = async () => marks;
  const shared = { vaultId: 'test', paperPath: 'papers/sample', revision: 'r1' };
  const cases = [
    { name: 'mark_add', arguments: { ...shared, kind: 'highlight', page: 1, rects: [{ x: 1, y: 1, w: 10, h: 2 }], pageSize: { width: 500, height: 700 }, quote: 'selected quote' } },
    { name: 'mark_update', arguments: { ...shared, id: '0', comment: 'saved comment' } },
    { name: 'mark_delete', arguments: { ...shared, id: '0' } },
  ];
  for (const input of cases) {
    const result = await client.callTool(input);
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: true, data: { revision: 'r2', truncated: true } });
    expect((result.structuredContent as { data: { items: unknown[] } }).data.items).toHaveLength(100);
    expect((result._meta?.marks as { items: unknown[] }).items).toHaveLength(130);
    expect(JSON.stringify(result.structuredContent)).not.toContain('quoted item 129');
  }
});

test('forwards MCP request cancellation into the default CLI translation branch', async () => {
  const { client, service } = await connect();
  service.validateScope = async () => {};
  let started!: () => void, cancelled!: () => void;
  const incoming = new Promise<void>(resolve => { started = resolve; });
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  service.translateText = async (_input, signal) => {
    expect(signal).toBeDefined();
    started();
    return new Promise((_, reject) => { signal!.addEventListener('abort', () => { cancelled(); reject(new Error('cancelled owned request')); }, { once: true }); });
  };
  const controller = new AbortController();
  const request = client.callTool({ name: 'translate_text', arguments: { vaultId: 'test', text: 'owned cancellation test' } }, undefined, { signal: controller.signal }).catch(error => error);
  await incoming;
  controller.abort();
  await request;
  await aborted;
});
