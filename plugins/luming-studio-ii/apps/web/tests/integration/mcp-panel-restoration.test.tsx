import { act, type ComponentProps } from 'react';
import { expect, test } from 'vitest';
import { StudioApp } from '../../src/app/index.js';
import type { WhiteboardObject, WhiteboardService } from '../../src/data/whiteboard/index.js';
import { connectMcpApp, type McpViewContext } from '../../src/platform/mcp/index.js';
import { createControlFixture } from '../support/render-control.js';

type Message = Readonly<Record<string, unknown>>;
type Bridge = Awaited<ReturnType<typeof connectMcpApp>>;

const boardId = 'restored-board';
const cardId = 'restored-card';
const camera = { x: 42, y: 66, zoom: 1.35 };
const returnCamera = { x: 11, y: -13, zoom: 0.75 };
const boardScenePath = '/luming.studio.v1.WhiteboardService/GetBoardScene';

const shape: WhiteboardObject = {
  id: cardId,
  kind: 'shape',
  label: '已选对象',
  geometry: { x: 40, y: 40, width: 160, height: 100, rotation: 0 },
  geometryVersion: 0n,
  locked: false,
  detail: { kind: 'shape', outline: 'rectangle' },
};

const service: WhiteboardService = {
  getScene: async (id) => ({
    boardId: id,
    revision: 0n,
    title: '恢复的白板',
    objects: [shape],
    canEdit: true,
  }),
  getPayloads: async () => [],
  moveObjects: async () => {
    throw new Error('Unexpected whiteboard mutation');
  },
  getReceipt: async () => undefined,
};

const catalog: ComponentProps<typeof StudioApp>['catalog'] = {
  listBoards: async () => ({ boards: [] }),
  createBoard: async () => {
    throw new Error('Unexpected board creation');
  },
  getReceipt: async () => undefined,
};

const savedView = {
  appId: 'luming-studio-ii',
  panelOpen: true,
  viewId: 'original-view',
  boardId,
  selectedIds: [cardId, 'missing-card', cardId],
  viewport: camera,
  focusedObjectId: cardId,
  returnViewport: returnCamera,
};

const capabilities = {
  updateModelContext: { structuredContent: {} },
  experimental: { 'openai/modelContext': {} },
};

function toolContext(id: string) {
  return { id, tool: { name: 'studio_open', inputSchema: { type: 'object' } } };
}

interface HostOptions {
  readonly modelContext?: Message;
  readonly hostCapabilities?: Message;
  readonly responseStatus?: number;
  readonly downloadError?: boolean;
  readonly messageError?: boolean;
}

function withHost({
  modelContext = { updateId: 'prior-state', structuredContent: savedView },
  hostCapabilities = capabilities,
  responseStatus = 200,
  downloadError = false,
  messageError = false,
}: HostOptions = {}) {
  const recorder: Message[] = [];
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const host = iframe.contentWindow;
  if (!host) {
    throw new Error('Expected a host window');
  }

  function dispatch(message: Message) {
    window.dispatchEvent(
      new MessageEvent('message', { data: { jsonrpc: '2.0', ...message }, source: host }),
    );
  }

  function respond(request: Message, result: Message) {
    dispatch({ id: request.id, result });
  }

  host.postMessage = (request: Message) => {
    if (request.method === 'ui/initialize') {
      respond(request, {
        protocolVersion: '2026-01-26',
        hostInfo: { name: 'Fixture', version: '1' },
        hostCapabilities,
        hostContext: {
          toolInfo: toolContext('original-call'),
          'openai/modelContext': modelContext,
        },
      });

      return;
    }
    if (request.method === 'ui/update-model-context') {
      recorder.push(request);
      respond(request, {});

      return;
    }
    if (request.method === 'ui/download-file') {
      recorder.push(request);
      respond(request, { isError: downloadError });

      return;
    }
    if (request.method === 'ui/message') {
      recorder.push(request);
      respond(request, { isError: messageError });

      return;
    }
    if (request.method === 'tools/call') {
      const params = request.params as { arguments: Message };
      respond(request, {
        structuredContent: { ok: true },
        _meta: callMetadata(params.arguments.action, responseStatus),
      });
    }
  };
  const parent = window.parent;
  window.parent = host;

  return {
    recorder,
    notify: (method: string, params: Message) => dispatch({ method, params }),
    dispose() {
      window.parent = parent;
      iframe.remove();
    },
  };
}

function callMetadata(action: unknown, status: number) {
  if (action === 'connect') {
    return { session: { id: 'fixture-session', expiresAtMillis: Number.MAX_SAFE_INTEGER } };
  }
  if (action === 'request') {
    return { response: { status, size: 0, contentType: 'application/protobuf' } };
  }

  return {};
}

async function withBridge(
  verify: (bridge: Bridge, host: ReturnType<typeof withHost>) => Promise<void>,
  options?: HostOptions,
) {
  const host = withHost(options);
  let bridge: Bridge | undefined;
  try {
    bridge = await connectMcpApp(() => undefined);
    await verify(bridge, host);
  } finally {
    await bridge?.close();
    host.dispose();
  }
}

const downloadFile = {
  filename: '发布白板.svg',
  mimeType: 'image/svg+xml',
  content: new TextEncoder().encode('<svg/>'),
};

const feedbackReference = {
  boardId,
  feedbackThreadId: 'notation-1',
  sourceId: 'source-1',
  comment: '把节点移到标题下方',
  excerpt: '节点原文',
  capturedBoardRevision: 2n,
  targetsBoardRevision: 5n,
  targets: [{ objectId: cardId, kind: 'shape', geometryVersion: 3n, payloadVersion: 4n }],
};

const draftCapabilities = {
  ...capabilities,
  message: { text: {} },
  experimental: { ...capabilities.experimental, 'openai/message': {} },
};

test('attaches only the chosen note as an unsent draft in the active Codex conversation', async () => {
  await withBridge(
    async (bridge, host) => {
      const attach = bridge.attachReviewSource;
      if (!attach) {
        throw new Error('The Studio panel did not detect the draft capability.');
      }

      expect(host.recorder).toHaveLength(0);
      await attach(feedbackReference);

      const context = {
        ...feedbackReference,
        capturedBoardRevision: '2',
        targetsBoardRevision: '5',
        targets: [{ objectId: cardId, kind: 'shape', geometryVersion: '3', payloadVersion: '4' }],
      };
      expect(host.recorder).toMatchObject([
        {
          method: 'ui/message',
          params: {
            role: 'user',
            _meta: { 'openai/message': { target: 'active', send: false } },
            content: [
              {
                type: 'text',
                text: [
                  '鹿鸣白板备注',
                  JSON.stringify(context),
                  '以用户在当前对话中发送的任务为准。',
                ].join('\n'),
                _meta: { 'openai/title': '白板备注' },
              },
            ],
          },
        },
      ]);
    },
    { hostCapabilities: draftCapabilities },
  );
});

test('requires the draft capability and rejects a stale board, aborted action or failed host acknowledgement', async () => {
  await withBridge(async (bridge, host) => {
    expect(bridge.attachReviewSource).toBeUndefined();
    expect(host.recorder).toHaveLength(0);
  });

  await withBridge(
    async (bridge, host) => {
      const attach = bridge.attachReviewSource;
      if (!attach) {
        throw new Error('The Studio panel did not detect the draft capability.');
      }

      await expect(attach({ ...feedbackReference, boardId: 'another-board' })).rejects.toThrow(
        '请从当前白板附加具体备注',
      );
      await expect(
        attach(feedbackReference, AbortSignal.abort(new Error('备注窗口已关闭'))),
      ).rejects.toThrow('备注窗口已关闭');
      expect(host.recorder).toHaveLength(0);
      await expect(attach(feedbackReference)).rejects.toThrow('宿主尚未确认已附加备注');
      expect(host.recorder[0]?.method).toBe('ui/message');
    },
    { hostCapabilities: draftCapabilities, messageError: true },
  );
});

test('hands board bytes to the declared host download capability and reports acceptance', async () => {
  await withBridge(
    async (bridge, host) => {
      const mark = await bridge.downloadFile(downloadFile);

      expect(host.recorder.at(-1)).toMatchObject({
        method: 'ui/download-file',
        params: {
          contents: [
            {
              type: 'resource',
              resource: {
                uri: 'file:///' + encodeURIComponent(downloadFile.filename),
                mimeType: downloadFile.mimeType,
                blob: 'PHN2Zy8+',
              },
            },
          ],
        },
      });
      expect(mark).toEqual({
        kind: 'requested',
        message: '宿主已接受下载「发布白板.svg」。请留意宿主的下载提示。',
      });
    },
    { hostCapabilities: { ...capabilities, downloadFile: {} } },
  );
});

test('reports unavailable host downloads and propagates a cancelled or rejected request', async () => {
  await withBridge(async (bridge, host) => {
    await expect(bridge.downloadFile(downloadFile)).resolves.toMatchObject({ kind: 'unavailable' });
    expect(host.recorder).toHaveLength(0);
  });

  await withBridge(
    async (bridge) => {
      await expect(bridge.downloadFile(downloadFile)).rejects.toThrow('宿主未完成下载');
    },
    { hostCapabilities: { ...capabilities, downloadFile: {} }, downloadError: true },
  );
});

test('restores a permitted board, current selection, camera and object focus after reattachment', async () => {
  await withBridge(async (bridge, host) => {
    expect(bridge.navigation.read()).toEqual({ kind: 'whiteboard', boardId });
    host.notify('ui/notifications/tool-input', { arguments: { boardId: 'originally-opened' } });
    expect(bridge.navigation.read()).toEqual({ kind: 'whiteboard', boardId });
    expect(host.recorder).toHaveLength(0);

    const fixture = createControlFixture();
    const views: McpViewContext[] = [];
    const handleViewContext: NonNullable<ComponentProps<typeof StudioApp>['onViewContext']> = (
      view,
    ) => {
      bridge.updateViewContext(view);
      if (view) {
        views.push(view);
      }
    };

    try {
      await act(async () =>
        fixture.render(
          <StudioApp
            catalog={catalog}
            service={service}
            navigation={bridge.navigation}
            preferences={{ ...bridge.preferences.read(), ...bridge.preferences }}
            createCommandId={() => 'command'}
            onViewContext={handleViewContext}
          />,
        ),
      );
      expect(fixture.host.querySelector('[data-canvas-root]')?.getAttribute('aria-label')).toBe(
        '恢复的白板',
      );
      expect(views.at(-1)).toMatchObject({
        boardId,
        selectedIds: [cardId],
        viewport: camera,
        focusedObjectId: cardId,
        returnViewport: returnCamera,
      });
      await expect.poll(() => host.recorder.length).toBe(1);
      expect(host.recorder[0]?.params).toMatchObject({
        structuredContent: {
          boardId,
          viewId: savedView.viewId,
          selectedIds: [cardId],
          viewport: camera,
          focusedObjectId: cardId,
          returnViewport: returnCamera,
        },
      });

      const exit = fixture.host.querySelector<HTMLButtonElement>('[aria-label="退出全屏观看"]');
      expect(exit).not.toBeNull();
      await act(async () => exit?.click());
      await expect
        .poll(() => views.at(-1))
        .toMatchObject({
          boardId,
          selectedIds: [cardId],
          viewport: returnCamera,
          focusedObjectId: undefined,
        });

      host.notify('ui/notifications/host-context-changed', {
        toolInfo: toolContext('second-call'),
      });
      await act(async () =>
        host.notify('ui/notifications/tool-input', { arguments: { boardId: 'new-board' } }),
      );
      expect(bridge.navigation.read()).toEqual({ kind: 'whiteboard', boardId: 'new-board' });
      expect(bridge.navigation.readBoardView()).toBeUndefined();
    } finally {
      fixture.dispose();
    }
  });
});

test.each([403, 404, 503])(
  'returns to workbench only when the restored board is inaccessible (%i)',
  async (status) => {
    await withBridge(
      async (bridge, host) => {
        const load = async () => {
          try {
            await bridge.postProtobuf(boardScenePath, new Uint8Array());
          } catch (error) {
            bridge.handleBoardLoadFailure(boardId, error);
            throw error;
          }
        };

        await expect(load()).rejects.toThrow('HTTP ' + status);
        const unavailable = status !== 503;
        expect(bridge.navigation.read()).toEqual(
          unavailable ? { kind: 'workbench' } : { kind: 'whiteboard', boardId },
        );

        if (unavailable) {
          await expect
            .poll(() => host.recorder[0]?.params)
            .toMatchObject({
              structuredContent: { appId: 'luming-studio-ii', boardId: null },
            });
        }
      },
      { responseStatus: status },
    );
  },
);

test('uses text fallback, bounds the retained view, and drops unsafe fields', async () => {
  const stored = {
    ...savedView,
    viewport: { x: 1e12, y: 0, zoom: 1 },
    returnViewport: returnCamera,
    focusedObjectId: 'javascript:invalid',
    selectedIds: Array.from({ length: 45 }, (_, index) => 'id-' + index),
    document: 'Private example body',
  };
  await withBridge(
    async (bridge) => {
      expect(bridge.navigation.readBoardView()).toEqual({
        boardId,
        viewId: 'original-view',
        selectedIds: stored.selectedIds.slice(0, 40),
        viewport: undefined,
        focusedObjectId: undefined,
        returnViewport: undefined,
      });
    },
    {
      modelContext: {
        updateId: 'prior-state',
        content: [{ type: 'text', text: JSON.stringify(stored) }],
      },
      hostCapabilities: { ...capabilities, updateModelContext: { text: {} } },
    },
  );
});

test('starts at workbench if the host does not advertise model context readback', async () => {
  await withBridge(
    async (bridge) => {
      expect(bridge.navigation.read()).toEqual({ kind: 'workbench' });
      expect(bridge.navigation.readBoardView()).toBeUndefined();
    },
    { hostCapabilities: { updateModelContext: { structuredContent: {} } } },
  );
});
