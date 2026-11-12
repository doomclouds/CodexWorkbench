import { once } from 'node:events';
import { createServer } from 'node:net';
import { realpath } from 'node:fs/promises';
import { normalize } from 'node:path';
import type { NativeBackend, NativeContext } from '../contracts/types.js';
import { LibraryError } from '../contracts/errors.js';
import { PLUGIN_VERSION } from '../contracts/version.js';
import { cliEnvironment, spawnOwned, stopOwnedProcess } from './cli.js';

// Only operations without writes or external side effects may be replayed.
const replayableReads = new Set(['vault_list', 'paper_get', 'paper_paths', 'vault_search', 'page_read', 'paper_text_get', 'file_read', 'file_list', 'paper_notes_get']);

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new LibraryError('UPSTREAM_FAILED', '无法分配本机端口。');
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

export function unwrapNative(result: Record<string, unknown>): Record<string, unknown> {
  const content = Array.isArray(result.content) ? result.content as { type?: string; text?: string }[] : [];
  if (result.isError) {
    let code = 'UPSTREAM_FAILED';
    let message = 'Agentero 操作失败。';
    for (const item of content) if (item.type === 'text' && item.text) {
      try { const error = JSON.parse(item.text); code = error.code ?? code; message = error.message ?? message; } catch { message = item.text; }
      break;
    }
    if (/pdfium|pdf engine|libraryunavailable/i.test(message)) throw new LibraryError('PDF_ENGINE_UNAVAILABLE', 'PDF 原生引擎不可用，请配置 PDFium。');
    throw new LibraryError(code === 'message' ? 'UPSTREAM_FAILED' : code, message.slice(0, 2000));
  }
  if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent as Record<string, unknown>;
  for (const item of content) if (item.type === 'text' && item.text) {
    try { return JSON.parse(item.text) as Record<string, unknown>; } catch { /* try another block */ }
  }
  throw new LibraryError('UPSTREAM_INVALID', 'Agentero 返回了无效的结构化结果。');
}

export async function createNativeBackend(context: NativeContext): Promise<NativeBackend> {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport, StreamableHTTPError } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (context.signal?.aborted) throw new LibraryError('SERVICE_CLOSED', '连接已取消。');
    const port = await freePort();
    const args = ['mcp', 'serve', '--vault', context.vaultPath, '--listen', `127.0.0.1:${port}`];
    if (context.settings.allowAgentPdfText) args.push('--expose-paper-text');
    const environment = await cliEnvironment(context.dataRoot, context.settings.pdfiumPath);
    if (context.signal?.aborted) throw new LibraryError('SERVICE_CLOSED', '连接已取消。');
    const child = spawnOwned(context.settings.cliPath, args, environment);
    let stderr = '';
    type Connection = { client: InstanceType<typeof Client>; active: number; retired: boolean; closing?: Promise<void> };
    const connections = new Set<Connection>();
    let current: Connection;
    let reconnecting: Promise<Connection> | undefined;
    let closed = false;
    let closing: Promise<void> | undefined;
    const ensureConnected = () => {
      if (closed || context.signal?.aborted) throw new LibraryError('SERVICE_CLOSED', '连接已取消。');
      if (child.exitCode !== null || child.signalCode !== null) throw new LibraryError('UPSTREAM_CLOSED', 'Agentero MCP 已断开，请重新连接。', true);
    };
    const closeConnection = (connection: Connection): Promise<void> => {
      connection.closing ??= connection.client.close().finally(() => { connections.delete(connection); });
      return connection.closing;
    };
    const release = (connection: Connection) => {
      connection.active -= 1;
      if (connection.retired && !connection.active) void closeConnection(connection).catch(() => undefined);
    };
    const abort = () => { void close(); };
    const close = (): Promise<void> => {
      if (closing) return closing;
      closed = true;
      context.signal?.removeEventListener('abort', abort);
      closing = (async () => {
        try {
          await Promise.allSettled([...connections].map(closeConnection));
          await reconnecting?.catch(() => undefined);
        } finally { await stopOwnedProcess(child); }
      })();
      return closing;
    };
    const connect = async (): Promise<Connection> => {
      ensureConnected();
      const connection: Connection = { client: new Client({ name: 'codex-workbench-agentero-library', version: PLUGIN_VERSION }, { capabilities: {} }), active: 0, retired: false };
      connections.add(connection);
      const { client } = connection;
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)), { timeout: 10_000 });
        ensureConnected();
        const info = client.getServerVersion();
        if (info?.name !== 'agentero' || info.version !== '0.15.2') throw new LibraryError('CLI_UNSUPPORTED', '原生 MCP 版本与受支持的 Agentero 0.15.2 不符。');
        const required = new Set(['vault_list', 'paper_get', 'file_read', 'file_write', 'paper_notes_get', 'paper_notes_write', 'vault_search']);
        let cursor: string | undefined;
        do {
          const list = await client.listTools(cursor ? { cursor } : {}, { timeout: 10_000 });
          for (const tool of list.tools) required.delete(tool.name);
          cursor = list.nextCursor;
        } while (cursor);
        if (required.size) throw new LibraryError('CLI_UNSUPPORTED', `原生 MCP 缺少必要工具：${[...required].join(', ')}`);
        const vaults = unwrapNative(await client.callTool({ name: 'vault_list', arguments: {} }, undefined, { timeout: 10_000 }) as Record<string, unknown>);
        if (typeof vaults.open !== 'string') throw new LibraryError('UPSTREAM_INVALID', '原生 MCP 未确认当前知识库。');
        const actual = normalize(await realpath(vaults.open));
        const expected = normalize(await realpath(context.vaultPath));
        if (actual !== expected) throw new LibraryError('VAULT_CHANGED', '原生 MCP 连接到不同的知识库。');
        ensureConnected();
        return connection;
      } catch (error) {
        await closeConnection(connection).catch(() => undefined);
        ensureConnected();
        throw error;
      }
    };
    const reconnect = async (expired: Connection): Promise<Connection> => {
      ensureConnected();
      if (current !== expired) return current;
      if (!reconnecting) {
        const pending = connect().then(next => {
          ensureConnected();
          current = next;
          expired.retired = true;
          // Let concurrent requests finish before closing their old client.
          if (!expired.active) void closeConnection(expired).catch(() => undefined);
          return next;
        });
        reconnecting = pending;
        void pending.then(() => { if (reconnecting === pending) reconnecting = undefined; }, () => { if (reconnecting === pending) reconnecting = undefined; });
      }
      return reconnecting;
    };
    context.signal?.addEventListener('abort', abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new LibraryError('UPSTREAM_TIMEOUT', 'Agentero MCP 启动超时。', true)), 10_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Agentero MCP exited (${code}): ${stderr.slice(-1200)}`)); });
        child.stderr?.on('data', chunk => {
          stderr = (stderr + String(chunk)).slice(-8192);
          if (stderr.includes(`MCP listening on http://127.0.0.1:${port}/mcp`)) { clearTimeout(timer); resolve(); }
        });
      });
      current = await connect();
      const call = async (name: string, arguments_: Record<string, unknown>) => {
        let connection = current;
        for (let retry = 0; ; retry += 1) {
          ensureConnected();
          let result;
          let failure: unknown;
          connection.active += 1;
          try { result = await connection.client.callTool({ name, arguments: arguments_ }, undefined, { timeout: 120_000 }); }
          catch (error) { failure = error; }
          finally { release(connection); }
          if (!failure) return unwrapNative(result as Record<string, unknown>);
          ensureConnected();
          if (failure instanceof StreamableHTTPError && failure.code === 404) {
            if (retry > 0) throw new LibraryError('UPSTREAM_SESSION_EXPIRED', 'Agentero 连接恢复后仍已失效，请稍后重试。', true);
            try { connection = await reconnect(connection); }
            catch (error) {
              if (error instanceof LibraryError) throw error;
              throw new LibraryError('UPSTREAM_CLOSED', 'Agentero 重新连接失败，请稍后重试。', true);
            }
            if (replayableReads.has(name)) continue;
            throw new LibraryError('UPSTREAM_SESSION_EXPIRED', 'Agentero 连接已过期并已重新连接；本次修改未自动重试，请核实结果后重试。', true);
          }
          // An older request must not invalidate a successfully renewed session.
          throw new LibraryError(connection === current && !reconnecting ? 'UPSTREAM_CLOSED' : 'UPSTREAM_REQUEST_FAILED', `Agentero MCP 请求未完成，请核实结果后重试：${failure instanceof Error ? failure.message.slice(0, 1000) : '连接中断'}`, true);
        }
      };
      return { call, close };
    } catch (error) { lastError = error; await close().catch(() => undefined); if (context.signal?.aborted) throw new LibraryError('SERVICE_CLOSED', '连接已取消。'); }
  }
  if (lastError instanceof LibraryError) throw lastError;
  throw new LibraryError('UPSTREAM_FAILED', `无法启动本插件的 Agentero MCP：${lastError instanceof Error ? lastError.message.slice(0, 1500) : '未知错误'}`, true);
}
