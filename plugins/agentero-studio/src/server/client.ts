import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink, readdir, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STUDIO_TOOLS,
  type Actor,
  type Connection,
  type ToolName,
  type ToolResponse,
} from '../contracts/studio.js';
import type { StudioExecutionContext } from './protocol.js';
import { object, StudioError, text } from '../core/shared/common.js';
import type { UiHttpRequest } from '../contracts/transport.js';
import { validateUiRequest } from './app-transport.js';
import { SERVICE_PROTOCOL_VERSION } from './service-protocol.js';
import { PLUGIN_VERSION } from '../contracts/version.js';

export const dataDirectory = (value?: string) =>
  resolve(
    value ||
      process.env.AGENTERO_STUDIO_DATA_ROOT ||
      join(homedir(), '.codexworkbench', 'agentero-studio'),
  );

export interface ServiceRecord {
  origin: string;
  token: string;
  pid: number;
  instanceId: string;
}

export async function readRecord(root: string): Promise<ServiceRecord | undefined> {
  try {
    const value = JSON.parse(await readFile(join(root, 'service.json'), 'utf8'));
    if (value.origin && value.token && value.pid) {
      return value;
    }
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    if (!missing && !(error instanceof SyntaxError)) {
      console.error('Studio 未能读取本机服务记录。', error);
    }
  }
}

async function probe(root: string) {
  const record = await readRecord(root);
  if (!record) {
    return;
  }

  try {
    const url = new URL(record.origin);
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') {
      return;
    }

    const response = await fetch(`${record.origin}/api/session`, {
      headers: { Authorization: `Bearer ${record.token}` },
      signal: AbortSignal.timeout(1500),
    });

    if (response.ok) {
      const session = (await response.json()) as {
        owner?: boolean;
        serviceProtocol?: unknown;
        pluginVersion?: unknown;
      };

      if (
        session.owner !== true ||
        session.serviceProtocol !== SERVICE_PROTOCOL_VERSION ||
        session.pluginVersion !== PLUGIN_VERSION
      ) {
        throw new StudioError(
          'SERVICE_PROTOCOL_MISMATCH',
          `正在运行的 Studio 服务版本与当前插件 ${PLUGIN_VERSION} 不兼容。请关闭旧版本白板窗口、重启插件后再打开；未启动第二个数据服务。`,
          {
            expected: SERVICE_PROTOCOL_VERSION,
            actual: session.serviceProtocol ?? null,
            expectedVersion: PLUGIN_VERSION,
            actualVersion: session.pluginVersion ?? null,
          },
        );
      }

      return record;
    }
  } catch (error) {
    if (error instanceof StudioError && error.code === 'SERVICE_PROTOCOL_MISMATCH') {
      throw error;
    }
  }
}

export async function writeRecord(root: string, record: ServiceRecord) {
  await mkdir(root, { recursive: true });
  const target = join(root, 'service.json');
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  await rename(temp, target);
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitForService(root: string, attempts: number, interval: number) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await delay(interval);
    const record = await probe(root);
    if (record) {
      return record;
    }
  }
}

async function removeStaleStartupLock(lock: string) {
  try {
    const owner = join(lock, 'owner');
    const pid = Number(await readFile(owner, 'utf8'));
    if (pid && !isAlive(pid)) {
      await unlink(owner);
      await rmdir(lock);
    }
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      console.error('Studio 未能检查或清理旧启动锁。', error);
    }
  }
}

async function startService(root: string, entry: string) {
  const running = await probe(root);
  if (running) {
    return running;
  }

  const existing = await readRecord(root);
  if (existing && isAlive(existing.pid)) {
    throw new Error('现有 Studio 服务未确认退出，请稍后重试。');
  }

  const child = spawn(process.execPath, [entry, '--serve', '--managed', '--data-root', root], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.on('error', (error) => {
    console.error('Studio 未能启动本机服务进程。', error);
  });
  child.unref();
  return waitForService(root, 100, 150);
}

async function discoverService(root: string, entry: string): Promise<ServiceRecord> {
  await mkdir(root, { recursive: true });
  const running = await probe(root);
  if (running) {
    return running;
  }

  const existing = await readRecord(root);
  if (existing && isAlive(existing.pid)) {
    const record = await waitForService(root, 6, 300);
    if (!record) {
      throw new Error(
        'Studio 服务进程仍在运行，但暂时没有响应；请稍后重试，未另起第二个数据服务。',
      );
    }

    return record;
  }
  const lock = join(root, 'startup.lock');
  let lockError: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await mkdir(lock);
      await writeFile(join(lock, 'owner'), String(process.pid));
    } catch (error) {
      lockError = error;
      const record = await probe(root);
      if (record) {
        return record;
      }

      await removeStaleStartupLock(lock);
      await delay(150);
      continue;
    }
    try {
      const record = await startService(root, entry);
      if (record) {
        return record;
      }
    } finally {
      await unlink(join(lock, 'owner')).catch(reportStartupLockCleanup);
      await rmdir(lock).catch(reportStartupLockCleanup);
    }
    lockError = undefined;
    break;
  }
  throw new Error('Studio 本机服务未能启动；请检查 Node.js 版本和数据目录权限。', {
    cause: lockError,
  });
}

function reportStartupLockCleanup(error: NodeJS.ErrnoException): void {
  if (error.code !== 'ENOENT') {
    console.error('Studio 未能释放启动锁。', error);
  }
}

const sameService = (left: ServiceRecord, right: ServiceRecord) =>
  left.origin === right.origin &&
  left.token === right.token &&
  left.pid === right.pid &&
  left.instanceId === right.instanceId;

function agentIdentity(
  participant: unknown,
  context: StudioExecutionContext | undefined,
  agentConnectionId: string,
) {
  if (participant !== undefined && !object(participant)) {
    throw new StudioError('INVALID_ARGUMENT', 'Agent participant 必须提供 id 和 name。');
  }

  const participantId = object(participant) ? text(participant.id, '', 120).trim() : undefined;
  if (participantId === '') {
    throw new StudioError('INVALID_ARGUMENT', 'Agent participant ID 不能为空。');
  }

  const appearanceKey = object(participant) ? participant.appearanceKey : undefined;
  if (
    appearanceKey !== undefined &&
    (typeof appearanceKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(appearanceKey))
  ) {
    throw new StudioError('INVALID_ARGUMENT', 'Agent appearanceKey 必须是随机 UUIDv4。');
  }

  const clientInfo = context?.clientInfo;
  const displayName = (
    object(participant)
      ? text(participant.name, '', 60)
      : clientInfo?.title || clientInfo?.name || 'Codex'
  ).trim();

  if (!displayName) {
    throw new StudioError('INVALID_ARGUMENT', 'Agent participant 名称不能为空。');
  }

  const participantKey = participantId ?? 'main';
  const presentationId =
    typeof appearanceKey === 'string'
      ? `agent-display-${createHash('sha256')
          .update(
            JSON.stringify({
              appearance: appearanceKey.toLowerCase(),
              participant: participantKey,
            }),
          )
          .digest('hex')
          .slice(0, 32)}`
      : undefined;
  const agentId = `agent-${createHash('sha256')
    .update(
      JSON.stringify({
        connection: agentConnectionId,
        participant: participantKey,
        ...(presentationId ? { presentation: presentationId } : {}),
      }),
    )
    .digest('hex')
    .slice(0, 32)}`;
  const agentName = `${Array.from(displayName).slice(0, 24).join('')} · ${(presentationId ?? agentId).slice(-8)}`;
  return { agentId, agentName, presentationId };
}

export async function connectStudio(
  root = dataDirectory(),
  entry = fileURLToPath(import.meta.url),
) {
  let current = await discoverService(root, entry);
  const agentConnectionId = randomUUID();
  let owner: { record: ServiceRecord; actor: Actor } | undefined;
  const knownTasks = new Map<
    string,
    {
      artifactId: string;
      taskId: string;
      generation: string;
      agentId: string;
      agentName: string;
      record: ServiceRecord;
    }
  >();
  const taskKey = (artifactId: string, agentId: string, taskId: string, generation: string) =>
    JSON.stringify([artifactId, agentId, taskId, generation]);
  let closing: Promise<void> | undefined;

  function trackActivity(
    args: Record<string, unknown>,
    data: unknown,
    identity: ReturnType<typeof agentIdentity>,
    record: ServiceRecord,
  ): void {
    const { artifactId, action, taskId, generation } = args;
    if (
      typeof artifactId !== 'string' ||
      !['begin', 'update', 'status', 'end'].includes(String(action))
    ) {
      return;
    }

    const { agentId, agentName } = identity;
    const endingTask = typeof taskId === 'string' && typeof generation === 'string';
    if (action === 'end' && endingTask) {
      knownTasks.delete(taskKey(artifactId, agentId, taskId, generation));
    }
    const tasks = object(data) && Array.isArray(data.tasks) ? data.tasks : [];
    for (const task of tasks) {
      if (!object(task) || task.endedAt !== undefined || task.outcome !== undefined) {
        continue;
      }

      const { taskId, generation } = task;
      const validTaskId = typeof taskId === 'string' && taskId.length > 0;
      const validGeneration = typeof generation === 'string' && generation.length > 0;
      if (validTaskId && validGeneration) {
        knownTasks.set(taskKey(artifactId, agentId, taskId, generation), {
          artifactId,
          taskId,
          generation,
          agentId,
          agentName,
          record,
        });
      }
    }
  }

  async function freshRecord(): Promise<ServiceRecord> {
    if (closing) {
      throw new StudioError('CLOSED', 'Studio 连接已关闭。');
    }

    const saved = await readRecord(root);
    if (!saved && isAlive(current.pid)) {
      throw new StudioError(
        'SERVICE_RECORD_UNAVAILABLE',
        '已连接的 Studio 服务仍在运行，但暂时无法读取其连接记录；请稍后重试，未启动第二个服务。',
      );
    }

    if (!saved || !sameService(saved, current) || !isAlive(saved.pid)) {
      const next = await discoverService(root, entry);
      if (!sameService(current, next)) {
        current = next;
        owner = undefined;
      }
    }
    return current;
  }
  const leaseDirectory = join(root, 'leases');
  await mkdir(leaseDirectory, { recursive: true });
  const lease = join(leaseDirectory, `${process.pid}-${randomUUID()}.json`);
  const heartbeat = () =>
    writeFile(lease, JSON.stringify({ pid: process.pid, expiresAt: Date.now() + 35_000 }));
  const reportLeaseError = (error: unknown) => {
    console.error('Studio 连接租约未能更新。', error);
  };
  await heartbeat().catch(reportLeaseError);
  const timer = setInterval(() => {
    heartbeat().catch(reportLeaseError);
  }, 10_000);
  timer.unref();
  return {
    connection: async (): Promise<Connection> => {
      const target = await freshRecord();
      let actor = owner && sameService(owner.record, target) ? owner.actor : undefined;
      if (!actor) {
        const response = await fetch(`${target.origin}/api/session`, {
          headers: { Authorization: `Bearer ${target.token}` },
          signal: AbortSignal.timeout(5000),
        });
        const session = (await response.json()) as { owner?: boolean; actor?: Actor };
        const sessionActor = session.actor;
        const validActor =
          sessionActor?.id === 'local' &&
          sessionActor.kind === 'human' &&
          sessionActor.role === 'owner';

        if (!response.ok || !session.owner || !validActor) {
          throw new Error('本机服务未返回有效的所有者身份。');
        }

        actor = sessionActor;
        owner = { record: target, actor };
      }
      return { baseUrl: target.origin, token: target.token, actor };
    },
    async execute(name: ToolName, args: Record<string, unknown>, context?: StudioExecutionContext) {
      const { participant, ...operationArgs } = args;
      const identity = agentIdentity(participant, context, agentConnectionId);
      const { agentId, agentName, presentationId } = identity;
      const target = await freshRecord();
      const response = await fetch(`${target.origin}/api/tools/${name}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${target.token}`,
          'Content-Type': 'application/json',
          'X-Studio-Actor': 'agent',
          'X-Studio-Agent-Id': agentId,
          'X-Studio-Agent-Name': encodeURIComponent(agentName),
          ...(presentationId ? { 'X-Studio-Agent-Presentation-Id': presentationId } : {}),
        },
        body: JSON.stringify(operationArgs),
        signal: AbortSignal.timeout(90_000),
      });
      const result = (await response.json()) as ToolResponse;
      if (!result.ok) {
        throw Object.assign(new Error(result.error?.message || 'Studio 操作失败'), {
          code: result.error?.code,
          details: result.error?.details,
        });
      }

      if (!closing && name === STUDIO_TOOLS.activity) {
        trackActivity(operationArgs, result.data, identity, target);
      }
      return result.data;
    },
    async requestUi(input: UiHttpRequest, signal?: AbortSignal) {
      const request = validateUiRequest(input);
      const target = await freshRecord();
      const url = new URL(request.path, target.origin);
      if (url.origin !== target.origin) {
        throw Object.assign(new Error('作品请求不能切换服务地址。'), { code: 'FORBIDDEN' });
      }

      return fetch(url, {
        method: request.method,
        headers: {
          ...request.headers,
          Authorization: `Bearer ${target.token}`,
          'X-Studio-Actor': 'human',
        },
        ...(request.body !== undefined ? { body: Buffer.from(request.body) } : {}),
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
          : AbortSignal.timeout(90_000),
      });
    },
    close() {
      return (closing ??= (async () => {
        clearInterval(timer);
        const tasks = [...knownTasks.values()];
        knownTasks.clear();
        try {
          if (!tasks.length) {
            return;
          }

          const saved = await readRecord(root);
          if (!saved || !isAlive(saved.pid)) {
            return;
          }

          const signal = AbortSignal.timeout(1500);
          await Promise.allSettled(
            tasks
              .filter((task) => sameService(task.record, saved))
              .map(async (task) => {
                const response = await fetch(`${saved.origin}/api/tools/artifact_activity`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${saved.token}`,
                    'Content-Type': 'application/json',
                    'X-Studio-Actor': 'agent',
                    'X-Studio-Agent-Id': task.agentId,
                    'X-Studio-Agent-Name': encodeURIComponent(task.agentName),
                  },
                  body: JSON.stringify({
                    artifactId: task.artifactId,
                    action: 'end',
                    taskId: task.taskId,
                    generation: task.generation,
                    outcome: 'cancelled',
                  }),
                  signal,
                });
                await response.arrayBuffer();
              }),
          );
        } finally {
          await unlink(lease).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') {
              console.error('Studio 未能清理连接租约。', error);
            }
          });
        }
      })());
    },
  };
}

export function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function hasActiveLeases(root: string) {
  const directory = join(root, 'leases');
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      console.error('Studio 未能读取连接租约目录。', error);
    }
    return [];
  });

  for (const name of names) {
    try {
      const value = JSON.parse(await readFile(join(directory, name), 'utf8'));
      if (value.expiresAt > Date.now() && isAlive(value.pid)) {
        return true;
      }
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
      if (!missing && !(error instanceof SyntaxError)) {
        console.error('Studio 未能读取连接租约。', error);
      }
    }
  }
  return false;
}
