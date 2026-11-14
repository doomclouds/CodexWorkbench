import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TOOL_NAMES, type Actor, type ToolResponse } from '../src/contracts/studio.js';
import { APP_TOOL_NAME } from '../src/contracts/transport.js';
import { StudioService } from '../src/core/service.js';
import { createStudioServer, type StudioExecutionContext } from '../src/server/protocol.js';

const actor: Actor = { id: 'codex', name: 'Codex', kind: 'agent', role: 'owner' };
let directory: string, service: StudioService, server: ReturnType<typeof createStudioServer>, client: Client, artifactId: string;
let execution: { name: string; args: Record<string, unknown>; context?: StudioExecutionContext } | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-mcp-contract-'));
  service = new StudioService({ dataRoot: directory });
  execution = undefined;
  server = createStudioServer({ execute: (name, args, context) => { execution = { name, args, context }; return service.execute(name, args, actor); }, connection: async () => ({ baseUrl: 'http://127.0.0.1:12345', token: 'test-only', actor }) }, '<!doctype html><html></html>');
  client = new Client({ name: 'studio-contract-regression', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  artifactId = (await call('artifact_manage', { action: 'create' })).artifact.id;
});
afterEach(async () => {
  await client?.close(); await server?.close(); await service?.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
});
async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const result = await client.callTool({ name, arguments: { artifactId, ...args } });
  expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
  const body = result.structuredContent as unknown as ToolResponse;
  expect(body.ok).toBe(true); return body.data;
}
async function failure(name: string, args: Record<string, unknown>, code?: string) {
  const result = await client.callTool({ name, arguments: { artifactId, ...args } });
  expect(result.isError).toBe(true);
  if (code) expect(result.structuredContent).toMatchObject({ ok: false, error: { code } });
  else expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text' })]));
}
const add = (elements: Record<string, unknown>[]) => call('artifact_apply', { operationId: randomUUID(), operations: elements.map(element => ({ op: 'add', element })) });

describe('model MCP contracts through the real SDK', () => {
  it('preserves explicit Agent participants and documented MCP client identity through schema parsing', async () => {
    await call('artifact_read', { mode: 'summary', participant: { id: 'review-agent', name: 'Reviewer' } });
    expect(execution).toMatchObject({ name: 'artifact_read', args: { participant: { id: 'review-agent', name: 'Reviewer' } }, context: { clientInfo: { name: 'studio-contract-regression', version: '1.0.0' } } });
    const { tools } = await client.listTools();
    for (const tool of tools.filter(tool => TOOL_NAMES.includes(tool.name as typeof TOOL_NAMES[number]))) {
      expect((tool.inputSchema.properties as Record<string, any>).participant.properties.id.maxLength).toBe(120);
    }
    expect((tools.find(tool => tool.name === 'artifact_apply')!.inputSchema.properties as Record<string, any>).merge.const).toBe('safe');
  });
  it('publishes coordinate/version/lock semantics with eight model tools and one app-only transport', async () => {
    const { tools } = await client.listTools();
    const visible = tools.filter(tool => !(tool._meta?.ui as { visibility?: string[] } | undefined)?.visibility || (tool._meta?.ui as { visibility: string[] }).visibility.includes('model'));
    expect(visible.map(tool => tool.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools).toHaveLength(9);
    expect(tools.find(tool => tool.name === APP_TOOL_NAME)?._meta).toMatchObject({ ui: { visibility: ['app'] } });
    const feedback = tools.find(tool => tool.name === 'artifact_feedback')!, fields = feedback.inputSchema.properties as Record<string, any>;
    expect(fields.versions).toMatchObject({ type: 'object', description: expect.stringContaining('选取时') });
    expect(fields.operationId.description).toContain('重试');
    expect(fields.anchor.properties.coordinateSpace.enum).toEqual(['board', 'element', 'html']);
    expect(fields.anchor.properties.coordinateSpace.description).toContain('CSS 像素');
    const apply = tools.find(tool => tool.name === 'artifact_apply')!, applyFields = apply.inputSchema.properties as Record<string, any>;
    expect(applyFields.operations.items.properties.changes.properties.locked).toMatchObject({ type: 'boolean', description: expect.stringContaining('仍可更新') });
    expect(apply.description).toContain('同批解锁');
    const manage = tools.find(tool => tool.name === 'artifact_manage')!, manageFields = manage.inputSchema.properties as Record<string, any>;
    expect(manageFields.action.enum).toContain('purge');
    expect(manageFields.artifactIds).toMatchObject({ type: 'array', minItems: 1, maxItems: 100, description: expect.stringContaining('二选一') });
    expect(manage.annotations?.destructiveHint).toBe(true);
    expect(tools.some(tool => /reader/.test(tool.name))).toBe(false);
  });

  it('preserves create versions through schema parsing, freezes the clicked native source and deduplicates retries', async () => {
    await add([{ id: 'native', type: 'text', text: 'Clicked content', x: 10, y: 20 }]);
    await call('artifact_apply', { expectedVersions: { native: 1 }, operations: [{ op: 'update', id: 'native', changes: { text: 'Current content', x: 500 } }] });
    const args = { action: 'create', operationId: randomUUID(), text: 'Review clicked content', versions: { native: 1 }, anchor: { coordinateSpace: 'element', elementIds: ['native'], x: .25, y: .75 } };
    const first = await call('artifact_feedback', args), retry = await call('artifact_feedback', args);
    expect(retry.contextId).toBe(first.contextId); expect(retry.feedback).toHaveLength(1);
    expect(first.feedback[0]).toMatchObject({ versions: { native: 1 }, anchor: args.anchor });
    const context = await call('artifact_read', { mode: 'context', contextId: first.contextId });
    expect(context.sources[0]).toMatchObject({ elementId: 'native', version: 1, element: { text: 'Clicked content', x: 10, y: 20, version: 1 } });
    await failure('artifact_feedback', { ...args, versions: { native: 2 } }, 'OPERATION_REUSED');
    await failure('artifact_feedback', { ...args, operationId: randomUUID(), versions: { native: 99 } }, 'CONFLICT');
    await failure('artifact_feedback', { ...args, operationId: randomUUID(), versions: {} }, 'INVALID_ARGUMENT');
  });

  it('roundtrips immutable display batches, adjacent unit diffs and CAS-protected partial restore', async () => {
    const first = await add([{ id: 'a', type: 'text', text: 'A' }, { id: 'b', type: 'text', text: 'B' }]);
    const second = await call('artifact_apply', { expectedVersions: { a: 1, b: 1 }, operations: [{ op: 'update', id: 'a', changes: { text: 'A2' } }, { op: 'update', id: 'b', changes: { text: 'B2' } }] });
    const history = await call('artifact_read', { mode: 'history' });
    expect(history.history).toHaveLength(3);
    expect(history.batches.at(-1)).toMatchObject({ id: second.historyEntry.id, firstVersionId: first.historyEntry.id, versionIds: [first.historyEntry.id, second.historyEntry.id] });
    const adjacent = await call('artifact_read', { mode: 'diff', versionId: first.historyEntry.id, adjacent: true, ids: ['a'] });
    expect(adjacent.units).toEqual([{ id: 'a', before: null, after: expect.objectContaining({ text: 'A', version: 1 }) }]);
    const selected = await call('artifact_read', { mode: 'diff', fromVersionId: first.historyEntry.id, toVersionId: second.historyEntry.id, ids: ['a'] });
    expect(selected.units).toEqual([{ id: 'a', before: expect.objectContaining({ text: 'A' }), after: expect.objectContaining({ text: 'A2' }) }]);
    const args = { operationId: randomUUID(), expectedVersions: { a: 2 }, operations: [{ op: 'restore', versionId: first.historyEntry.id, ids: ['a'] }] };
    const restored = await call('artifact_apply', args);
    expect(restored.historyEntry).toMatchObject({ changedIds: ['a'], restoredFrom: first.historyEntry.id });
    expect(await call('artifact_apply', args)).toEqual(restored);
    const objects = await call('artifact_read', { mode: 'objects', ids: ['a', 'b'] });
    expect(objects.elements).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'a', text: 'A', version: 3 }), expect.objectContaining({ id: 'b', text: 'B2', version: 2 })]));
    await failure('artifact_apply', { ...args, operationId: randomUUID() }, 'CONFLICT');
  });

  it('roundtrips the order unit clock and safely undoes and redoes real layer changes', async () => {
    await add(['a', 'b', 'c'].map(id => ({ id, type: 'text', text: id })));
    const baseline = await call('artifact_read', { mode: 'objects', ids: ['$order'] });
    expect(baseline.units).toEqual([{ id: '$order', value: { version: 3, ids: ['a', 'b', 'c'] } }]);
    const reordered = await call('artifact_apply', { expectedVersions: { a: 1, $order: baseline.orderVersion }, operations: [{ op: 'layout', preset: 'front', ids: ['a'] }] });
    expect(reordered.historyEntry.changedIds).toEqual(['a', '$order']);
    const undo = await call('artifact_apply', { expectedRevision: reordered.artifact.revision, operations: [{ op: 'restore', versionId: reordered.historyEntry.id, data: { mode: 'undo' } }] });
    expect((await call('artifact_read', { mode: 'objects' })).elements.map((element: { id: string }) => element.id)).toEqual(['a', 'b', 'c']);
    await call('artifact_apply', { expectedRevision: undo.artifact.revision, operations: [{ op: 'restore', versionId: undo.historyEntry.id, data: { mode: 'undo' } }] });
    const result = await call('artifact_read', { mode: 'objects' });
    expect(result.orderVersion).toBe(6); expect(result.elements.map((element: { id: string }) => element.id)).toEqual(['b', 'c', 'a']);
    await failure('artifact_apply', { expectedVersions: { b: 1, $order: baseline.orderVersion }, operations: [{ op: 'layout', preset: 'front', ids: ['b'] }] }, 'CONFLICT');
  });

  it('roundtrips all coordinate spaces and rejects invalid coordinates or versions at the protocol/domain boundary', async () => {
    await add([{ id: 'native', type: 'shape' }, { id: 'region', type: 'html', html: '<h1>Original</h1>' }]);
    const anchors = [
      { coordinateSpace: 'board', x: -300, y: 800, w: 400, h: 250 },
      { coordinateSpace: 'element', elementIds: ['native'], x: .2, y: .8 },
      { coordinateSpace: 'html', regionId: 'region', sourceRevision: 1, x: 30, y: 40, w: 120, h: 60 },
    ];
    for (const anchor of anchors) {
      const versions = anchor.regionId ? { region: 1 } : anchor.elementIds ? { native: 1 } : {};
      const result = await call('artifact_feedback', { action: 'create', text: 'Target', anchor, versions });
      expect(result.feedback[0].anchor).toEqual(anchor);
    }
    await failure('artifact_feedback', { action: 'create', text: 'Invalid', anchor: { coordinateSpace: 'screen' } });
    await failure('artifact_feedback', { action: 'create', text: 'Invalid', anchor: { coordinateSpace: 'element', elementIds: ['native'], x: 1.1 } }, 'INVALID_ARGUMENT');
    await failure('artifact_feedback', { action: 'create', text: 'Invalid', anchor: { coordinateSpace: 'html' } }, 'INVALID_ARGUMENT');
    await failure('artifact_feedback', { action: 'create', text: 'Invalid', anchor: { coordinateSpace: 'board', w: -1 } });
    await failure('artifact_feedback', { action: 'create', text: 'Invalid', anchor: { elementIds: ['native'] }, versions: { native: 0 } });
  });

  it('accepts locked content edits over MCP and refuses geometry or batch-unlock bypasses', async () => {
    await add([{ id: 'region', type: 'html', locked: true, html: '<h1>Original</h1>', x: 20, y: 30, w: 600, h: 400 }]);
    await call('artifact_apply', { expectedVersions: { region: 1 }, operations: [{ op: 'update', id: 'region', changes: { html: '<h2>Changed</h2>', state: { tab: 2 }, fill: '#abcdef' } }] });
    await failure('artifact_apply', { expectedVersions: { region: 2 }, operations: [{ op: 'update', id: 'region', changes: { x: 100 } }] }, 'LOCKED');
    await failure('artifact_apply', { expectedVersions: { region: 2 }, operations: [{ op: 'update', id: 'region', changes: { locked: false } }, { op: 'delete', id: 'region' }] }, 'LOCKED');
    const document = await call('artifact_read', { mode: 'objects', ids: ['region'] });
    expect(document.elements[0]).toMatchObject({ locked: true, x: 20, html: '<h2>Changed</h2>', state: { tab: 2 }, fill: '#abcdef', version: 2 });
  });

  it('roundtrips single permanent deletion only after trashing and rejects malformed batches before deletion', async () => {
    expect(await call('artifact_manage', { action: 'purge' })).toMatchObject({ deletedIds: [], failures: [{ artifactId, code: 'NOT_TRASHED' }] });
    await call('artifact_manage', { action: 'trash' });
    await failure('artifact_manage', { action: 'purge', artifactIds: [artifactId] }, 'INVALID_ARGUMENT');
    await failure('artifact_manage', { action: 'purge', artifactId: undefined }, 'INVALID_ARGUMENT');
    await failure('artifact_manage', { action: 'purge', artifactId: undefined, artifactIds: [] });
    await failure('artifact_manage', { action: 'purge', artifactId: undefined, artifactIds: Array.from({ length: 101 }, () => artifactId) });
    expect((await call('artifact_list', { trashed: true })).artifacts.map((item: { id: string }) => item.id)).toContain(artifactId);
    expect(await call('artifact_manage', { action: 'purge' })).toEqual({ deletedIds: [artifactId], failures: [] });
    await failure('artifact_read', { mode: 'summary' }, 'NOT_FOUND');
  });

  it('roundtrips batch permanent deletion with deduplication and explicit active/missing failures', async () => {
    const second = (await call('artifact_manage', { action: 'create', title: 'Second trash entry' })).artifact.id;
    const active = (await call('artifact_manage', { action: 'create', title: 'Keep active' })).artifact.id;
    await call('artifact_manage', { action: 'trash' });
    await call('artifact_manage', { action: 'trash', artifactId: second });
    const result = await client.callTool({ name: 'artifact_manage', arguments: { action: 'purge', artifactIds: [artifactId, second, artifactId, active, 'missing-work'] } });
    expect(result.isError).not.toBe(true);
    const data = (result.structuredContent as unknown as ToolResponse<any>).data;
    expect(data.deletedIds).toEqual([artifactId, second]);
    expect(data.failures).toMatchObject([{ artifactId: active, code: 'NOT_TRASHED' }, { artifactId: 'missing-work', code: 'NOT_FOUND' }]);
    expect((await call('artifact_list', {})).artifacts.map((item: { id: string }) => item.id)).toEqual([active]);
    expect((await call('artifact_list', { trashed: true })).artifacts).toEqual([]);
  });

  it('keeps native frozen elements in model context while paginating HTML without its nested duplicate', async () => {
    const html = `<section><p>${'Original diagram 🎨 '.repeat(20_000)}</p></section>`;
    expect(html.length).toBeGreaterThan(240_000);
    await add([{ id: 'native', type: 'text', text: 'Frozen native' }, { id: 'region', type: 'html', html }]);
    const feedback = await call('artifact_feedback', { action: 'create', text: 'Mixed selection', anchor: { coordinateSpace: 'board', elementIds: ['native', 'region'], x: 0, y: 0, w: 800, h: 600 }, versions: { native: 1, region: 1 } });
    await call('artifact_apply', { expectedVersions: { native: 1, region: 1 }, operations: [{ op: 'update', id: 'native', changes: { text: 'Current native' } }, { op: 'update', id: 'region', changes: { html: '<p>Current HTML</p>' } }] });
    const context = await call('artifact_read', { mode: 'context', feedbackId: feedback.contextId });
    expect(context.sources[0]).toMatchObject({ elementId: 'native', element: { text: 'Frozen native', version: 1 } });
    expect(context.sources[1]).toMatchObject({ regionId: 'region', sourceRevision: 1, htmlLength: html.length, element: { version: 1 }, readWith: expect.stringContaining('source') });
    expect(context.sources[1]).not.toHaveProperty('html'); expect(context.sources[1].element).not.toHaveProperty('html');
    expect(JSON.stringify(context).length).toBeLessThan(10_000);
    const native = await call('artifact_read', { mode: 'source', feedbackId: feedback.contextId, elementId: 'native' });
    expect(native.element.text).toBe('Frozen native'); expect(native).not.toHaveProperty('sources');
    let offset = 0, combined = '';
    do {
      const page = await call('artifact_read', { mode: 'source', feedbackId: feedback.contextId, regionId: 'region', offset, limit: 64_000 });
      expect(page.totalLength).toBe(html.length); expect(page.element).not.toHaveProperty('html'); expect(page).not.toHaveProperty('sources');
      expect(JSON.stringify(page).length).toBeLessThan(70_000);
      combined += page.html; offset = page.nextOffset ?? -1;
    } while (offset >= 0);
    expect(combined).toBe(html);
  });
});
