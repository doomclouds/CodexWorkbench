import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeBackend } from '../src/infrastructure/native-mcp.js';
import type { NativeContext } from '../src/contracts/types.js';

const execution = vi.hoisted(() => ({ spawn: vi.fn(), stop: vi.fn() }));
vi.mock('../src/infrastructure/cli.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/infrastructure/cli.js')>(),
  spawnOwned: execution.spawn,
  stopOwnedProcess: execution.stop,
}));

interface Rpc { jsonrpc: string; id?: number | string; method: string; params?: { name?: string; arguments?: Record<string, unknown> } }
interface Request { session: string; rpc: Rpc; response: ServerResponse }
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.clearAllMocks(); });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

async function fixture() {
  const parent = resolve(tmpdir()), root = await mkdtemp(join(parent, 'codex-native-session-'));
  cleanups.push(async () => {
    expect(dirname(root)).toBe(parent); expect(basename(root).startsWith('codex-native-session-')).toBe(true);
    await rm(root, { recursive: true, force: true });
  });
  const vault = join(root, '知识库 with spaces'); await mkdir(vault);
  const sessions = new Set<string>(), requests: Request[] = [], dispatched: Request[] = [];
  let initializations = 0, openVault = vault, mutations = 0;
  let intercept: ((request: Request) => Promise<boolean> | boolean) | undefined;
  const required = ['vault_list', 'paper_get', 'file_read', 'file_write', 'paper_notes_get', 'paper_notes_write', 'vault_search', 'file_list'];
  const json = (response: ServerResponse, id: Rpc['id'], result: unknown) => {
    response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
  };
  const missing = (response: ServerResponse) => { response.writeHead(404); response.end('Not Found: Session not found'); };
  const server = createServer((incoming: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (incoming.method === 'GET') { response.writeHead(405); response.end(); return; }
      if (incoming.method === 'DELETE') { sessions.delete(String(incoming.headers['mcp-session-id'] ?? '')); response.writeHead(200); response.end(); return; }
      const chunks: Buffer[] = []; for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const rpc = JSON.parse(Buffer.concat(chunks).toString()) as Rpc;
      const request = { session: String(incoming.headers['mcp-session-id'] ?? ''), rpc, response }; requests.push(request);
      if (await intercept?.(request)) return;
      if (rpc.method === 'initialize') {
        initializations += 1; const session = `session-${initializations}`; sessions.add(session);
        response.setHeader('mcp-session-id', session);
        json(response, rpc.id, { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'agentero', version: '0.15.2' } }); return;
      }
      if (!sessions.has(request.session)) { missing(response); return; }
      if (rpc.method === 'notifications/initialized') { response.writeHead(202); response.end(); return; }
      if (rpc.method === 'tools/list') { json(response, rpc.id, { tools: required.map(name => ({ name, inputSchema: { type: 'object' } })) }); return; }
      if (rpc.method === 'tools/call') {
        dispatched.push(request); const name = rpc.params?.name;
        if (name === 'file_write' || name === 'paper_notes_write') mutations += 1;
        const value = name === 'vault_list' ? { open: openVault } : { content: 'isolated note', entries: [], mutations };
        json(response, rpc.id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }); return;
      }
      throw new Error(`Unexpected test request: ${rpc.method}`);
    })().catch(error => { if (!response.headersSent) response.writeHead(500); response.end(String(error)); });
  });
  const child = Object.assign(new EventEmitter(), { stderr: new PassThrough(), stdout: new PassThrough(), exitCode: null as number | null, signalCode: null as NodeJS.Signals | null });
  let stopped: Promise<void> | undefined;
  const stop = () => stopped ??= new Promise<void>(done => {
    server.closeAllConnections();
    server.close(() => { child.exitCode = 0; child.emit('exit', 0); child.emit('close', 0); child.stderr.end(); child.stdout.end(); done(); });
  });
  cleanups.push(stop);
  execution.spawn.mockImplementation((_cli: string, args: string[]) => {
    const port = Number(args[args.indexOf('--listen') + 1].split(':')[1]);
    server.listen(port, '127.0.0.1', () => child.stderr.write(`MCP listening on http://127.0.0.1:${port}/mcp\n`));
    return child as unknown as ChildProcess;
  });
  execution.stop.mockImplementation(stop);
  const controller = new AbortController();
  const context: NativeContext = { dataRoot: join(root, 'plugin'), vaultPath: vault, signal: controller.signal, settings: { schemaVersion: 1, cliPath: 'owned-http-fixture', vaultPath: vault, vaultId: 'owned-vault', pdfiumPath: '', allowAgentPdfText: false } };
  const backend = await createNativeBackend(context); cleanups.push(() => backend.close());
  return {
    backend, controller, root, vault, requests, dispatched, missing, json,
    expire: () => sessions.clear(), get initializations() { return initializations; }, get mutations() { return mutations; },
    intercept: (handler: typeof intercept) => { intercept = handler; },
    setVault: (path: string) => { openVault = path; },
  };
}

describe('native MCP session recovery over real HTTP', () => {
  it('reinitializes an expired session and retries a read without restarting the CLI', async () => {
    const f = await fixture(); f.expire();
    await expect(f.backend.call('file_list', { path: 'notes' })).resolves.toMatchObject({ entries: [] });
    expect(f.initializations).toBe(2); expect(execution.spawn).toHaveBeenCalledTimes(1); expect(execution.stop).not.toHaveBeenCalled();
    expect(f.requests.filter(item => item.rpc.params?.name === 'file_list')).toHaveLength(2);
    expect(f.dispatched.filter(item => item.rpc.params?.name === 'file_list')).toHaveLength(1);
  });

  it('shares recovery across concurrent stale-session errors, including late old responses', async () => {
    const f = await fixture(), held = deferred(), release = deferred();
    f.intercept(async request => {
      if (request.session === 'session-1' && request.rpc.params?.name === 'file_read') {
        held.resolve(); await release.promise; f.missing(request.response); return true;
      }
      return false;
    });
    f.expire(); const late = f.backend.call('file_read', { path: 'notes/a.md' }); await held.promise;
    await expect(Promise.all(Array.from({ length: 4 }, () => f.backend.call('file_list', { path: 'notes' })))).resolves.toHaveLength(4);
    release.resolve(); await expect(late).resolves.toMatchObject({ content: 'isolated note' });
    expect(f.initializations).toBe(2); expect(execution.spawn).toHaveBeenCalledTimes(1); expect(execution.stop).not.toHaveBeenCalled();
  });

  it('bounds a repeatedly expiring read to one recovery attempt', async () => {
    const f = await fixture();
    f.intercept(request => { if (request.rpc.params?.name === 'file_list') { f.missing(request.response); return true; } return false; });
    await expect(f.backend.call('file_list', { path: 'notes' })).rejects.toMatchObject({ code: 'UPSTREAM_SESSION_EXPIRED' });
    expect(f.initializations).toBe(2); expect(f.requests.filter(item => item.rpc.params?.name === 'file_list')).toHaveLength(2);
  });

  it('recovers the connection but never replays a write rejected by an expired session', async () => {
    const f = await fixture(); f.expire();
    await expect(f.backend.call('file_write', { path: 'notes/a.md', content: 'one', mode: 'append' })).rejects.toMatchObject({ code: 'UPSTREAM_SESSION_EXPIRED' });
    expect(f.initializations).toBe(2); expect(f.mutations).toBe(0);
    expect(f.requests.filter(item => item.rpc.params?.name === 'file_write')).toHaveLength(1);
    await expect(f.backend.call('file_list', { path: 'notes' })).resolves.toMatchObject({ entries: [] });
    expect(f.initializations).toBe(2);
  });

  it.each([500, 403])('does not reinterpret HTTP %s as session expiry or retry a read', async status => {
    const f = await fixture();
    f.intercept(request => { if (request.rpc.params?.name === 'file_list') { request.response.writeHead(status); request.response.end('isolated transport failure'); return true; } return false; });
    await expect(f.backend.call('file_list', { path: 'notes' })).rejects.toMatchObject({ code: 'UPSTREAM_CLOSED' });
    expect(f.initializations).toBe(1); expect(f.requests.filter(item => item.rpc.params?.name === 'file_list')).toHaveLength(1);
  });

  it('does not retry an ambiguously completed write after its response socket closes', async () => {
    const f = await fixture(); let writes = 0;
    f.intercept(request => { if (request.rpc.params?.name === 'file_write') { writes += 1; request.response.destroy(); return true; } return false; });
    await expect(f.backend.call('file_write', { path: 'notes/a.md', content: 'one', mode: 'append' })).rejects.toMatchObject({ code: 'UPSTREAM_CLOSED' });
    expect(writes).toBe(1); expect(f.initializations).toBe(1);
  });

  it('does not invalidate a renewed connection when an older request later returns HTTP 500', async () => {
    const f = await fixture(), entered = deferred(), release = deferred();
    f.intercept(async request => {
      if (request.session === 'session-1' && request.rpc.params?.name === 'file_read') {
        entered.resolve(); await release.promise; request.response.writeHead(500); request.response.end('old request failed'); return true;
      }
      return false;
    });
    const delayed = f.backend.call('file_read', { path: 'notes/a.md' }).catch(error => error); await entered.promise;
    f.expire(); await expect(f.backend.call('file_list', { path: 'notes' })).resolves.toMatchObject({ entries: [] });
    release.resolve(); expect(await delayed).toMatchObject({ code: 'UPSTREAM_REQUEST_FAILED' });
    await expect(f.backend.call('file_list', { path: 'notes' })).resolves.toMatchObject({ entries: [] });
    expect(f.initializations).toBe(2); expect(execution.stop).not.toHaveBeenCalled();
  });

  it('does not invalidate a replacement handshake when an older request returns HTTP 500', async () => {
    const f = await fixture(), entered = deferred(), release = deferred(), initializing = deferred(), finishInitialization = deferred();
    f.intercept(async request => {
      if (request.session === 'session-1' && request.rpc.params?.name === 'file_read') {
        entered.resolve(); await release.promise; request.response.writeHead(500); request.response.end('old request failed'); return true;
      }
      if (request.rpc.method === 'initialize') { initializing.resolve(); await finishInitialization.promise; }
      return false;
    });
    const delayed = f.backend.call('file_read', { path: 'notes/a.md' }).catch(error => error); await entered.promise;
    f.expire(); const renewing = f.backend.call('file_list', { path: 'notes' }); await initializing.promise;
    release.resolve(); const failure = await delayed; finishInitialization.resolve();
    expect(failure).toMatchObject({ code: 'UPSTREAM_REQUEST_FAILED' });
    await expect(renewing).resolves.toMatchObject({ entries: [] });
    expect(f.initializations).toBe(2); expect(execution.stop).not.toHaveBeenCalled();
  });

  it('lets an accepted write finish while a concurrent query renews the session', async () => {
    const f = await fixture(), entered = deferred(), release = deferred(); let writes = 0;
    f.intercept(async request => {
      if (request.rpc.params?.name === 'file_write') {
        writes += 1; entered.resolve(); await release.promise;
        f.json(request.response, request.rpc.id, { content: [{ type: 'text', text: JSON.stringify({ saved: true }) }], structuredContent: { saved: true } }); return true;
      }
      return false;
    });
    const writing = f.backend.call('file_write', { path: 'notes/a.md', content: 'one', mode: 'append' }); await entered.promise;
    f.expire(); await expect(f.backend.call('file_list', { path: 'notes' })).resolves.toMatchObject({ entries: [] });
    release.resolve(); await expect(writing).resolves.toMatchObject({ saved: true });
    expect(writes).toBe(1); expect(f.initializations).toBe(2); expect(execution.stop).not.toHaveBeenCalled();
  });

  it('validates the Vault again before retrying a read in the new session', async () => {
    const f = await fixture(), other = join(f.root, 'other'); await mkdir(other); f.setVault(other); f.expire();
    await expect(f.backend.call('file_list', { path: 'notes' })).rejects.toMatchObject({ code: 'VAULT_CHANGED' });
    expect(f.requests.filter(item => item.rpc.params?.name === 'file_list')).toHaveLength(1);
    expect(f.dispatched.filter(item => item.rpc.params?.name === 'file_list')).toHaveLength(0);
  });

  it('cancels an in-flight recovery when the backend closes and never reconnects afterward', async () => {
    const f = await fixture(), entered = deferred();
    f.intercept(request => { if (request.rpc.method === 'initialize') { entered.resolve(); return true; } return false; });
    f.expire(); const pending = f.backend.call('file_list', { path: 'notes' }).catch(error => error);
    await entered.promise; await f.backend.close();
    expect(await pending).toMatchObject({ code: 'SERVICE_CLOSED' });
    await expect(f.backend.call('file_list', { path: 'notes' })).rejects.toMatchObject({ code: 'SERVICE_CLOSED' });
    expect(f.requests.filter(item => item.rpc.method === 'initialize')).toHaveLength(2); expect(execution.spawn).toHaveBeenCalledTimes(1);
  });

  it('honors abort while a replacement session is initializing', async () => {
    const f = await fixture(), entered = deferred();
    f.intercept(request => { if (request.rpc.method === 'initialize') { entered.resolve(); return true; } return false; });
    f.expire(); const pending = f.backend.call('file_list', { path: 'notes' }).catch(error => error);
    await entered.promise; f.controller.abort();
    expect(await pending).toMatchObject({ code: 'SERVICE_CLOSED' });
    expect(f.requests.filter(item => item.rpc.method === 'initialize')).toHaveLength(2);
  });
});
