import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Actor, Connection, ToolName, ToolResponse } from '../contracts/studio.js';
import type { StudioExecutionContext } from './protocol.js';
import { object, StudioError, text } from '../core/shared/common.js';
import type { UiHttpRequest } from '../contracts/transport.js';
import { validateUiRequest } from './app-transport.js';
import { SERVICE_PROTOCOL_VERSION } from './service-protocol.js';
import { PLUGIN_VERSION } from '../contracts/version.js';

export const dataDirectory = (value?: string) => resolve(value || process.env.AGENTERO_STUDIO_DATA_ROOT || join(homedir(), '.codexworkbench', 'agentero-studio'));
export interface ServiceRecord { origin: string; token: string; pid: number; instanceId: string }
export async function readRecord(root: string): Promise<ServiceRecord | undefined> {
  try { const value = JSON.parse(await readFile(join(root, 'service.json'), 'utf8')); if (value.origin && value.token && value.pid) return value; } catch { /* A stopped service has no usable record. */ }
}
async function probe(root: string) {
  const record = await readRecord(root);
  if (!record) return;
  try {
    const url = new URL(record.origin);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') return;
    const response = await fetch(`${record.origin}/api/session`, { headers: { Authorization: `Bearer ${record.token}` }, signal: AbortSignal.timeout(1500) });
    if (response.ok) {
      const session = await response.json() as { owner?: boolean; serviceProtocol?: unknown; pluginVersion?: unknown };
      if (session.owner !== true || session.serviceProtocol !== SERVICE_PROTOCOL_VERSION || session.pluginVersion !== PLUGIN_VERSION) throw new StudioError('SERVICE_PROTOCOL_MISMATCH', `正在运行的 Studio 服务版本与当前插件 ${PLUGIN_VERSION} 不兼容。请关闭旧版本白板窗口、重启插件后再打开；未启动第二个数据服务。`, { expected: SERVICE_PROTOCOL_VERSION, actual: session.serviceProtocol ?? null, expectedVersion: PLUGIN_VERSION, actualVersion: session.pluginVersion ?? null });
      return record;
    }
  } catch (error) { if (error instanceof StudioError && error.code === 'SERVICE_PROTOCOL_MISMATCH') throw error; /* Start a replacement only after acquiring the startup lock. */ }
}
export async function writeRecord(root: string, record: ServiceRecord) {
  await mkdir(root, { recursive: true });
  const target = join(root, 'service.json');
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await rename(temp, target);
}
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export async function connectStudio(root = dataDirectory(), entry = fileURLToPath(import.meta.url)) {
  await mkdir(root, { recursive: true });
  let record = await probe(root);
  if (!record) {
    const existing = await readRecord(root);
    if (existing && isAlive(existing.pid)) {
      for (let attempt = 0; attempt < 6 && !record; attempt++) { await delay(300); record = await probe(root); }
      if (!record) throw new Error('Studio 服务进程仍在运行，但暂时没有响应；请稍后重试，未另起第二个数据服务。');
    }
  }
  if (!record) {
    const lock = join(root, 'startup.lock');
    let acquired = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await mkdir(lock); await writeFile(join(lock, 'owner'), String(process.pid)); acquired = true; break; }
      catch {
        record = await probe(root); if (record) break;
        try { const pid = Number(await readFile(join(lock, 'owner'), 'utf8')); if (pid && !isAlive(pid)) { await unlink(join(lock, 'owner')); const { rmdir } = await import('node:fs/promises'); await rmdir(lock); } } catch { /* Another starter may be releasing the lock. */ }
        await delay(150);
      }
    }
    if (acquired) {
      try {
        record = await probe(root);
        if (!record) {
          const existing = await readRecord(root);
          if (existing && isAlive(existing.pid)) throw new Error('现有 Studio 服务未确认退出，请稍后重试。');
          const child = spawn(process.execPath, [entry, '--serve', '--managed', '--data-root', root], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env } });
          child.on('error', () => {}); child.unref();
          for (let attempt = 0; attempt < 100 && !record; attempt++) { await delay(150); record = await probe(root); }
        }
      } finally {
        await unlink(join(lock, 'owner')).catch(() => {});
        const { rmdir } = await import('node:fs/promises'); await rmdir(lock).catch(() => {});
      }
    }
    if (!record) throw new Error('Studio 本机服务未能启动；请检查 Node.js 版本和数据目录权限。');
  }
  const current = record;
  const agentConnectionId = randomUUID();
  let owner: Actor | undefined;
  const leaseDirectory = join(root, 'leases'); await mkdir(leaseDirectory, { recursive: true });
  const lease = join(leaseDirectory, `${process.pid}-${randomUUID()}.json`);
  const heartbeat = () => writeFile(lease, JSON.stringify({ pid: process.pid, expiresAt: Date.now() + 35_000 })).catch(() => {});
  await heartbeat(); const timer = setInterval(() => { void heartbeat(); }, 10_000); timer.unref();
  return {
    connection: async (): Promise<Connection> => {
      if (!owner) {
        const response = await fetch(`${current.origin}/api/session`, { headers: { Authorization: `Bearer ${current.token}` }, signal: AbortSignal.timeout(5000) });
        const session = await response.json() as { owner?: boolean; actor?: Actor };
        if (!response.ok || !session.owner || session.actor?.id !== 'local' || session.actor.kind !== 'human' || session.actor.role !== 'owner') throw new Error('本机服务未返回有效的所有者身份。');
        owner = session.actor;
      }
      return { baseUrl: current.origin, token: current.token, actor: owner };
    },
    async execute(name: ToolName, args: Record<string, unknown>, context?: StudioExecutionContext) {
      const { participant, ...operationArgs } = args;
      if (participant !== undefined && !object(participant)) throw new StudioError('INVALID_ARGUMENT', 'Agent participant 必须提供 id 和 name。');
      const participantId = object(participant) ? text(participant.id, '', 120).trim() : undefined;
      if (participantId === '') throw new StudioError('INVALID_ARGUMENT', 'Agent participant ID 不能为空。');
      const displayName = (object(participant) ? text(participant.name, '', 60) : context?.clientInfo?.title || context?.clientInfo?.name || 'Codex').trim();
      if (!displayName) throw new StudioError('INVALID_ARGUMENT', 'Agent participant 名称不能为空。');
      const agentId = `agent-${createHash('sha256').update(JSON.stringify({ connection: agentConnectionId, participant: participantId ?? null })).digest('hex').slice(0, 32)}`;
      const agentName = `${Array.from(displayName).slice(0, 24).join('')} · ${agentId.slice(-8)}`;
      const response = await fetch(`${current.origin}/api/tools/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${current.token}`, 'Content-Type': 'application/json', 'X-Studio-Actor': 'agent', 'X-Studio-Agent-Id': agentId, 'X-Studio-Agent-Name': encodeURIComponent(agentName) }, body: JSON.stringify(operationArgs), signal: AbortSignal.timeout(90_000) });
      const result = await response.json() as ToolResponse;
      if (!result.ok) throw Object.assign(new Error(result.error?.message || 'Studio 操作失败'), { code: result.error?.code, details: result.error?.details });
      return result.data;
    },
    async requestUi(input: UiHttpRequest, signal?: AbortSignal) {
      const request = validateUiRequest(input);
      const url = new URL(request.path, current.origin);
      if (url.origin !== current.origin) throw Object.assign(new Error('作品请求不能切换服务地址。'), { code: 'FORBIDDEN' });
      return fetch(url, {
        method: request.method,
        headers: { ...request.headers, Authorization: `Bearer ${current.token}`, 'X-Studio-Actor': 'human' },
        ...(request.body !== undefined ? { body: Buffer.from(request.body) } : {}),
        redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
      });
    },
    async close() { clearInterval(timer); await unlink(lease).catch(() => {}); },
  };
}
export function isAlive(pid: number) { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } }
export async function hasActiveLeases(root: string) {
  const directory = join(root, 'leases');
  for (const name of await readdir(directory).catch(() => [] as string[])) {
    try { const value = JSON.parse(await readFile(join(directory, name), 'utf8')); if (value.expiresAt > Date.now() && isAlive(value.pid)) return true; } catch { /* Partial or expired lease isn't authority. */ }
  }
  return false;
}
