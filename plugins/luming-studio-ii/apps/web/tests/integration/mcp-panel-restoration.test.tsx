import { act, type ComponentProps } from 'react';
import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  BoardCatalogService,
  type WorkbenchPreferences,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { expect, test } from 'vitest';
import { StudioApp } from '../../src/app/index.js';
import { createWorkbenchPreferencesService } from '../../src/data/catalog/index.js';
import type { WhiteboardObject, WhiteboardService } from '../../src/data/whiteboard/index.js';
import { connectMcpApp, type McpViewContext } from '../../src/platform/mcp/index.js';
import { WhiteboardExportSurface } from '../../src/surfaces/whiteboard-export/index.js';
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
  readonly availableDisplayModes?: readonly string[];
  readonly responseStatus?: number;
  readonly downloadError?: boolean | (() => boolean);
  readonly messageError?: boolean;
  readonly postWorkbenchPreferences?: (input: Message) => Uint8Array | undefined;
}

function withHost({
  modelContext = { updateId: 'prior-state', structuredContent: savedView },
  hostCapabilities = capabilities,
  availableDisplayModes,
  responseStatus = 200,
  downloadError = false,
  messageError = false,
  postWorkbenchPreferences,
}: HostOptions = {}) {
  const recorder: Message[] = [];
  const tools: Message[] = [];
  let initialize: Message | undefined;
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
      initialize = request;
      respond(request, {
        protocolVersion: '2026-01-26',
        hostInfo: { name: 'Fixture', version: '1' },
        hostCapabilities,
        hostContext: {
          toolInfo: toolContext('original-call'),
          'openai/modelContext': modelContext,
          ...(availableDisplayModes ? { displayMode: 'inline', availableDisplayModes } : {}),
        },
      });

      return;
    }
    if (request.method === 'ui/request-display-mode') {
      recorder.push(request);
      respond(request, { mode: 'fullscreen' });

      return;
    }
    if (request.method === 'ui/update-model-context') {
      recorder.push(request);
      respond(request, {});

      return;
    }
    if (request.method === 'ui/download-file') {
      recorder.push(request);
      const isError = typeof downloadError === 'function' ? downloadError() : downloadError;
      respond(request, { isError });

      return;
    }
    if (request.method === 'ui/message') {
      recorder.push(request);
      respond(request, { isError: messageError });

      return;
    }
    if (request.method === 'tools/call') {
      const params = request.params as { arguments: Message };
      tools.push(params.arguments);
      const payload = postWorkbenchPreferences?.(params.arguments);
      respond(request, {
        structuredContent: { ok: true },
        _meta: callMetadata(params.arguments.action, responseStatus, payload),
      });
    }
  };
  const parent = window.parent;
  window.parent = host;

  return {
    recorder,
    tools,
    readInitialize: () => initialize,
    notify: (method: string, params: Message) => dispatch({ method, params }),
    dispose() {
      window.parent = parent;
      iframe.remove();
    },
  };
}

function callMetadata(action: unknown, status: number, payload?: Uint8Array) {
  if (action === 'connect') {
    return { session: { id: 'fixture-session', expiresAtMillis: Number.MAX_SAFE_INTEGER } };
  }
  if (action === 'request') {
    return {
      response: {
        status,
        size: payload?.length ?? 0,
        contentType: 'application/protobuf',
        ...(payload ? { body: btoa(String.fromCharCode(...payload)) } : {}),
      },
    };
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

function workbenchPreferencesFixture() {
  const { getWorkbenchPreferences: read, updateWorkbenchPreferences: update } =
    BoardCatalogService.method;
  let saved: Partial<WorkbenchPreferences> = {};

  return {
    modelContext: {},
    postWorkbenchPreferences(input: Message) {
      switch (input.method) {
        case read.name:
          return toBinary(read.output, create(read.output, { preferences: saved }));
        case update.name: {
          const bytes = Uint8Array.from(atob(String(input.body)), (value) => value.charCodeAt(0));
          const { changes } = fromBinary(update.input, bytes);
          saved = { ...saved, ...changes };
          return toBinary(update.output, create(update.output));
        }
      }
    },
    read: () => saved,
  };
}

async function renderWorkbench(bridge: Bridge, fixture: ReturnType<typeof createControlFixture>) {
  const { preferences } = bridge;
  await preferences.initialize(createWorkbenchPreferencesService(bridge.postProtobuf));
  await act(async () =>
    fixture.render(
      <StudioApp
        catalog={catalog}
        service={service}
        navigation={bridge.navigation}
        preferences={{ ...preferences.read(), ...preferences }}
        createCommandId={() => 'command'}
      />,
    ),
  );
}

function workbenchButton(fixture: ReturnType<typeof createControlFixture>, label: string) {
  const button = fixture.host.querySelector<HTMLButtonElement>(
    'button[aria-label="' + label + '"]',
  );

  if (!button) {
    throw new Error('Expected workbench control: ' + label);
  }

  return button;
}

test('restores the chosen workbench layout, theme and fixed scope in a new MCP panel', async () => {
  const savedPreferences = workbenchPreferencesFixture();
  await withBridge(async (bridge) => {
    const fixture = createControlFixture();
    try {
      await renderWorkbench(bridge, fixture);
      await act(async () => workbenchButton(fixture, '切换为列表视图').click());
      await act(async () => workbenchButton(fixture, '切换为暗色主题').click());
      await act(async () => workbenchButton(fixture, '筛选作品').click());
      const pinned = Array.from(
        fixture.host.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]'),
      ).find((button) => button.textContent === '已固定');
      expect(pinned).toBeDefined();
      await act(async () => pinned?.click());
    } finally {
      fixture.dispose();
    }
  }, savedPreferences);
  expect(savedPreferences.read()).toMatchObject({
    layout: 'list',
    theme: 'dark',
    pinnedOnly: true,
  });

  await withBridge(async (bridge, host) => {
    const fixture = createControlFixture();
    try {
      await renderWorkbench(bridge, fixture);
      expect(workbenchButton(fixture, '切换为卡片视图')).toBeTruthy();
      expect(workbenchButton(fixture, '切换为明亮主题')).toBeTruthy();
      expect(fixture.host.querySelector('h1')?.textContent).toBe('已固定');
      await act(async () =>
        host.notify('ui/notifications/host-context-changed', { theme: 'light' }),
      );
      expect(workbenchButton(fixture, '切换为明亮主题')).toBeTruthy();
      expect(fixture.host.querySelector('[aria-label="搜索作品名称"]')).toBeNull();
    } finally {
      fixture.dispose();
    }
  }, savedPreferences);
});

test('retains the MCP transport across a browser page-cache round trip', async () => {
  await withBridge(async (bridge, host) => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await expect(bridge.postProtobuf(boardScenePath, new Uint8Array())).resolves.toEqual(
      new Uint8Array(),
    );
    expect(host.tools.some(({ action }) => action === 'close')).toBe(false);
  });
});

test('advertises its bundled icon and opens fullscreen when the conversation host offers it', async () => {
  const icon = document.createElement('link');
  icon.rel = 'icon';
  icon.href = 'data:image/png;base64,iVBORw0KGgo=';
  document.head.append(icon);

  try {
    await withBridge(
      async (_bridge, host) => {
        expect(host.readInitialize()).toMatchObject({
          method: 'ui/initialize',
          params: {
            appInfo: {
              name: 'Luming Studio II',
              title: '鹿鸣 · Luming Studio II',
              icons: [{ src: icon.href, mimeType: 'image/png', sizes: ['64x64'] }],
            },
          },
        });
        await expect
          .poll(() => host.recorder)
          .toMatchObject([{ method: 'ui/request-display-mode', params: { mode: 'fullscreen' } }]);
      },
      { availableDisplayModes: ['inline', 'fullscreen'] },
    );
  } finally {
    icon.remove();
  }
});

const downloadFile = {
  filename: '发布白板.svg',
  mimeType: 'image/svg+xml' as const,
  content: new TextEncoder().encode('<svg/>'),
};

const feedbackReference = {
  boardId,
  feedbackThreadId: 'notation-1',
  sourceId: 'source-1',
  comment: '把节点移到标题下方',
  excerpt: '节点原文',
  targetLabel: '图形 A',
  selectedTargets: [{ objectId: cardId, kind: 'shape', label: '图形 A' }],
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
        boardId,
        feedbackThreadId: feedbackReference.feedbackThreadId,
        sourceId: feedbackReference.sourceId,
        sourceRef: {
          kind: 'feedback',
          boardId,
          feedbackThreadId: feedbackReference.feedbackThreadId,
        },
        read: { boardId, mode: 'context', feedbackId: feedbackReference.feedbackThreadId },
        comment: feedbackReference.comment,
        excerpt: feedbackReference.excerpt,
        targetLabel: feedbackReference.targetLabel,
        selectedTargets: feedbackReference.selectedTargets,
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
                _meta: { 'openai/title': '白板备注 · 图形 A' },
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
    expect(bridge.downloadFile.confirmation).toBeUndefined();
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

test('uses only the host confirmation and retries the same prepared bytes after cancellation', async () => {
  let cancelled = true;
  await withBridge(
    async (bridge, host) => {
      expect(bridge.downloadFile.confirmation).toBe('host');
      const fixture = createControlFixture();
      let preparations = 0;
      try {
        fixture.render(
          <WhiteboardExportSurface
            anchor={null}
            inline
            context={{ boardId, title: '发布白板', revision: 0n, selectedIds: [] }}
            exportBoard={async () => {
              preparations += 1;
              return { kind: 'file', file: { ...downloadFile, revision: 0n } };
            }}
            download={bridge.downloadFile}
            onRequestClose={() => undefined}
          />,
        );
        const svg = fixture.host.querySelector<HTMLButtonElement>('button[aria-label="SVG 图片"]');
        if (!svg) {
          throw new Error('Expected the SVG export action.');
        }

        await act(async () => {
          svg.click();
          svg.click();
        });
        expect(fixture.host.querySelector('dialog')).toBeNull();
        expect(preparations).toBe(1);
        expect(host.recorder).toHaveLength(1);
        expect(host.recorder[0]?.method).toBe('ui/download-file');
        expect(fixture.host.textContent).toContain('宿主未完成下载');
        expect(fixture.host.textContent).not.toContain('已发起下载');

        const retry = [...fixture.host.querySelectorAll('button')].find(
          (button) => button.textContent === '重试下载',
        );

        if (!retry) {
          throw new Error('The export did not offer a download retry.');
        }

        cancelled = false;
        await act(async () => {
          retry.click();
          retry.click();
        });
        expect(preparations).toBe(1);
        expect(host.recorder).toHaveLength(2);
        expect(host.recorder[1]?.params).toEqual(host.recorder[0]?.params);
        expect(fixture.host.querySelector('dialog')).toBeNull();
        expect(fixture.host.textContent).not.toContain('宿主未完成下载');
      } finally {
        fixture.dispose();
      }
    },
    { hostCapabilities: { ...capabilities, downloadFile: {} }, downloadError: () => cancelled },
  );
});

test('does not request a host confirmation for an empty download', async () => {
  await withBridge(
    async (bridge, host) => {
      await expect(
        bridge.downloadFile({ ...downloadFile, content: new Uint8Array() }),
      ).rejects.toThrow('导出文件为空');
      expect(host.recorder).toHaveLength(0);
    },
    { hostCapabilities: { ...capabilities, downloadFile: {} } },
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
          viewId: expect.stringMatching(/^[a-f0-9]{32}$/u),
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

test('publishes the current canvas through its panel lease and clears it on returning to workbench', async () => {
  await withBridge(async (bridge, host) => {
    const original = { boardId, selectedIds: [cardId], viewport: camera, focusedObjectId: cardId };
    bridge.updateViewContext(original);
    await expect
      .poll(() => host.tools.find(({ action }) => action === 'view'))
      .toMatchObject({
        action: 'view',
        sessionId: 'fixture-session',
        viewId: expect.stringMatching(/^[a-f0-9]{32}$/u),
        sequence: 1,
        state: { ...original, selectedCount: 1 },
      });
    const sent = host.tools.find(({ action }) => action === 'view');
    expect(sent?.viewId).not.toBe(savedView.viewId);
    expect(host.recorder[0]?.params).toMatchObject({
      structuredContent: { boardId, viewId: sent?.viewId },
    });

    bridge.navigation.write({ kind: 'workbench' });
    bridge.updateViewContext(undefined);
    await expect
      .poll(() => host.tools.at(-1))
      .toMatchObject({
        action: 'view',
        sessionId: 'fixture-session',
        viewId: sent?.viewId,
        sequence: 2,
      });
    expect(host.tools.at(-1)?.state).toBeUndefined();
    await bridge.close();
    expect(host.tools.at(-1)).toMatchObject({ action: 'close', sessionId: 'fixture-session' });
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
