import { BoardCatalogService } from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { FeedbackService } from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { Buffer } from 'node:buffer';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, test } from 'vitest';
import { createStudioMcpServer, type LocalRequest } from '../../src/entrypoints/mcp/index.js';
import { actorHeader, callWhiteboard } from '../support/whiteboard-client.js';
import {
  editorId,
  lockedId,
  mainBoardId,
  outsiderId,
  shapeId,
  viewerId,
} from '../support/whiteboard-database.js';
import { useWhiteboardTestServer } from './whiteboard-test-server.js';

const http = useWhiteboardTestServer((request) => {
  const principalId = request.headers[actorHeader];
  if (typeof principalId !== 'string') {
    return;
  }

  const authorId = request.headers['x-test-feedback-author'];
  const model = request.headers['x-test-feedback-transport'] === 'agent';

  return model
    ? {
        id: principalId,
        kind: 'agent',
        feedbackAuthorId: typeof authorId === 'string' ? authorId : undefined,
      }
    : { id: principalId, kind: 'human' };
});

let fixtureSequence = 0;

async function fixture(actor = editorId, artifactId = mainBoardId) {
  const files: { filename: string; bytes: Uint8Array }[] = [];
  const connection = ++fixtureSequence;
  let next = 0;

  function dispatch(request: LocalRequest, signal: AbortSignal, feedbackAuthorId?: string) {
    const headers = new Headers({ [actorHeader]: actor });
    if (request.mediaType) {
      headers.set('content-type', request.mediaType);
    }
    if (feedbackAuthorId) {
      headers.set('x-test-feedback-transport', 'agent');
      headers.set('x-test-feedback-author', feedbackAuthorId);
    }

    return fetch(new URL(request.route, http.address), {
      method: request.method,
      body: request.body instanceof Uint8Array ? Buffer.from(request.body) : request.body,
      headers,
      signal,
    });
  }

  const server = createStudioMcpServer({
    html: '<html></html>',
    pluginVersion: '1.0.0',
    now: () => 0,
    allocateId: () => `artifact-tool-${connection}-${++next}`,
    createFile: () => Promise.reject(new Error('Unexpected app spool request.')),
    async writeExportFile(filename, bytes) {
      files.push({ filename, bytes });

      return 'fixture-exports/' + filename;
    },
    dispatch,
    dispatchAgentFeedback: (agentId, request, signal) => dispatch(request, signal, agentId),
    onError() {},
  });
  const client = new Client({ name: 'artifact-tool-check', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    files,
    call: (name: string, request: Record<string, unknown>) =>
      client.callTool({ name, arguments: { artifactId, ...request } }),
    list: () => client.listTools(),
    async close() {
      await client.close();
      await server.close();
    },
  };
}

const feedbackTool = 'artifact_feedback';
const exportTool = 'artifact_export';

interface FeedbackData {
  readonly threadId: string;
  readonly threadVersion: string;
  readonly messageId: string;
  readonly messageVersion: string;
}

type ToolFixture = Awaited<ReturnType<typeof fixture>>;
type ToolResult = Awaited<ReturnType<ToolFixture['call']>>;

function applied(result: ToolResult): FeedbackData {
  const content = result.structuredContent as { ok?: boolean; data?: FeedbackData };
  if (!content.ok || !content.data) {
    throw new Error('Feedback change did not apply: ' + JSON.stringify(result));
  }

  return content.data;
}

function createComment(client: ToolFixture) {
  return client.call(feedbackTool, {
    action: 'create',
    operationId: 'create-feedback',
    text: '请核对初始布局',
    anchor: {
      coordinateSpace: 'element',
      objectId: shapeId,
      geometryVersion: '0',
      u: 0.5,
      v: 0.25,
    },
  });
}

test('changes model feedback through real versioned routes and recovers a durable receipt', async () => {
  const client = await fixture();
  try {
    const tools = await client.list();
    expect(tools.tools.find(({ name }) => name === feedbackTool)?._meta).toEqual({
      ui: { visibility: ['model'] },
    });
    const thread = applied(await createComment(client));
    expect(applied(await createComment(client))).toEqual(thread);
    const reply = {
      action: 'reply',
      operationId: 'reply-once',
      feedbackId: thread.threadId,
      text: '确认前一处。',
    };
    const message = applied(await client.call(feedbackTool, reply));
    expect(applied(await client.call(feedbackTool, reply))).toEqual(message);
    expect(
      applied(
        await client.call(feedbackTool, {
          action: 'receipt',
          operationId: 'reply-once',
        }),
      ),
    ).toEqual(message);
    const before = (
      await client.call(feedbackTool, {
        action: 'get',
        feedbackId: thread.threadId,
      })
    ).structuredContent;
    expect(before).toMatchObject({ ok: true, data: { replies: [{ text: '确认前一处。' }] } });

    const edited = applied(
      await client.call(feedbackTool, {
        action: 'edit',
        operationId: 'edit-reply',
        feedbackId: thread.threadId,
        replyId: message.messageId,
        expectedMessageVersion: message.messageVersion,
        text: '确认全部已更新。',
      }),
    );
    const stale = await client.call(feedbackTool, {
      action: 'edit',
      operationId: 'stale-reply',
      feedbackId: thread.threadId,
      replyId: message.messageId,
      expectedMessageVersion: message.messageVersion,
      text: '不应覆盖',
    });
    expect(stale.structuredContent).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
    const resolved = applied(
      await client.call(feedbackTool, {
        action: 'resolve',
        operationId: 'resolve-feedback',
        feedbackId: thread.threadId,
        expectedThreadVersion: edited.threadVersion,
      }),
    );
    const open = await client.call(feedbackTool, { action: 'list', status: 'open' });
    expect(JSON.stringify(open.structuredContent)).not.toContain(thread.threadId);
    const reopened = applied(
      await client.call(feedbackTool, {
        action: 'reopen',
        operationId: 'reopen-feedback',
        feedbackId: thread.threadId,
        expectedThreadVersion: resolved.threadVersion,
      }),
    );
    const removed = await client.call(feedbackTool, {
      action: 'delete',
      operationId: 'delete-feedback',
      feedbackId: thread.threadId,
      expectedThreadVersion: reopened.threadVersion,
    });
    expect(removed.structuredContent).toMatchObject({ ok: true, data: { deleted: true } });
    const missing = await client.call(feedbackTool, { action: 'receipt', operationId: 'absent' });
    expect(missing.structuredContent).toMatchObject({ ok: true, data: { state: 'notRecorded' } });
  } finally {
    await client.close();
  }
});

test('separates the browser owner and two MCP connections when signing and editing messages', async () => {
  const owner = 'browser-owner';
  const { applyFeedback, getThread } = FeedbackService.method;
  const created = await callWhiteboard(
    http.address,
    owner,
    BoardCatalogService.method.createBoard,
    {
      commandId: 'owner-board',
      title: 'Browser owner and agents',
    },
  );

  if (created.receipt?.outcome.case !== 'created') {
    throw new Error('The browser owner could not create the board.');
  }

  const { boardId } = created.receipt.outcome.value;
  const { receipt } = await callWhiteboard(http.address, owner, applyFeedback, {
    boardId,
    commandId: 'owner-comment',
    operation: {
      case: 'create',
      value: {
        text: '房主备注',
        anchor: { target: { case: 'boardPoint', value: { x: 4, y: 9 } } },
      },
    },
  });

  if (receipt?.outcome.case !== 'applied') {
    throw new Error('The browser owner could not create the thread.');
  }

  const { threadId, messageId, messageVersion } = receipt.outcome.value;
  const first = await fixture(owner, boardId);
  const second = await fixture(owner, boardId);
  try {
    const comment = {
      action: 'create',
      commandId: 'owner-comment',
      text: '模型备注',
      anchor: { coordinateSpace: 'board', x: 4, y: 9 },
    };
    const [firstComment, secondComment] = await Promise.all([
      first.call(feedbackTool, comment),
      second.call(feedbackTool, comment),
    ]);
    const firstThread = applied(firstComment).threadId;
    const secondThread = applied(secondComment).threadId;
    expect(new Set([threadId, firstThread, secondThread]).size).toBe(3);
    const reviewed = await callWhiteboard(http.address, owner, getThread, {
      boardId,
      threadId: firstThread,
    });
    expect(reviewed.thread).toMatchObject({ canDelete: true, first: { canEdit: false } });

    const reply = { action: 'reply', threadId, commandId: 'same-command' };
    const firstReply = applied(
      await first.call(feedbackTool, { ...reply, text: 'Agent 一的回复' }),
    );
    const secondReply = applied(
      await second.call(feedbackTool, { ...reply, text: 'Agent 二的回复' }),
    );
    expect(firstReply.messageId).not.toBe(secondReply.messageId);
    expect(
      applied(await first.call(feedbackTool, { action: 'receipt', commandId: 'same-command' })),
    ).toEqual(firstReply);
    expect(
      applied(await second.call(feedbackTool, { action: 'receipt', commandId: 'same-command' })),
    ).toEqual(secondReply);

    const saved = await callWhiteboard(http.address, owner, getThread, {
      boardId,
      threadId,
    });
    expect(saved.thread?.first).toMatchObject({ authorActorId: owner, canEdit: true });
    const authors = saved.replies.map((message) => message.authorActorId);
    expect(new Set([owner, ...authors]).size).toBe(3);
    expect(new Set(saved.replies.map((message) => message.authorName)).size).toBe(2);
    expect(saved.replies.map(({ authorName, canEdit }) => [authorName, canEdit])).toEqual([
      [expect.stringMatching(/^Codex · /u), false],
      [expect.stringMatching(/^Codex · /u), false],
    ]);

    const firstView = await first.call(feedbackTool, { action: 'get', threadId });
    expect(firstView.structuredContent).toMatchObject({
      ok: true,
      data: {
        replies: expect.arrayContaining([
          expect.objectContaining({
            messageId: firstReply.messageId,
            authoredByViewer: true,
            canEdit: true,
          }),
          expect.objectContaining({ messageId: secondReply.messageId }),
        ]),
      },
    });
    expect(firstView.structuredContent).not.toMatchObject({
      data: {
        replies: expect.arrayContaining([
          expect.objectContaining({ messageId: secondReply.messageId, canEdit: true }),
        ]),
      },
    });
    const impersonation = await first.call(feedbackTool, {
      ...reply,
      commandId: 'forged-author',
      authorActorId: owner,
      text: '不能把模型回复署名为房主',
    });
    expect(impersonation.isError).toBe(true);

    const edit = (target: string | undefined, version: string | bigint | undefined) =>
      first.call(feedbackTool, {
        action: 'edit',
        threadId,
        commandId: 'edit-' + target,
        messageId: target,
        expectedMessageVersion: String(version),
        text: '修改留痕',
      });
    expect((await edit(messageId, messageVersion)).structuredContent).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
    expect(
      (await edit(secondReply.messageId, secondReply.messageVersion)).structuredContent,
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(
      (await edit(firstReply.messageId, firstReply.messageVersion)).structuredContent,
    ).toMatchObject({ ok: true });
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test('leaves feedback write permissions to the authenticated whiteboard actor', async () => {
  const readOnly = await fixture(viewerId);
  try {
    const list = await readOnly.call(feedbackTool, { action: 'list' });
    expect(list.structuredContent).toMatchObject({ ok: true });
    const comment = await createComment(readOnly);
    expect(comment.structuredContent).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const pending = await readOnly.call(feedbackTool, { action: 'receipt', operationId: 'absent' });
    expect(pending.structuredContent).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  } finally {
    await readOnly.close();
  }
});

test('freezes a grouped model feedback anchor against its saved object versions', async () => {
  const client = await fixture();
  try {
    const created = await client.call(feedbackTool, {
      action: 'create',
      operationId: 'group-feedback',
      text: '请核对这两个对象。',
      anchor: {
        coordinateSpace: 'selection',
        elementIds: [shapeId, lockedId],
        expectedBoardRevision: '0',
        x: 30,
        y: 40,
      },
    });
    const { threadId } = applied(created);
    const read = await client.call(feedbackTool, { action: 'get', feedbackId: threadId });
    expect(read.structuredContent).toMatchObject({
      ok: true,
      data: {
        thread: {
          anchor: {
            target: {
              selection: {
                point: { x: 30, y: 40 },
                objects: [{ objectId: shapeId }, { objectId: lockedId }],
              },
            },
          },
        },
      },
    });
  } finally {
    await client.close();
  }
});

test('writes real saved and historical files and tells rich exports apart from browser plans', async () => {
  const client = await fixture(viewerId);
  try {
    const html = await client.call(exportTool, { format: 'html' });
    expect(html.structuredContent).toMatchObject({
      ok: true,
      data: {
        kind: 'file',
        revision: '0',
        mimeType: 'text/html',
        downloadPath: 'fixture-exports/Architecture.html',
      },
    });
    const markup = new TextDecoder().decode(client.files[0]?.bytes);
    expect(markup).toContain('<!doctype html>');
    expect(markup).toContain('Architecture');

    const png = await client.call(exportTool, { format: 'png', ids: [shapeId], atRevision: '0' });
    expect(png.structuredContent).toMatchObject({
      ok: true,
      data: { kind: 'file', revision: '0', mimeType: 'image/png' },
    });
    expect(png.content).toMatchObject([{ type: 'image', mimeType: 'image/png' }]);
    expect([...client.files[1]!.bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);

    const rich = await client.call(exportTool, { format: 'svg' });
    expect(rich.structuredContent).toMatchObject({
      ok: true,
      data: { kind: 'browserRenderRequired' },
    });
    expect(client.files).toHaveLength(2);
  } finally {
    await client.close();
  }
});

test('enforces board access and reports revision and scope conflicts before writing files', async () => {
  const allowed = await fixture();
  const denied = await fixture(outsiderId);
  try {
    const old = await allowed.call(exportTool, { format: 'json', expectedRevision: '999' });
    expect(old.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', currentRevision: '0' },
    });
    const archive = await allowed.call(exportTool, { format: 'zip', ids: [shapeId] });
    expect(archive.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
    const closed = await denied.call(exportTool, { format: 'json' });
    expect(closed.structuredContent).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(allowed.files).toHaveLength(0);
    expect(denied.files).toHaveLength(0);
  } finally {
    await Promise.all([allowed.close(), denied.close()]);
  }
});

test('exports an exact world rectangle as PNG with independent pixel scaling', async () => {
  const client = await fixture(viewerId);
  try {
    const rect = { x: 8, y: -20, w: 64, h: 40 };
    const base = await client.call(exportTool, { format: 'png', rect });
    expect(base.content).toMatchObject([{ type: 'image', mimeType: 'image/png' }]);
    expect(base.structuredContent).toMatchObject({
      ok: true,
      data: { kind: 'file', revision: '0', bounds: rect, width: 64, height: 40 },
    });

    const scaled = await client.call(exportTool, {
      format: 'png',
      rect,
      scale: 1.5,
      atRevision: '0',
      includeImage: false,
    });
    expect(scaled.content).toEqual([]);
    expect(scaled.structuredContent).toMatchObject({
      ok: true,
      data: { kind: 'file', revision: '0', bounds: rect, width: 96, height: 60 },
    });
    const png = Buffer.from(client.files[1]!.bytes);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([96, 60]);

    const browser = await client.call(exportTool, {
      format: 'png',
      rect: { x: 104, y: 26, w: 30, h: 25 },
      scale: 2,
    });
    expect(browser.structuredContent).toMatchObject({
      ok: true,
      data: { kind: 'browserRenderRequired', width: 60, height: 50 },
    });
    expect(client.files).toHaveLength(2);
  } finally {
    await client.close();
  }
});

test('preserves static SVG and HTML alongside scaled PNG and rejects invalid crops', async () => {
  const client = await fixture(viewerId);
  const selection = { ids: [shapeId] };
  try {
    await client.call(exportTool, { ...selection, format: 'svg' });
    await client.call(exportTool, { ...selection, format: 'html' });
    await client.call(exportTool, { ...selection, format: 'png', scale: 0.5 });
    expect(client.files.map(({ filename }) => filename)).toEqual([
      'Architecture.svg',
      'Architecture.html',
      'Architecture.png',
    ]);
    const svg = new TextDecoder().decode(client.files[0]!.bytes);
    expect(svg).toContain('width="164" height="144"');
    expect(new TextDecoder().decode(client.files[1]!.bytes)).toContain('<!doctype html>');
    const png = Buffer.from(client.files[2]!.bytes);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([82, 72]);

    const rect = { x: 15, y: 20, w: 40, h: 30 };
    for (const request of [
      { format: 'png', rect, ...selection },
      { format: 'svg', rect },
      { format: 'html', scale: 0.5 },
    ]) {
      const invalid = await client.call(exportTool, request);
      expect(invalid.structuredContent).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' },
      });
    }
    const empty = await client.call(exportTool, {
      format: 'png',
      rect: { ...rect, x: -1000 },
    });
    expect(empty.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'EMPTY_CAPTURE' },
    });
    expect(client.files).toHaveLength(3);
  } finally {
    await client.close();
  }
});

test('downloads an actual whole-board ZIP when called by the board owner', async () => {
  const client = await fixture();
  try {
    const created = await client.call('artifact_manage', {
      action: 'create',
      commandId: 'create-for-model-backup',
      artifactId: undefined,
      title: '模型备份验收',
    });
    const frame = created.structuredContent as { data?: { artifact?: { id?: string } } };
    const artifactId = frame.data?.artifact?.id;
    expect(artifactId).toBeTypeOf('string');

    const archive = await client.call(exportTool, { format: 'zip', artifactId });
    expect(archive.structuredContent).toMatchObject({
      ok: true,
      data: {
        kind: 'file',
        filename: '模型备份验收.studio.zip',
        revision: '0',
        mimeType: 'application/zip',
      },
    });
    expect([...client.files[0]!.bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
  } finally {
    await client.close();
  }
});
