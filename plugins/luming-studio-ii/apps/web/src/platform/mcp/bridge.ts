import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  PostMessageTransport,
} from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { createMcpAssets } from './assets.js';
import { createViewPublisher, readMcpBoardView, type McpViewContext } from './context.js';
import { reportMcpWarning } from './diagnostics.js';
import { createMcpDownload } from './download.js';
import { createMcpNavigation } from './navigation.js';
import { decodeSession, isIdentifier, record, StudioMcpRequestError } from './protocol.js';
import type { HostExchange } from './protocol.js';
import { createMcpSessions } from './session.js';
import { createMcpTransport } from './transport.js';

type StudioTheme = 'light' | 'dark';
type StudioLayout = 'grid' | 'list';
type HostContext = ReturnType<App['getHostContext']>;

interface ReviewSourceReference {
  readonly boardId: string;
  readonly feedbackThreadId: string;
  readonly comment: string;
  readonly excerpt?: string;
  readonly sourceId: string;
  readonly capturedBoardRevision: bigint;
  readonly targetsBoardRevision: bigint;
  readonly targets: readonly {
    readonly objectId: string;
    readonly kind: string;
    readonly geometryVersion: bigint;
    readonly payloadVersion?: bigint;
  }[];
}

const appToolName = 'studio_app_request';
const handshakeTimeout = 15_000;

export function createMcpCommandId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createMcpPreferences() {
  let layout: StudioLayout = 'grid';
  let resolvedTheme: StudioTheme = 'light';
  const listeners = new Set<(theme: StudioTheme) => void>();

  function rememberTheme(theme: StudioTheme) {
    resolvedTheme = theme;
    applyDocumentTheme(theme);
    document.documentElement.dataset.theme = theme;
  }

  return {
    read() {
      return { layout, resolvedTheme };
    },
    rememberTheme,
    rememberLayout(next: StudioLayout) {
      layout = next;
    },
    subscribeTheme(listener: (theme: StudioTheme) => void) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    receive(context: HostContext) {
      if (context?.styles?.variables) {
        applyHostStyleVariables(context.styles.variables);
      }
      if (context?.theme) {
        rememberTheme(context.theme);
        for (const listener of listeners) {
          listener(context.theme);
        }
      }
    },
  };
}

function createContext(app: App, viewId: string) {
  const formats = app.getHostCapabilities()?.updateModelContext;
  if (formats?.structuredContent) {
    return createViewPublisher(viewId, (structuredContent) =>
      app.updateModelContext({ structuredContent }),
    );
  }
  if (formats?.text) {
    return createViewPublisher(viewId, (summary) =>
      app.updateModelContext({
        content: [
          { type: 'text', text: JSON.stringify(summary), annotations: { audience: ['assistant'] } },
        ],
      }),
    );
  }
}

function openingBoard(args: unknown) {
  const incoming = record(args);
  if (!incoming) {
    return { valid: false } as const;
  }

  const boardId = incoming.boardId;
  if (boardId === undefined || isIdentifier(boardId)) {
    return { valid: true, boardId } as const;
  }

  return { valid: false } as const;
}

function preferFullscreen(app: App) {
  const context = app.getHostContext();
  if (
    context?.displayMode !== 'fullscreen' &&
    context?.availableDisplayModes?.includes('fullscreen')
  ) {
    app.requestDisplayMode({ mode: 'fullscreen' }).catch((error: unknown) => {
      reportMcpWarning('无法切换鹿鸣面板的显示方式。', error);
    });
  }
}

function createReviewAttachment(
  app: App,
  extensions: OpenAIExtensions,
  navigation: ReturnType<typeof createMcpNavigation>,
  lifetime: AbortSignal,
) {
  const message = extensions.message;
  if (!message || !app.getHostCapabilities()?.message?.text) {
    return undefined;
  }

  return async (reference: ReviewSourceReference, attachSignal?: AbortSignal) => {
    const signal = attachSignal ? AbortSignal.any([lifetime, attachSignal]) : lifetime;
    signal.throwIfAborted();
    const { boardId, feedbackThreadId, sourceId, comment, excerpt } = reference;
    const location = navigation.read();
    const sameBoard = location.kind === 'whiteboard' && location.boardId === boardId;
    const validReference = [boardId, feedbackThreadId, sourceId].every(isIdentifier);
    if (!sameBoard || !validReference) {
      throw new Error('请从当前白板附加具体备注。');
    }

    const text = [
      '鹿鸣白板备注',
      JSON.stringify({
        boardId,
        feedbackThreadId,
        sourceId,
        comment,
        excerpt,
        capturedBoardRevision: reference.capturedBoardRevision.toString(),
        targetsBoardRevision: reference.targetsBoardRevision.toString(),
        targets: reference.targets.map(({ objectId, kind, geometryVersion, payloadVersion }) => ({
          objectId,
          kind,
          geometryVersion: geometryVersion.toString(),
          payloadVersion: payloadVersion?.toString(),
        })),
      }),
      '以用户在当前对话中发送的任务为准。',
    ].join('\n');
    const response = await message.send(
      {
        role: 'user',
        content: [{ type: 'text', text, _meta: { 'openai/title': '白板备注' } }],
        _meta: { 'openai/message': { target: 'active', send: false } },
      },
      { signal },
    );

    signal.throwIfAborted();
    if (response.isError) {
      throw new Error('宿主尚未确认已附加备注，请检查对话输入框后重试。');
    }
  };
}

export async function connectMcpApp(onClosed: () => void) {
  if (window.parent === window) {
    throw new Error('请从 Codex 对话面板打开鹿鸣。');
  }

  const app = new App({ name: 'Luming Studio II', version: '1.0.0' }, {}, { autoResize: false });
  const extensions = new OpenAIExtensions(app);
  const controller = new AbortController();
  const { signal } = controller;
  const readOpeningId = () => app.getHostContext()?.toolInfo?.id;
  const navigation = createMcpNavigation(readOpeningId);
  const preferences = createMcpPreferences();
  const call: HostExchange = (arguments_, signal) =>
    app.callServerTool({ name: appToolName, arguments: { ...arguments_ } }, { signal });
  const sessions = createMcpSessions({
    call,
    boardId() {
      const location = navigation.read();
      return location.kind === 'whiteboard' ? location.boardId : undefined;
    },
    lifetime: signal,
  });
  const transport = createMcpTransport({
    call,
    session: sessions.read,
    invalidateSession: sessions.invalidate,
    lifetime: signal,
  });
  const assets = createMcpAssets(transport.getAsset, signal);
  let publish: ReturnType<typeof createContext> = undefined;
  let closing: Promise<void> | undefined;
  let ready = false;

  async function release() {
    controller.abort(new Error('白板面板已关闭。'));
    publish?.close();
    assets.close();
    window.removeEventListener('pagehide', handlePageHide);
    await sessions.close();
    if (ready) {
      onClosed();
    }
  }

  function beginRelease() {
    closing ??= release();
    return closing;
  }

  async function close() {
    await beginRelease();
    await app.close();
  }

  function handlePageHide() {
    close().catch((error: unknown) => {
      reportMcpWarning('鹿鸣面板释放失败。', error);
    });
  }

  function route(boardId: string | undefined) {
    return navigation.applyHostLocation(boardId, readOpeningId());
  }

  app.addEventListener('toolinput', ({ arguments: args }) => {
    const opening = openingBoard(args);
    if (!signal.aborted && opening.valid) {
      route(opening.boardId);
    }
  });
  app.addEventListener('toolresult', (result) => {
    const value = record(result.structuredContent);
    const data = openingBoard(value?.data);
    const ignored = signal.aborted || result.isError === true || value?.ok !== true;
    if (ignored || !data.valid) {
      return;
    }

    route(data.boardId);
    const lease = decodeSession(result, data.boardId);
    if (lease) {
      sessions.accept(lease);
    }
  });
  app.addEventListener('hostcontextchanged', (context) => preferences.receive(context));
  app.onteardown = async () => {
    await beginRelease();

    return {};
  };
  window.addEventListener('pagehide', handlePageHide, { once: true });
  try {
    await app.connect(new PostMessageTransport(window.parent, window.parent), {
      timeout: handshakeTimeout,
      signal,
    });
    signal.throwIfAborted();
  } catch (error) {
    if (!signal.aborted) {
      await close();
    }
    throw error;
  }

  preferences.receive(app.getHostContext());
  preferFullscreen(app);
  const restoredView = readMcpBoardView(extensions.modelContext?.getCurrent());
  publish = createContext(app, restoredView?.viewId ?? createMcpCommandId());
  if (restoredView) {
    navigation.restore(restoredView);
  } else {
    publish?.update(null);
  }
  ready = true;

  return {
    navigation,
    preferences,
    assets,
    postProtobuf: transport.postProtobuf,
    postArchive: transport.postArchive,
    downloadFile: createMcpDownload(app, signal),
    attachReviewSource: createReviewAttachment(app, extensions, navigation, signal),
    handleBoardLoadFailure(boardId: string, error: unknown) {
      const unavailable =
        error instanceof StudioMcpRequestError && (error.status === 403 || error.status === 404);

      if (unavailable && navigation.discardRestoredView(boardId)) {
        publish?.update(null);
      }
    },
    updateViewContext: (context: McpViewContext | undefined) => {
      publish?.update(context ?? null);
    },
    close,
  };
}
