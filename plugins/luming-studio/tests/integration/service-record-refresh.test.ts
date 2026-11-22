import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectStudio, writeRecord } from '../../src/server/client.js';
import { startStudioHost, type StudioHost } from '../../src/server/http.js';
import { PLUGIN_VERSION } from '../../src/contracts/version.js';
import { SERVICE_PROTOCOL_VERSION } from '../../src/server/service-protocol.js';

const child = vi.hoisted(() => ({
  spawn: vi.fn(() => {
    throw new Error('Unexpected authority spawn');
  }),
}));
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn: child.spawn,
}));

let directory: string;
let host: StudioHost;
let client: Awaited<ReturnType<typeof connectStudio>>;
const nativeFetch = globalThis.fetch.bind(globalThis);
beforeEach(async () => {
  child.spawn.mockClear();
  directory = await mkdtemp(join(await realpath(tmpdir()), 'studio-record-refresh-'));
  host = await startStudioHost({ dataRoot: directory, ownerName: 'First synthetic owner' });
  await writeRecord(directory, {
    origin: host.origin,
    token: host.token,
    pid: process.pid,
    instanceId: randomUUID(),
  });
  client = await connectStudio(directory);
  expect((await client.connection()).actor.name).toBe('First synthetic owner');
});

it('refuses a missing record while its known authority PID lives and resumes after record recovery', async () => {
  const recordPath = join(directory, 'service.json');
  const record = JSON.parse(await readFile(recordPath, 'utf8'));
  await unlink(recordPath);
  const dispatch = vi.spyOn(globalThis, 'fetch');
  try {
    await expect(client.execute('studio_open', { view: 'library' })).rejects.toMatchObject({
      code: 'SERVICE_RECORD_UNAVAILABLE',
    });
  } finally {
    await writeRecord(directory, record);
  }

  expect(child.spawn).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(await client.execute('studio_open', { view: 'library' })).toMatchObject({
    view: 'library',
  });
  expect(child.spawn).not.toHaveBeenCalled();
  expect(await readdir(join(directory, 'leases'))).toHaveLength(1);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await client?.close();
  await host?.close();
  expect(await readdir(join(directory, 'leases'))).toEqual([]);
  const target = await realpath(directory);
  expect(dirname(target)).toBe(await realpath(tmpdir()));
  expect(basename(target)).toMatch(/^studio-record-refresh-/);
  await rm(target, { recursive: true, force: true });
});

async function restart() {
  await host.close();
  host = await startStudioHost({ dataRoot: directory, ownerName: 'Restarted synthetic owner' });
  await writeRecord(directory, {
    origin: host.origin,
    token: host.token,
    pid: process.pid,
    instanceId: randomUUID(),
  });
}

it.each(['execute', 'requestUi', 'connection'] as const)(
  'refreshes %s and its cached owner after a same-version authority restart',
  async (entry) => {
    const old = await client.connection();
    await restart();
    expect(host.origin).not.toBe(old.baseUrl);
    expect(host.token).not.toBe(old.token);
    if (entry === 'execute') {
      expect(await client.execute('studio_open', { view: 'library' })).toMatchObject({
        view: 'library',
      });
    } else if (entry === 'requestUi') {
      const response = await client.requestUi({ path: '/api/session', method: 'GET', headers: {} });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        owner: true,
        actor: { name: 'Restarted synthetic owner' },
      });
    }

    const current = await client.connection();
    expect(current).toMatchObject({
      baseUrl: host.origin,
      token: host.token,
      actor: { name: 'Restarted synthetic owner' },
    });
    expect(await readdir(join(directory, 'leases'))).toHaveLength(1);
  },
);

it.each(['execute', 'requestUi'] as const)(
  'does not replay a committed %s POST when its response is lost and the record changes',
  async (entry) => {
    const original = host.origin;
    const originalToken = host.token;
    const writes: { origin: string; authorization: string | null }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/tools/artifact_manage') {
        writes.push({
          origin: url.origin,
          authorization: new Headers(init?.headers).get('authorization'),
        });
        const response = await nativeFetch(input, init);
        expect(response.status).toBe(200);
        await response.arrayBuffer();
        await restart();
        throw new TypeError('Synthetic response lost after commit');
      }

      return nativeFetch(input, init);
    });
    const args = { action: 'create', title: 'Exactly one synthetic write' };
    const pending =
      entry === 'execute'
        ? client.execute('artifact_manage', args)
        : client.requestUi({
            path: '/api/tools/artifact_manage',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: Buffer.from(JSON.stringify(args)),
          });
    await expect(pending).rejects.toThrow('Synthetic response lost after commit');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ origin: original, authorization: `Bearer ${originalToken}` });
    const result = (await client.execute('artifact_list', {})) as { artifacts: unknown[] };
    expect(result.artifacts).toHaveLength(1);
    expect((await client.connection()).baseUrl).toBe(host.origin);
    expect(writes).toHaveLength(1);
  },
);

it('keeps the MCP participant namespace while requiring a new task generation after authority restart', async () => {
  const participant = { id: 'stable-participant', name: 'Stable synthetic Agent' };
  const created = (await client.execute('artifact_manage', {
    action: 'create',
    title: 'Namespace fixture',
    participant,
  })) as { artifact: { id: string } };
  const artifactId = created.artifact.id;
  const original = (await client.execute('artifact_activity', {
    artifactId,
    action: 'begin',
    taskId: 'before-restart',
    phase: 'writing',
    scope: { rect: { x: 0, y: 0, w: 400, h: 200 } },
    participant,
  })) as { tasks: { taskId: string; generation: string }[] };
  const oldBinding = { taskId: 'before-restart', generation: original.tasks[0]!.generation };
  expect(oldBinding.generation).toEqual(expect.any(String));
  const beforeActor = host.service
    .getPresence(artifactId)
    .find((peer) => peer.context?.agentTasks?.length)!.actor.id;
  await restart();
  await expect(
    client.execute('artifact_activity', {
      artifactId,
      action: 'update',
      ...oldBinding,
      participant,
    }),
  ).rejects.toMatchObject({ code: 'TASK_STALE' });
  const mutation = {
    artifactId,
    operationId: randomUUID(),
    expectedRevision: 0,
    operations: [
      {
        op: 'add',
        element: {
          id: 'after-restart',
          type: 'text',
          x: 20,
          y: 20,
          w: 200,
          h: 80,
          text: 'Synthetic change',
        },
      },
    ],
    participant,
  };
  await expect(
    client.execute('artifact_apply', { ...mutation, ...oldBinding }),
  ).rejects.toMatchObject({ code: 'TASK_STALE' });
  expect(
    await client.execute('artifact_read', { artifactId, mode: 'summary', participant }),
  ).toMatchObject({ artifact: { revision: 0 } });
  const begun = (await client.execute('artifact_activity', {
    artifactId,
    action: 'begin',
    taskId: 'after-restart',
    phase: 'writing',
    scope: { rect: { x: 0, y: 0, w: 400, h: 200 } },
    participant,
  })) as { tasks: { generation: string }[] };
  expect(begun.tasks).toHaveLength(1);
  expect(begun.tasks[0]!.generation).not.toBe(oldBinding.generation);
  const changed = (await client.execute('artifact_apply', {
    ...mutation,
    taskId: 'after-restart',
    generation: begun.tasks[0]!.generation,
  })) as { historyEntry: { actor: { id: string } } };
  expect(changed.historyEntry.actor.id).toBe(beforeActor);
  expect(await readdir(join(directory, 'leases'))).toHaveLength(1);
});

it('ends only explicitly returned task generations on normal close and never invents a read binding', async () => {
  const artifactId = (await host.service.execute('artifact_manage', { action: 'create' })).artifact
    .id;
  const ended: { body: Record<string, unknown>; actorId: string; authorization: string | null }[] =
    [];
  const readBodies: Record<string, unknown>[] = [];
  const generations = new Map<string, string>();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/tools/artifact_read') {
      readBodies.push(JSON.parse(String(init?.body)));
    }
    if (url.pathname === '/api/tools/artifact_activity') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      const actorId = headers.get('X-Studio-Agent-Id')!;
      if (body.action === 'end') {
        ended.push({ body, actorId, authorization: headers.get('Authorization') });

        return Response.json({ ok: true, data: { tasks: [] } });
      }

      const generation = generations.get(actorId) ?? randomUUID();
      generations.set(actorId, generation);

      return Response.json({
        ok: true,
        data: {
          tasks: [
            {
              taskId: body.taskId,
              generation,
              scope: { rect: { x: 0, y: 0, w: 100, h: 100 } },
              phase: 'preparing',
              startedAt: Date.now(),
              lastActivityAt: Date.now(),
              lastProgressAt: Date.now(),
              expiresAt: Date.now() + 600_000,
            },
          ],
        },
      });
    }

    return nativeFetch(input, init);
  });

  for (const name of ['Agent A', 'Agent B']) {
    await client.execute('artifact_activity', {
      artifactId,
      action: 'begin',
      taskId: 'work',
      phase: 'preparing',
      scope: { rect: { x: 0, y: 0, w: 100, h: 100 } },
      participant: { id: name, name },
    });
  }

  await client.execute('artifact_read', {
    artifactId,
    mode: 'summary',
    participant: { id: 'Agent A', name: 'Agent A' },
  });
  expect(readBodies).toEqual([{ artifactId, mode: 'summary' }]);
  await client.close();
  await client.close();
  expect(ended).toHaveLength(2);
  expect(new Set(ended.map((item) => item.actorId)).size).toBe(2);
  for (const item of ended) {
    expect(item.body).toEqual({
      artifactId,
      action: 'end',
      taskId: 'work',
      generation: generations.get(item.actorId),
      outcome: 'cancelled',
    });
    expect(item.authorization).toBe(`Bearer ${host.token}`);
  }

  expect(await readdir(join(directory, 'leases'))).toEqual([]);
});

it('does not contact or discover a replacement authority to close an old recorded task', async () => {
  const generation = randomUUID();
  const dispatch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (new URL(String(input)).pathname === '/api/tools/artifact_activity') {
      return Response.json({
        ok: true,
        data: {
          tasks: [{ taskId: 'old-service-work', generation, expiresAt: Date.now() + 600_000 }],
        },
      });
    }

    return nativeFetch(input, init);
  });
  await client.execute('artifact_activity', {
    artifactId: 'synthetic-board',
    action: 'begin',
    taskId: 'old-service-work',
    scope: { rect: { x: 0, y: 0, w: 100, h: 100 } },
  });
  await restart();
  dispatch.mockClear();
  await client.close();
  expect(dispatch).not.toHaveBeenCalled();
  expect(child.spawn).not.toHaveBeenCalled();
  expect(await readdir(join(directory, 'leases'))).toEqual([]);
});

it('still releases its process lease when the known authority cannot acknowledge task cleanup', async () => {
  const calls: Record<string, unknown>[] = [];
  const generation = randomUUID();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (new URL(String(input)).pathname === '/api/tools/artifact_activity') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push(body);
      if (body.action === 'end') {
        throw new TypeError('Synthetic authority unavailable during close');
      }

      return Response.json({
        ok: true,
        data: { tasks: [{ taskId: 'known-task', generation, expiresAt: Date.now() + 600_000 }] },
      });
    }

    return nativeFetch(input, init);
  });
  await client.execute('artifact_activity', {
    artifactId: 'synthetic-board',
    action: 'begin',
    taskId: 'known-task',
    scope: { rect: { x: 0, y: 0, w: 100, h: 100 } },
  });
  await expect(client.close()).resolves.toBeUndefined();
  expect(calls.filter((input) => input.action === 'end')).toEqual([
    {
      artifactId: 'synthetic-board',
      action: 'end',
      taskId: 'known-task',
      generation,
      outcome: 'cancelled',
    },
  ]);
  expect(child.spawn).not.toHaveBeenCalled();
  expect(await readdir(join(directory, 'leases'))).toEqual([]);
});

it('bounds normal close when a real HTTP authority stalls task cleanup', async () => {
  const artifactId = (await host.service.execute('artifact_manage', { action: 'create' })).artifact
    .id;
  await client.execute('artifact_activity', {
    artifactId,
    action: 'begin',
    taskId: 'slow-cleanup',
    scope: { rect: { x: 0, y: 0, w: 100, h: 100 } },
  });
  let release!: () => void;
  let arrived!: () => void;
  let finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const admitted = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const complete = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const execute = host.service.execute.bind(host.service);
  vi.spyOn(host.service, 'execute').mockImplementation(
    async (name, args = {}, actor, authority) => {
      const cleanup = name === 'artifact_activity' && args.action === 'end';
      if (cleanup) {
        arrived();
        await gate;
      }

      try {
        return await execute(name, args, actor, authority);
      } finally {
        if (cleanup) {
          finished();
        }
      }
    },
  );
  const started = Date.now();
  const closing = client.close();
  await admitted;
  try {
    await closing;
    expect(Date.now() - started).toBeLessThan(4000);
    expect(await readdir(join(directory, 'leases'))).toEqual([]);
    expect(child.spawn).not.toHaveBeenCalled();
  } finally {
    release();
    await complete;
  }
});

it.each(['pluginVersion', 'serviceProtocol'] as const)(
  'validates %s before using a replacement record',
  async (field) => {
    await restart();
    const business = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.origin === host.origin && url.pathname === '/api/session') {
        return Response.json({
          owner: true,
          serviceProtocol: SERVICE_PROTOCOL_VERSION,
          pluginVersion: PLUGIN_VERSION,
          [field]:
            field === 'serviceProtocol' ? SERVICE_PROTOCOL_VERSION + 1 : 'incompatible-version',
        });
      }

      if (url.pathname.startsWith('/api/tools/')) {
        business();
      }

      return nativeFetch(input, init);
    });
    await expect(client.execute('artifact_list', {})).rejects.toMatchObject({
      code: 'SERVICE_PROTOCOL_MISMATCH',
    });
    expect(business).not.toHaveBeenCalled();
  },
);
