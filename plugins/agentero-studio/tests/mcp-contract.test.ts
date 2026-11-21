import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  TOOL_NAMES,
  type Actor,
  type AgentTaskBinding,
  type ToolResponse,
} from '../src/contracts/studio.js';
import { APP_TOOL_NAME } from '../src/contracts/transport.js';
import { StudioService } from '../src/core/service.js';
import { createStudioServer, type StudioExecutionContext } from '../src/server/protocol.js';

const actor: Actor = { id: 'codex', name: 'Codex', kind: 'agent', role: 'owner' };
let directory: string;
let service: StudioService;
let server: ReturnType<typeof createStudioServer>;
let client: Client;
let artifactId: string;
let execution:
  | { name: string; args: Record<string, unknown>; context?: StudioExecutionContext }
  | undefined;
let fixtureBinding: AgentTaskBinding | undefined;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-mcp-contract-'));
  service = new StudioService({ dataRoot: directory });
  execution = undefined;
  fixtureBinding = undefined;
  server = createStudioServer(
    {
      execute: (name, args, context) => {
        execution = { name, args, context };

        return service.execute(name, args, actor);
      },
      connection: async () => ({ baseUrl: 'http://127.0.0.1:12345', token: 'test-only', actor }),
    },
    '<!doctype html><html></html>',
  );
  client = new Client({ name: 'studio-contract-regression', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  artifactId = (await call('artifact_manage', { action: 'create' })).artifact.id;
});
afterEach(async () => {
  await client?.close();
  await server?.close();
  await service?.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected test directory');
  }

  await rm(directory, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>): Promise<any> {
  const result = await client.callTool({ name, arguments: { artifactId, ...args } });
  expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true);
  const body = result.structuredContent as unknown as ToolResponse;
  expect(body.ok).toBe(true);

  return body.data;
}

async function failure(name: string, args: Record<string, unknown>, code?: string) {
  const result = await client.callTool({ name, arguments: { artifactId, ...args } });
  expect(result.isError).toBe(true);
  if (code) {
    expect(result.structuredContent).toMatchObject({ ok: false, error: { code } });
  } else {
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
    );
  }
}

async function fixtureTask(): Promise<AgentTaskBinding> {
  if (!fixtureBinding) {
    const result = await call('artifact_activity', {
      action: 'begin',
      taskId: 'contract-fixture',
      phase: 'writing',
      scope: { rect: { x: -400, y: -100, w: 2400, h: 1600 } },
      label: 'Exercise bounded model contracts',
    });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].generation).toEqual(expect.any(String));
    fixtureBinding = { taskId: result.tasks[0].taskId, generation: result.tasks[0].generation };
  }

  return fixtureBinding;
}

async function apply(args: Record<string, unknown>) {
  return call('artifact_apply', { ...(await fixtureTask()), ...args });
}

async function applyFailure(args: Record<string, unknown>, code?: string) {
  return failure('artifact_apply', { ...(await fixtureTask()), ...args }, code);
}

const add = (elements: Record<string, unknown>[]) =>
  apply({
    operationId: randomUUID(),
    operations: elements.map((element) => ({ op: 'add', element })),
  });

describe('model MCP contracts through the real SDK', () => {
  it('bootstraps an existing App through private metadata without a UI resource or navigation', async () => {
    const { tools } = await client.listTools();
    const transport = tools.find((tool) => tool.name === APP_TOOL_NAME)!;
    expect(transport._meta).toMatchObject({ ui: { visibility: ['app'] } });
    expect((transport._meta?.ui as Record<string, unknown>).resourceUri).toBeUndefined();
    const result = await client.callTool({ name: APP_TOOL_NAME, arguments: { action: 'connect' } });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([]);
    expect(result.structuredContent).toEqual({ ok: true });
    expect(result._meta).toEqual({
      connection: { baseUrl: 'http://127.0.0.1:12345', token: 'test-only', actor },
    });
    expect(execution?.name).toBe('artifact_manage');
    expect(JSON.stringify(result.structuredContent)).not.toContain('test-only');
    expect(
      (
        await client.callTool({
          name: APP_TOOL_NAME,
          arguments: { action: 'connect', artifactId: 'another-board' },
        })
      ).isError,
    ).toBe(true);
  });

  it('preserves explicit Agent participants and documented MCP client identity through schema parsing', async () => {
    const participant = { id: 'review-agent', name: 'Reviewer', appearanceKey: randomUUID() };
    await call('artifact_read', { mode: 'summary', participant });
    expect(execution).toMatchObject({
      name: 'artifact_read',
      args: { participant },
      context: { clientInfo: { name: 'studio-contract-regression', version: '1.0.0' } },
    });
    const { tools } = await client.listTools();
    for (const tool of tools.filter((tool) =>
      TOOL_NAMES.includes(tool.name as (typeof TOOL_NAMES)[number]),
    )) {
      expect(
        (tool.inputSchema.properties as Record<string, any>).participant.properties.id.maxLength,
      ).toBe(120);
      expect(
        (tool.inputSchema.properties as Record<string, any>).participant.properties.appearanceKey
          .type,
      ).toBe('string');
    }

    expect(
      (
        tools.find((tool) => tool.name === 'artifact_apply')!.inputSchema.properties as Record<
          string,
          any
        >
      ).merge.const,
    ).toBe('safe');
  });
  it('publishes the background model tools and keeps the conversation entrypoint app-only', async () => {
    const { tools } = await client.listTools();
    const visible = tools.filter(
      (tool) =>
        !(tool._meta?.ui as { visibility?: string[] } | undefined)?.visibility ||
        (tool._meta?.ui as { visibility: string[] }).visibility.includes('model'),
    );
    expect(visible).toHaveLength(8);
    expect(visible.map((tool) => tool.name).sort()).toEqual(
      TOOL_NAMES.filter((name) => name !== 'studio_open').sort(),
    );

    for (const tool of visible) {
      expect((tool._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri).toBeUndefined();
      expect(tool._meta?.['openai/ui']).toBeUndefined();
    }

    expect(tools).toHaveLength(TOOL_NAMES.length + 1);
    expect(tools.find((tool) => tool.name === 'studio_open')?._meta).toMatchObject({
      ui: { visibility: ['app'], resourceUri: 'ui://agentero-studio/app' },
      'openai/ui': { entrypoints: [{ type: 'thread' }] },
    });
    expect(tools.find((tool) => tool.name === APP_TOOL_NAME)?._meta).toMatchObject({
      ui: { visibility: ['app'] },
    });
    const feedback = tools.find((tool) => tool.name === 'artifact_feedback')!;
    const fields = feedback.inputSchema.properties as Record<string, any>;
    expect(fields.versions).toMatchObject({
      type: 'object',
      description: expect.stringContaining('选取时'),
    });
    expect(fields.operationId.description).toContain('重试');
    expect(fields.action.enum).toContain('attached');
    expect(fields.requestId.description).toContain('宿主确认附加成功');
    expect(fields.anchor.properties.coordinateSpace.enum).toEqual([
      'board',
      'element',
      'html',
      'document',
      'todo',
    ]);
    expect(fields.anchor.properties.blockIds.maxItems).toBe(100);
    expect(fields.anchor.properties.sourceVersion.description).toContain('element.version');
    expect(fields.anchor.properties.coordinateSpace.description).toContain('CSS 像素');
    const apply = tools.find((tool) => tool.name === 'artifact_apply')!;
    const applyFields = apply.inputSchema.properties as Record<string, any>;
    expect(applyFields.operations.items.properties.changes.properties.locked).toMatchObject({
      type: 'boolean',
      description: expect.stringContaining('仍可更新'),
    });
    expect(apply.description).toContain('同批解锁');
    const manage = tools.find((tool) => tool.name === 'artifact_manage')!;
    const manageFields = manage.inputSchema.properties as Record<string, any>;
    expect(manageFields.action.enum).toContain('purge');
    expect(manageFields.artifactIds).toMatchObject({
      type: 'array',
      minItems: 1,
      maxItems: 100,
      description: expect.stringContaining('二选一'),
    });
    expect(manage.annotations?.destructiveHint).toBe(true);
    expect(tools.some((tool) => /reader/.test(tool.name))).toBe(false);
  });

  it('saves and verifies an Agent change without returning an App result', async () => {
    const binding = await fixtureTask();
    const write = await client.callTool({
      name: 'artifact_apply',
      arguments: {
        artifactId,
        ...binding,
        operationId: randomUUID(),
        expectedRevision: 0,
        operations: [
          {
            op: 'add',
            element: { id: 'background-note', type: 'text', text: 'Background update' },
          },
        ],
      },
    });
    expect(write).toMatchObject({
      content: [],
      structuredContent: { ok: true, data: { artifact: { id: artifactId, revision: 1 } } },
    });
    expect(write._meta).toBeUndefined();

    const read = await client.callTool({
      name: 'artifact_read',
      arguments: { artifactId, ...binding, mode: 'objects', ids: ['background-note'] },
    });
    expect(read).toMatchObject({
      content: [],
      structuredContent: {
        ok: true,
        data: { elements: [{ id: 'background-note', text: 'Background update', version: 1 }] },
      },
    });
    expect(read._meta).toBeUndefined();
  });

  it('publishes explicit task generations and lifecycle actions without exposing the UI transport to models', async () => {
    const { tools } = await client.listTools();
    const fields = tools.find((tool) => tool.name === 'artifact_activity')!.inputSchema
      .properties as Record<string, any>;
    expect(fields.action.enum).toEqual(['begin', 'update', 'end', 'status', 'release']);
    expect(fields.phase.enum).toEqual(['preparing', 'writing', 'verifying']);
    expect(fields.outcome.enum).toEqual(['completed', 'failed', 'cancelled']);
    expect(fields.generation).toMatchObject({ type: 'string', minLength: 1 });
    expect(fields.targetActorId).toMatchObject({ type: 'string' });
    expect(
      tools.find((tool) => tool.name === 'artifact_activity')!.inputSchema.required,
    ).not.toContain('taskId');

    for (const name of ['artifact_read', 'artifact_apply', 'artifact_feedback']) {
      const binding = tools.find((tool) => tool.name === name)!.inputSchema.properties as Record<
        string,
        any
      >;
      expect(binding.taskId).toMatchObject({ type: 'string' });
      expect(binding.generation).toMatchObject({ type: 'string', minLength: 1 });
    }

    expect(tools.find((tool) => tool.name === APP_TOOL_NAME)?._meta).toMatchObject({
      ui: { visibility: ['app'] },
    });
  });

  it('declares, queries, updates and ends the exact Agent generation through the public SDK contract', async () => {
    await add([{ id: 'work-target', type: 'text', text: 'Work target' }]);
    await call('artifact_activity', { action: 'end', ...fixtureBinding, outcome: 'completed' });
    fixtureBinding = undefined;
    const declared = await call('artifact_activity', {
      action: 'begin',
      taskId: 'task',
      phase: 'preparing',
      scope: { ids: ['work-target'] },
      label: 'Review diagram',
    });
    expect(declared.tasks).toMatchObject([
      {
        taskId: 'task',
        generation: expect.any(String),
        phase: 'preparing',
        scope: { ids: ['work-target'] },
        label: 'Review diagram',
        expiresAt: expect.any(Number),
      },
    ]);
    const binding = { taskId: 'task', generation: declared.tasks[0].generation };
    expect(execution?.args).toMatchObject({ phase: 'preparing' });
    expect((await call('artifact_activity', { action: 'status' })).tasks).toMatchObject([binding]);
    expect(
      (await call('artifact_activity', { action: 'status', taskId: 'task' })).tasks,
    ).toMatchObject([binding]);
    const renewed = await call('artifact_activity', {
      action: 'update',
      ...binding,
      phase: 'verifying',
      label: 'Finish review',
    });
    expect(renewed.tasks).toMatchObject([
      { ...binding, phase: 'verifying', scope: { ids: ['work-target'] }, label: 'Finish review' },
    ]);
    expect(execution?.args).toMatchObject({ ...binding, phase: 'verifying' });
    await call('artifact_read', { mode: 'objects', ids: ['work-target'], ...binding });
    expect(execution?.args).toMatchObject(binding);
    await failure(
      'artifact_activity',
      { action: 'release', targetActorId: actor.id, ...binding },
      'FORBIDDEN',
    );
    expect(execution?.args).toMatchObject({ targetActorId: actor.id, ...binding });
    await failure(
      'artifact_activity',
      { action: 'begin', taskId: 'missing', scope: { ids: ['missing'] } },
      'NOT_FOUND',
    );
    await failure('artifact_activity', {
      action: 'begin',
      taskId: 'invalid',
      scope: { rect: { x: 0, y: 0, w: -1, h: 1 } },
    });
    expect(
      await call('artifact_activity', { action: 'end', ...binding, outcome: 'completed' }),
    ).toMatchObject({ tasks: [] });
    expect(execution?.args).toMatchObject({ ...binding, outcome: 'completed' });
    await failure(
      'artifact_apply',
      {
        ...binding,
        operations: [
          { op: 'update', id: 'work-target', changes: { text: 'must not resume a closed task' } },
        ],
        expectedVersions: { 'work-target': 1 },
      },
      'TASK_CLOSED',
    );
    await failure(
      'artifact_apply',
      {
        operations: [{ op: 'update', id: 'work-target', changes: { text: 'binding required' } }],
        expectedVersions: { 'work-target': 1 },
      },
      'TASK_REQUIRED',
    );
    const read = await call('artifact_read', {
      mode: 'units',
      ids: ['work-target'],
      atRevision: 1,
    });
    expect(read).toMatchObject({
      artifact: { revision: 1 },
      units: [{ id: 'work-target', after: { text: 'Work target', version: 1 } }],
    });
  });

  it('preserves create versions through schema parsing, freezes the clicked native source and deduplicates retries', async () => {
    await add([{ id: 'native', type: 'text', text: 'Clicked content', x: 10, y: 20 }]);
    await apply({
      expectedVersions: { native: 1 },
      operations: [{ op: 'update', id: 'native', changes: { text: 'Current content', x: 500 } }],
    });
    const args = {
      action: 'create',
      operationId: randomUUID(),
      text: 'Review clicked content',
      versions: { native: 1 },
      anchor: { coordinateSpace: 'element', elementIds: ['native'], x: 0.25, y: 0.75 },
    };
    const first = await call('artifact_feedback', args);
    const retry = await call('artifact_feedback', args);
    expect(retry.contextId).toBe(first.contextId);
    expect(retry.feedback).toHaveLength(1);
    expect(first.feedback[0]).toMatchObject({ versions: { native: 1 }, anchor: args.anchor });
    const context = await call('artifact_read', { mode: 'context', contextId: first.contextId });
    expect(context.sources[0]).toMatchObject({
      elementId: 'native',
      version: 1,
      element: { text: 'Clicked content', x: 10, y: 20, version: 1 },
    });
    await failure('artifact_feedback', { ...args, versions: { native: 2 } }, 'OPERATION_REUSED');
    await failure(
      'artifact_feedback',
      { ...args, operationId: randomUUID(), versions: { native: 99 } },
      'CONFLICT',
    );
    await failure(
      'artifact_feedback',
      { ...args, operationId: randomUUID(), versions: {} },
      'INVALID_ARGUMENT',
    );
  });

  it('roundtrips immutable display batches, adjacent unit diffs and CAS-protected partial restore', async () => {
    const first = await add([
      { id: 'a', type: 'text', text: 'A' },
      { id: 'b', type: 'text', text: 'B' },
    ]);
    const second = await apply({
      expectedVersions: { a: 1, b: 1 },
      operations: [
        { op: 'update', id: 'a', changes: { text: 'A2' } },
        { op: 'update', id: 'b', changes: { text: 'B2' } },
      ],
    });
    const history = await call('artifact_read', { mode: 'history' });
    expect(history.history).toHaveLength(3);
    expect(history.batches.at(-1)).toMatchObject({
      id: second.historyEntry.id,
      firstVersionId: first.historyEntry.id,
      versionIds: [first.historyEntry.id, second.historyEntry.id],
    });
    const adjacent = await call('artifact_read', {
      mode: 'diff',
      versionId: first.historyEntry.id,
      adjacent: true,
      ids: ['a'],
    });
    expect(adjacent.units).toEqual([
      { id: 'a', before: null, after: expect.objectContaining({ text: 'A', version: 1 }) },
    ]);
    const selected = await call('artifact_read', {
      mode: 'diff',
      fromVersionId: first.historyEntry.id,
      toVersionId: second.historyEntry.id,
      ids: ['a'],
    });
    expect(selected.units).toEqual([
      {
        id: 'a',
        before: expect.objectContaining({ text: 'A' }),
        after: expect.objectContaining({ text: 'A2' }),
      },
    ]);
    const args = {
      operationId: randomUUID(),
      expectedVersions: { a: 2 },
      operations: [{ op: 'restore', versionId: first.historyEntry.id, ids: ['a'] }],
    };
    const restored = await apply(args);
    expect(restored.historyEntry).toMatchObject({
      changedIds: ['a'],
      restoredFrom: first.historyEntry.id,
    });
    expect(await apply(args)).toEqual(restored);
    const objects = await call('artifact_read', { mode: 'objects', ids: ['a', 'b'] });
    expect(objects.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a', text: 'A', version: 3 }),
        expect.objectContaining({ id: 'b', text: 'B2', version: 2 }),
      ]),
    );
    await applyFailure({ ...args, operationId: randomUUID() }, 'CONFLICT');
    const binding = { ...fixtureBinding! };
    await call('artifact_activity', { action: 'end', ...binding, outcome: 'completed' });
    expect(await call('artifact_apply', { ...binding, ...args })).toEqual(restored);
  });

  it('preserves the task binding for proposal content application and active withdrawal over MCP', async () => {
    await add([{ id: 'proposal-target', type: 'text', text: 'Original' }]);
    const suggested = await call('artifact_feedback', {
      action: 'suggest',
      text: 'Choose wording',
      expectedVersions: { 'proposal-target': 1 },
      options: [
        {
          id: 'option-a',
          label: 'A',
          operations: [{ op: 'update', id: 'proposal-target', changes: { text: 'Option A' } }],
        },
        {
          id: 'option-b',
          label: 'B',
          operations: [{ op: 'update', id: 'proposal-target', changes: { text: 'Option B' } }],
        },
      ],
    });
    const feedbackId = suggested.feedback[0].id;
    const binding = { ...fixtureBinding! };
    await failure(
      'artifact_feedback',
      { action: 'choose', feedbackId, optionId: 'option-a', operationId: randomUUID() },
      'TASK_REQUIRED',
    );
    await call('artifact_feedback', {
      action: 'choose',
      feedbackId,
      optionId: 'option-a',
      operationId: randomUUID(),
      ...binding,
    });
    expect(execution?.args).toMatchObject(binding);
    expect(
      (await call('artifact_read', { mode: 'objects', ids: ['proposal-target'] })).elements[0],
    ).toMatchObject({ text: 'Option A', version: 2 });
    await failure(
      'artifact_feedback',
      { action: 'withdraw', feedbackId, optionId: 'option-a', operationId: randomUUID() },
      'TASK_REQUIRED',
    );
    await call('artifact_feedback', {
      action: 'withdraw',
      feedbackId,
      optionId: 'option-a',
      operationId: randomUUID(),
      ...binding,
    });
    expect(execution?.args).toMatchObject(binding);
    expect(
      (await call('artifact_read', { mode: 'objects', ids: ['proposal-target'] })).elements[0],
    ).toMatchObject({ text: 'Original', version: 3 });
    await call('artifact_activity', { action: 'end', ...binding, outcome: 'completed' });
    await failure(
      'artifact_feedback',
      { action: 'choose', feedbackId, optionId: 'option-b', operationId: randomUUID(), ...binding },
      'TASK_CLOSED',
    );
  });

  it('roundtrips the order unit clock and safely undoes and redoes real layer changes', async () => {
    await add(['a', 'b', 'c'].map((id) => ({ id, type: 'text', text: id })));
    const baseline = await call('artifact_read', { mode: 'objects', ids: ['$order'] });
    expect(baseline.units).toEqual([{ id: '$order', value: { version: 3, ids: ['a', 'b', 'c'] } }]);
    const reordered = await apply({
      expectedVersions: { a: 1, $order: baseline.orderVersion },
      operations: [{ op: 'layout', preset: 'front', ids: ['a'] }],
    });
    expect(reordered.historyEntry.changedIds).toEqual(['a', '$order']);
    const undo = await apply({
      expectedRevision: reordered.artifact.revision,
      operations: [{ op: 'restore', versionId: reordered.historyEntry.id, data: { mode: 'undo' } }],
    });
    expect(
      (await call('artifact_read', { mode: 'objects', ids: ['a', 'b', 'c'] })).elements.map(
        (element: { id: string }) => element.id,
      ),
    ).toEqual(['a', 'b', 'c']);
    await apply({
      expectedRevision: undo.artifact.revision,
      operations: [{ op: 'restore', versionId: undo.historyEntry.id, data: { mode: 'undo' } }],
    });
    const result = await call('artifact_read', { mode: 'objects', ids: ['a', 'b', 'c'] });
    expect(result.orderVersion).toBe(6);
    expect(result.elements.map((element: { id: string }) => element.id)).toEqual(['b', 'c', 'a']);
    await applyFailure(
      {
        expectedVersions: { b: 1, $order: baseline.orderVersion },
        operations: [{ op: 'layout', preset: 'front', ids: ['b'] }],
      },
      'CONFLICT',
    );
  });

  it('roundtrips all coordinate spaces and rejects invalid coordinates or versions at the protocol/domain boundary', async () => {
    await add([
      { id: 'native', type: 'shape' },
      { id: 'region', type: 'html', html: '<h1>Original</h1>' },
    ]);
    const anchors = [
      { coordinateSpace: 'board', x: -300, y: 800, w: 400, h: 250 },
      { coordinateSpace: 'element', elementIds: ['native'], x: 0.2, y: 0.8 },
      {
        coordinateSpace: 'html',
        regionId: 'region',
        sourceRevision: 1,
        x: 30,
        y: 40,
        w: 120,
        h: 60,
      },
    ];

    for (const anchor of anchors) {
      const versions: Record<string, number> = {};
      if (anchor.regionId) {
        versions.region = 1;
      } else if (anchor.elementIds) {
        versions.native = 1;
      }

      const result = await call('artifact_feedback', {
        action: 'create',
        text: 'Target',
        anchor,
        versions,
      });
      expect(result.feedback[0].anchor).toEqual(anchor);
    }

    await failure('artifact_feedback', {
      action: 'create',
      text: 'Invalid',
      anchor: { coordinateSpace: 'screen' },
    });
    await failure(
      'artifact_feedback',
      {
        action: 'create',
        text: 'Invalid',
        anchor: { coordinateSpace: 'element', elementIds: ['native'], x: 1.1 },
      },
      'INVALID_ARGUMENT',
    );
    await failure(
      'artifact_feedback',
      { action: 'create', text: 'Invalid', anchor: { coordinateSpace: 'html' } },
      'INVALID_ARGUMENT',
    );
    await failure('artifact_feedback', {
      action: 'create',
      text: 'Invalid',
      anchor: { coordinateSpace: 'board', w: -1 },
    });
    await failure('artifact_feedback', {
      action: 'create',
      text: 'Invalid',
      anchor: { elementIds: ['native'] },
      versions: { native: 0 },
    });
  });

  it('accepts locked content edits over MCP and refuses geometry or batch-unlock bypasses', async () => {
    await add([
      {
        id: 'region',
        type: 'html',
        locked: true,
        html: '<h1>Original</h1>',
        x: 20,
        y: 30,
        w: 600,
        h: 400,
      },
    ]);
    await apply({
      expectedVersions: { region: 1 },
      operations: [
        {
          op: 'update',
          id: 'region',
          changes: { html: '<h2>Changed</h2>', state: { tab: 2 }, fill: '#abcdef' },
        },
      ],
    });
    await applyFailure(
      {
        expectedVersions: { region: 2 },
        operations: [{ op: 'update', id: 'region', changes: { x: 100 } }],
      },
      'LOCKED',
    );
    await applyFailure(
      {
        expectedVersions: { region: 2 },
        operations: [
          { op: 'update', id: 'region', changes: { locked: false } },
          { op: 'delete', id: 'region' },
        ],
      },
      'LOCKED',
    );
    const document = await call('artifact_read', { mode: 'objects', ids: ['region'] });
    expect(document.elements[0]).toMatchObject({
      locked: true,
      x: 20,
      htmlLength: '<h2>Changed</h2>'.length,
      state: { tab: 2 },
      fill: '#abcdef',
      version: 2,
    });
    expect(document.elements[0]).not.toHaveProperty('html');
    expect((await call('artifact_read', { mode: 'source', regionId: 'region' })).html).toBe(
      '<h2>Changed</h2>',
    );
  });

  it('roundtrips single permanent deletion only after trashing and rejects malformed batches before deletion', async () => {
    expect(await call('artifact_manage', { action: 'purge' })).toMatchObject({
      deletedIds: [],
      failures: [{ artifactId, code: 'NOT_TRASHED' }],
    });
    await call('artifact_manage', { action: 'trash' });
    await failure(
      'artifact_manage',
      { action: 'purge', artifactIds: [artifactId] },
      'INVALID_ARGUMENT',
    );
    await failure(
      'artifact_manage',
      { action: 'purge', artifactId: undefined },
      'INVALID_ARGUMENT',
    );
    await failure('artifact_manage', { action: 'purge', artifactId: undefined, artifactIds: [] });
    await failure('artifact_manage', {
      action: 'purge',
      artifactId: undefined,
      artifactIds: Array.from({ length: 101 }, () => artifactId),
    });
    expect(
      (await call('artifact_list', { trashed: true })).artifacts.map(
        (item: { id: string }) => item.id,
      ),
    ).toContain(artifactId);
    expect(await call('artifact_manage', { action: 'purge' })).toEqual({
      deletedIds: [artifactId],
      failures: [],
    });
    await failure('artifact_read', { mode: 'summary' }, 'NOT_FOUND');
  });

  it('roundtrips batch permanent deletion with deduplication and explicit active/missing failures', async () => {
    const second = (
      await call('artifact_manage', { action: 'create', title: 'Second trash entry' })
    ).artifact.id;
    const active = (await call('artifact_manage', { action: 'create', title: 'Keep active' }))
      .artifact.id;
    await call('artifact_manage', { action: 'trash' });
    await call('artifact_manage', { action: 'trash', artifactId: second });
    const result = await client.callTool({
      name: 'artifact_manage',
      arguments: {
        action: 'purge',
        artifactIds: [artifactId, second, artifactId, active, 'missing-work'],
      },
    });
    expect(result.isError).not.toBe(true);
    const data = (result.structuredContent as unknown as ToolResponse<any>).data;
    expect(data.deletedIds).toEqual([artifactId, second]);
    expect(data.failures).toMatchObject([
      { artifactId: active, code: 'NOT_TRASHED' },
      { artifactId: 'missing-work', code: 'NOT_FOUND' },
    ]);
    expect(
      (await call('artifact_list', {})).artifacts.map((item: { id: string }) => item.id),
    ).toEqual([active]);
    expect((await call('artifact_list', { trashed: true })).artifacts).toEqual([]);
  });

  it('keeps native frozen elements in model context while paginating HTML without its nested duplicate', async () => {
    const html = `<section><p>${'Original diagram 🎨 '.repeat(20_000)}</p></section>`;
    expect(html.length).toBeGreaterThan(240_000);
    await add([
      { id: 'native', type: 'text', text: 'Frozen native' },
      { id: 'region', type: 'html', html },
    ]);
    const feedback = await call('artifact_feedback', {
      action: 'create',
      text: 'Mixed selection',
      anchor: {
        coordinateSpace: 'board',
        elementIds: ['native', 'region'],
        x: 0,
        y: 0,
        w: 800,
        h: 600,
      },
      versions: { native: 1, region: 1 },
    });
    await apply({
      expectedVersions: { native: 1, region: 1 },
      operations: [
        { op: 'update', id: 'native', changes: { text: 'Current native' } },
        { op: 'update', id: 'region', changes: { html: '<p>Current HTML</p>' } },
      ],
    });
    const context = await call('artifact_read', {
      mode: 'context',
      feedbackId: feedback.contextId,
    });
    expect(context.sources[0]).toMatchObject({
      elementId: 'native',
      element: { text: 'Frozen native', version: 1 },
    });
    expect(context.sources[1]).toMatchObject({
      regionId: 'region',
      sourceRevision: 1,
      htmlLength: html.length,
      element: { version: 1 },
      readWith: expect.stringContaining('source'),
    });
    expect(context.sources[1]).not.toHaveProperty('html');
    expect(context.sources[1].element).not.toHaveProperty('html');
    expect(JSON.stringify(context).length).toBeLessThan(10_000);
    const native = await call('artifact_read', {
      mode: 'source',
      feedbackId: feedback.contextId,
      elementId: 'native',
    });
    expect(native.element.text).toBe('Frozen native');
    expect(native).not.toHaveProperty('sources');
    let cursor: string | undefined;
    let combined = '';
    do {
      const page = await call('artifact_read', {
        mode: 'source',
        feedbackId: feedback.contextId,
        regionId: 'region',
        ...(cursor ? { cursor } : {}),
        limit: 32 * 1024,
      });
      expect(page.totalLength).toBe(html.length);
      expect(page.element).not.toHaveProperty('html');
      expect(page).not.toHaveProperty('sources');
      expect(
        Buffer.byteLength(JSON.stringify({ ok: true, data: page }), 'utf8'),
      ).toBeLessThanOrEqual(32 * 1024);
      combined += page.html;
      cursor = page.nextCursor;
    } while (cursor);

    expect(combined).toBe(html);
  });

  it('slices retained history before reply and rejects a stale cursor or an oversized page', async () => {
    for (let revision = 1; revision <= 23; revision++) {
      await service.execute('artifact_manage', {
        artifactId,
        action: 'rename',
        title: `修订 ${revision}`,
      });
    }

    const first = await call('artifact_read', { mode: 'history', limit: 3 });
    expect(first.history.map((entry: { revision: number }) => entry.revision)).toEqual([
      21, 22, 23,
    ]);
    expect(first).toMatchObject({ totalCount: 24, nextOffset: 3, nextCursor: expect.any(String) });
    const second = await call('artifact_read', {
      mode: 'history',
      cursor: first.nextCursor,
      limit: 3,
    });
    expect(second.history.map((entry: { revision: number }) => entry.revision)).toEqual([
      18, 19, 20,
    ]);
    expect((await call('artifact_read', { mode: 'history', limit: 20 })).history).toHaveLength(20);
    await failure('artifact_read', { mode: 'history', limit: 21 }, 'LIMIT_EXCEEDED');
    await failure(
      'artifact_read',
      { mode: 'summary', cursor: first.nextCursor },
      'INVALID_ARGUMENT',
    );
    await service.execute('artifact_manage', { artifactId, action: 'rename', title: '新修订' });
    await failure('artifact_read', { mode: 'history', cursor: first.nextCursor }, 'CURSOR_STALE');
    expect(
      (await service.execute('artifact_read', { artifactId, mode: 'history' })).history,
    ).toHaveLength(25);
  });

  it('requires precise model read and export targets while retaining full reads for the App', async () => {
    const { historyEntry } = await add(
      Array.from({ length: 12 }, (_, index) => ({
        id: `item-${index}`,
        type: 'text',
        text: `组件 ${index}`,
      })),
    );
    await failure('artifact_read', { mode: 'objects' }, 'INVALID_ARGUMENT');
    await failure('artifact_read', { mode: 'units', atRevision: 1 }, 'INVALID_ARGUMENT');
    await failure(
      'artifact_read',
      { mode: 'objects', ids: Array.from({ length: 11 }, (_, index) => `item-${index}`) },
      'LIMIT_EXCEEDED',
    );
    await failure(
      'artifact_read',
      { mode: 'diff', versionId: historyEntry.id, adjacent: true },
      'INVALID_ARGUMENT',
    );
    await failure('artifact_read', { mode: 'version', versionId: historyEntry.id }, 'APP_ONLY');
    await failure('artifact_read', { mode: 'document' }, 'APP_ONLY');
    await failure('artifact_feedback', { action: 'preview', feedbackId: 'example' }, 'APP_ONLY');
    await failure('artifact_export', { format: 'json' }, 'INVALID_ARGUMENT');
    await failure('artifact_export', { format: 'zip', ids: ['item-0'] }, 'APP_ONLY');
    await expect(
      service.execute('artifact_export', { artifactId, format: 'ZIP', ids: ['item-0'] }, actor),
    ).rejects.toMatchObject({ code: 'APP_ONLY' });
    await failure(
      'artifact_export',
      { format: 'png', ids: ['item-0'], viewId: 'example' },
      'LIVE_CAPTURE_REQUIRED',
    );
    const diff = await call('artifact_read', {
      mode: 'diff',
      versionId: historyEntry.id,
      adjacent: true,
      ids: ['item-0'],
    });
    expect(diff.units).toMatchObject([{ id: 'item-0', before: null, after: { text: '组件 0' } }]);
    expect(diff).not.toHaveProperty('changes');
    expect(
      (await service.execute('artifact_read', { artifactId, mode: 'document' })).elements,
    ).toHaveLength(12);
  });

  it('finds Chinese snippets with bounded scope and keeps the cursor tied to its query and revision', async () => {
    await add(
      Array.from({ length: 13 }, (_, index) => ({
        id: `item-${index}`,
        type: 'text',
        text: `系统架构 ${index}`,
        x: index * 40,
        y: 0,
        w: 30,
        h: 35,
      })),
    );
    const first = await call('artifact_read', { mode: 'search', query: '架构', limit: 4 });
    expect(first.items).toHaveLength(4);
    expect(first.items[0]).toMatchObject({
      id: 'item-0',
      version: 1,
      snippet: expect.stringContaining('架构'),
      bounds: { x: 0, y: 0, w: 30, h: 35 },
    });
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await call('artifact_read', {
      mode: 'search',
      query: '架构',
      cursor: first.nextCursor,
      limit: 4,
    });
    expect(second.items[0]).toMatchObject({ id: 'item-4' });
    await failure(
      'artifact_read',
      { mode: 'search', query: '组件', cursor: first.nextCursor },
      'INVALID_ARGUMENT',
    );
    const region = await call('artifact_read', {
      mode: 'region',
      rect: { x: 75, y: -1, w: 38, h: 40 },
    });
    expect(region.items.map((item: { id: string }) => item.id)).toEqual(['item-2']);
    await apply({
      expectedVersions: { 'item-0': 1 },
      operations: [{ op: 'update', id: 'item-0', changes: { text: '修订后' } }],
    });
    await failure(
      'artifact_read',
      { mode: 'search', query: '架构', cursor: first.nextCursor },
      'CURSOR_STALE',
    );
    const historical = await call('artifact_read', {
      mode: 'source',
      elementId: 'item-0',
      atRevision: 1,
    });
    expect(JSON.parse(historical.json)).toMatchObject({
      id: 'item-0',
      text: '系统架构 0',
      version: 1,
    });
  });

  it('returns one bounded PNG image and a separate saved-render receipt without exposing bytes as model text', async () => {
    await add([
      {
        id: 'capture-target',
        type: 'shape',
        kind: 'rect',
        x: 0,
        y: 0,
        w: 100,
        h: 80,
        fill: '#417a9c',
      },
    ]);
    const arguments_ = {
      artifactId,
      format: 'png',
      rect: { x: 0, y: 0, w: 120, h: 90 },
      atRevision: 1,
    };
    const captured = await client.callTool({ name: 'artifact_export', arguments: arguments_ });
    expect(captured.isError).not.toBe(true);
    expect(captured.structuredContent).toMatchObject({
      ok: true,
      data: {
        source: 'saved-render',
        revision: 1,
        width: 120,
        height: 90,
        ids: ['capture-target'],
        bounds: arguments_.rect,
        downloadPath: expect.any(String),
      },
    });
    expect((captured.structuredContent as unknown as ToolResponse).data).not.toHaveProperty(
      'image',
    );
    const content = (captured.content as { type: string; mimeType: string; data: string }[])[0];
    expect(captured.content).toHaveLength(1);
    expect(content).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(Buffer.from(content.data, 'base64').subarray(0, 8).toString('hex')).toBe(
      '89504e470d0a1a0a',
    );
    expect(Buffer.byteLength(content.data, 'base64')).toBeLessThanOrEqual(1024 * 1024);
    const pathOnly = await client.callTool({
      name: 'artifact_export',
      arguments: { ...arguments_, includeImage: false },
    });
    expect(pathOnly.content).toEqual([]);
    expect(pathOnly.structuredContent).toMatchObject({
      ok: true,
      data: { revision: 1, downloadPath: expect.any(String) },
    });
  });

  it('lists only requested task rows and keeps other nodes out of the update receipt', async () => {
    await add([
      {
        id: 'list-a',
        type: 'todo',
        text: '发布验收',
        data: {
          items: [
            { id: 'scope', text: '整理需求', checked: true },
            { id: 'limits', text: '核对读取上限', checked: false },
            { id: 'scale', text: '验证缩放显示', checked: false },
          ],
        },
      },
    ]);
    const selected = await call('artifact_read', {
      mode: 'tasks',
      elementId: 'list-a',
      checked: false,
      limit: 1,
    });
    expect(selected).toMatchObject({
      version: 1,
      elementId: 'list-a',
      totalCount: 2,
      items: [{ id: 'limits' }],
      nextCursor: expect.any(String),
    });
    const next = await call('artifact_read', {
      mode: 'tasks',
      elementId: 'list-a',
      checked: false,
      cursor: selected.nextCursor,
    });
    expect(next.items).toMatchObject([{ id: 'scale' }]);
    await failure(
      'artifact_read',
      { mode: 'tasks', elementId: 'list-a', checked: true, cursor: selected.nextCursor },
      'INVALID_ARGUMENT',
    );
    const object = await call('artifact_read', { mode: 'objects', ids: ['list-a'] });
    expect(object.elements[0]).toMatchObject({
      id: 'list-a',
      readWith: 'artifact_read tasks + elementId',
    });
    expect(object.elements[0]).not.toHaveProperty('data');
    const anchor = {
      coordinateSpace: 'todo',
      elementIds: ['list-a'],
      itemId: 'limits',
      sourceVersion: 1,
      pin: { coordinateSpace: 'todo', x: 0.4, y: 0.7 },
    };
    const feedback = await call('artifact_feedback', {
      action: 'create',
      anchor,
      text: '按这一行核对',
      versions: { 'list-a': 1 },
    });
    expect(feedback.feedback[0].anchor).toMatchObject(anchor);
    const edited = await apply({
      expectedVersions: { 'list-a': 1 },
      operations: [
        {
          op: 'todo',
          id: 'list-a',
          data: { operations: [{ op: 'update', id: 'limits', changes: { checked: true } }] },
        },
      ],
    });
    expect(edited).toMatchObject({
      artifact: { revision: 3 },
      historyEntry: { changedIds: ['list-a'] },
    });
    expect(edited).not.toHaveProperty('board');
    expect(
      (await call('artifact_read', { mode: 'tasks', elementId: 'list-a', itemIds: ['limits'] }))
        .items,
    ).toMatchObject([{ id: 'limits', checked: true }]);
    expect(
      (
        await call('artifact_read', {
          mode: 'tasks',
          elementId: 'list-a',
          feedbackId: feedback.contextId,
          itemIds: ['limits'],
        })
      ).items,
    ).toMatchObject([{ id: 'limits', checked: false }]);
  });
});
