import { STUDIO_DISPLAY_NAME, STUDIO_HOME_TITLE } from '../../contracts/branding.js';
import {
  App,
  PostMessageTransport,
  applyDocumentTheme,
  applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type {
  Actor,
  ArtifactView,
  Connection,
  Feedback,
  StudioClient,
  ViewContext,
} from '../../contracts/studio';
import { createHostContextUpdater } from './host-context';
import { createRpcTransport } from './rpc-transport';
import { feedbackDraft } from './feedback-draft';

import { STUDIO_ICON } from '../../contracts/brand-icon';
import { PLUGIN_VERSION } from '../../contracts/version';
import { APP_TOOL_NAME, APP_MAX_BYTES } from '../../contracts/transport';
import { createWebNavigation } from './web-navigation';
import {
  assertHostToolSuccess,
  createStudioToolCall,
  decodeAppTransportResult,
  decodeOpeningRoute,
  decodeStudioConnection,
} from './tool-response';
import { browserStudioRequest } from './client';
import { reportStudioWarning } from '../shared/studio-warning';
import {
  loadPanelReadingView,
  restorePanelView,
  storePanelReadingView,
  type RestoredPanelView,
} from '../panel-view-state';

declare global {
  interface Window {
    __STUDIO_BOOT__?: Connection;
  }
}

export interface StudioBridge {
  client: StudioClient;
  actor: Actor;
  artifactId?: string;
  view?: string;
  restoredView?: RestoredPanelView;
  navigate?: (artifactId?: string, view?: string) => void;
  attachContext?: (feedback: Feedback, document: ArtifactView) => Promise<void>;
  updateContext?: (context: ViewContext | null) => void;
  close(): Promise<void>;
}

function createStandaloneBridge(
  onNavigate: (artifactId?: string, view?: string) => void,
): StudioBridge {
  const boot = decodeStudioConnection(window.__STUDIO_BOOT__, window.location.origin);
  if (!boot) {
    throw new Error(`请从 Codex 插件或有效的作品分享链接打开 ${STUDIO_DISPLAY_NAME}。`);
  }

  const client: StudioClient = {
    embedded: false,
    baseUrl: boot.baseUrl,
    token: boot.token,
    call: createStudioToolCall(async (name, args, read) => {
      const response = await browserStudioRequest(`${client.baseUrl}/api/tools/${name}`, {
        method: 'POST',
        headers: {
          ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      });

      return read(response);
    }),
  };
  const navigation = createWebNavigation(window, boot, (artifactId, view) => {
    standalone.artifactId = artifactId;
    standalone.view = view;
    onNavigate(artifactId, view);
  });
  const standalone: StudioBridge = {
    client,
    actor: boot.actor,
    artifactId: navigation.route.artifactId,
    view: navigation.route.view,
    navigate: navigation.navigate,
    close: async () => navigation.close(),
  };

  return standalone;
}

function hostRoute(args: Record<string, unknown>) {
  const artifactId =
    typeof args.artifactId === 'string' && args.artifactId ? args.artifactId : undefined;

  if (artifactId) {
    return { artifactId, view: args.view === 'board' ? 'board' : 'editor' };
  }

  return { artifactId, view: args.view === 'trash' ? 'trash' : 'library' };
}

function applyHostAppearance(context: ReturnType<App['getHostContext']>) {
  if (context?.styles?.variables) {
    applyHostStyleVariables(context.styles.variables);
  }
  if (context?.theme) {
    applyDocumentTheme(context.theme);
    document.documentElement.dataset.theme = context.theme;
  }
}

async function connectEmbeddedApp(
  app: App,
  currentConnection: () => Connection | undefined,
  signal: AbortSignal,
): Promise<Connection> {
  await app.connect(new PostMessageTransport(window.parent, window.parent), { timeout: 15_000 });
  signal.throwIfAborted();
  let connection = currentConnection();
  if (!connection) {
    const opened = await app.callServerTool(
      { name: APP_TOOL_NAME, arguments: { action: 'connect' } },
      { signal },
    );
    assertHostToolSuccess(opened.structuredContent, opened.isError, '本机作品服务连接失败。');

    connection = currentConnection() ?? decodeStudioConnection(opened._meta?.connection);
  }
  signal.throwIfAborted();
  if (!connection) {
    throw new Error('本机作品服务没有返回有效连接。');
  }

  return connection;
}

const uncertainSdkCalls = new Map<number, string>([
  [ErrorCode.ConnectionClosed, 'NETWORK_ERROR'],
  [ErrorCode.RequestTimeout, 'TIMEOUT'],
]);

function preserveAppRequestFailure(error: unknown): never {
  if (!(error instanceof McpError)) {
    throw error;
  }

  const code = uncertainSdkCalls.get(error.code);
  if (!code) {
    throw error;
  }

  throw Object.assign(new Error(error.message, { cause: error }), { code });
}

function connectEmbeddedTransport(app: App, connection: Connection) {
  const transport = createRpcTransport(connection.baseUrl, async (args, signal) => {
    const result = await app
      .callServerTool({ name: APP_TOOL_NAME, arguments: args }, { timeout: 120_000, signal })
      .catch(preserveAppRequestFailure);
    assertHostToolSuccess(result.structuredContent, result.isError, '作品服务请求失败。');

    return decodeAppTransportResult(args.action, result._meta?.response);
  });
  const client: StudioClient = {
    request: transport.request,
    assetUrl: transport.assetUrl,
    subscribeAssets: transport.subscribeAssets,
    assetState: transport.assetState,
    embedded: true,
    baseUrl: connection.baseUrl,
    token: connection.token,
    async downloadFile(blob, filename) {
      if (!app.getHostCapabilities()?.downloadFile) {
        throw new Error('当前宿主不支持文件下载，请更新宿主或在浏览器中导出。');
      }
      if (blob.size > APP_MAX_BYTES) {
        throw new Error('导出文件超过作品传输的 128 MB 预算，请缩小导出范围。');
      }

      const invalidLength = !filename || filename.length > 255;
      const dotSegment = filename === '.' || filename === '..';
      if (invalidLength || dotSegment || /[\\/\u0000-\u001f\u007f]/.test(filename)) {
        throw new Error('导出文件名无效。');
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      }
      const result = await app.downloadFile({
        contents: [
          {
            type: 'resource',
            resource: {
              uri: `file:///${encodeURIComponent(filename)}`,
              mimeType: blob.type || 'application/octet-stream',
              blob: btoa(binary),
            },
          },
        ],
      });

      if (result.isError) {
        throw new Error('宿主未完成文件下载，可能已取消或被拒绝；请重试。');
      }
    },
    call: createStudioToolCall(async (name, args, read) => {
      const result = await transport.request(`${client.baseUrl}/api/tools/${name}`, {
        method: 'POST',
        headers: {
          ...(client.token ? { Authorization: `Bearer ${client.token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
      });

      return read(result);
    }),
  };

  return { client, close: transport.close };
}

function connectContextPublisher(app: App, restoredView?: RestoredPanelView) {
  const formats = app.getHostCapabilities()?.updateModelContext;
  if (!formats?.text && !formats?.structuredContent) {
    return;
  }

  let priorViewId = restoredView?.viewId;
  const updater = createHostContextUpdater(async (snapshot) => {
    await app.updateModelContext(
      formats.structuredContent
        ? { structuredContent: { ...snapshot } }
        : { content: [{ type: 'text', text: JSON.stringify(snapshot) }] },
    );

    if (!priorViewId || !snapshot.viewId || snapshot.viewId === priorViewId) {
      return;
    }
    if (snapshot.artifactId !== restoredView?.artifactId) {
      return;
    }

    if (loadPanelReadingView(snapshot.viewId, snapshot.artifactId)) {
      storePanelReadingView(priorViewId, null);
      priorViewId = undefined;
    }
  });

  if (!restoredView) {
    updater.update(null);
  }
  return updater;
}

export async function createStudioBridge(
  onNavigate: (artifactId?: string, view?: string) => void,
): Promise<StudioBridge> {
  if (window.parent === window) {
    return createStandaloneBridge(onNavigate);
  }

  const app = new App(
    {
      name: STUDIO_HOME_TITLE,
      title: STUDIO_DISPLAY_NAME,
      version: PLUGIN_VERSION,
      icons: [STUDIO_ICON],
    },
    {},
    { autoResize: false },
  );
  const extensions = new OpenAIExtensions(app);
  let openingConnection: Connection | undefined;
  let initialArtifactId: string | undefined;
  let initialView = 'library';
  let hostOpeningRoute: { artifactId?: string; view: string } | undefined;
  let hostCallId: string | number | undefined;
  let localRoute = false;
  const session: {
    bridge?: StudioBridge;
    closeTransport?: () => void;
    contextUpdater?: ReturnType<typeof createHostContextUpdater>;
  } = {};
  let tornDown = false;
  const bootstrapAbort = new AbortController();
  const selectRoute = (artifactId: string | undefined, view: string) => {
    if (initialArtifactId === artifactId && initialView === view) {
      return;
    }

    initialArtifactId = artifactId;
    initialView = view;
    if (session.bridge) {
      session.bridge.artifactId = artifactId;
      session.bridge.view = view;
    }
    onNavigate(artifactId, view);
  };
  const navigate = (args: Record<string, unknown>, fromInput = false) => {
    if (tornDown) {
      return;
    }

    const { artifactId, view } = hostRoute(args);
    const nextCallId = app.getHostContext()?.toolInfo?.id;
    const newCall =
      nextCallId !== undefined && hostCallId !== undefined && nextCallId !== hostCallId;
    const replay =
      !hostOpeningRoute ||
      (hostOpeningRoute.artifactId === artifactId && hostOpeningRoute.view === view);
    const explicitLibrary = fromInput && args.view === 'library' && newCall;
    const keepLocal = view === 'library' ? !explicitLibrary : !newCall && replay;
    if (localRoute && keepLocal) {
      hostOpeningRoute ??= { artifactId, view };
      return;
    }

    if (nextCallId !== undefined) {
      hostCallId = nextCallId;
    }
    hostOpeningRoute = { artifactId, view };
    if (newCall) {
      localRoute = false;
    }
    selectRoute(artifactId, view);
  };
  app.addEventListener('hostcontextchanged', applyHostAppearance);
  app.addEventListener('toolinput', ({ arguments: args }) => {
    if (args) {
      navigate(args, true);
    }
  });
  app.addEventListener('toolresult', (result) => {
    const payload = decodeOpeningRoute(result.structuredContent);
    if (result.isError || !payload) {
      return;
    }

    openingConnection = decodeStudioConnection(result._meta?.connection) ?? openingConnection;
    const data = payload.data;
    if (data && (typeof data.view === 'string' || typeof data.artifactId === 'string')) {
      navigate(data);
    }
  });
  app.onteardown = async () => {
    tornDown = true;
    bootstrapAbort.abort(new Error('作品页面已关闭。'));
    session.contextUpdater?.close();
    session.closeTransport?.();

    return {};
  };
  const connection = await connectEmbeddedApp(
    app,
    () => openingConnection,
    bootstrapAbort.signal,
  ).catch(async (error) => {
    if (!tornDown) {
      await app.close().catch((cleanupError) => {
        reportStudioWarning('Studio connection cleanup failed.', cleanupError);
      });
    }
    throw error;
  });
  bootstrapAbort.signal.throwIfAborted();
  const context = app.getHostContext();
  hostCallId ??= context?.toolInfo?.id;
  const restoredView = restorePanelView(extensions.modelContext?.getCurrent());
  if (restoredView) {
    localRoute = true;
    initialArtifactId = restoredView.artifactId;
    initialView = 'editor';
  }
  applyHostAppearance(context);
  const transport = connectEmbeddedTransport(app, connection);
  session.closeTransport = transport.close;
  const bridge: StudioBridge = {
    client: transport.client,
    actor: connection.actor,
    artifactId: initialArtifactId,
    view: initialView,
    restoredView,
    navigate(artifactId, view) {
      localRoute = true;

      initialArtifactId = artifactId;
      initialView = view ?? (artifactId ? 'editor' : 'library');
      bridge.artifactId = initialArtifactId;
      bridge.view = initialView;
    },
    async close() {
      transport.close();
      session.contextUpdater?.close();
      if (!tornDown) {
        tornDown = true;
        await app.close();
      }
    },
  };
  session.bridge = bridge;
  if (extensions.message && app.getHostCapabilities()?.message) {
    bridge.attachContext = async (feedback, document) => {
      const response = await extensions.message!.send(feedbackDraft(feedback, document));
      if (response.isError) {
        throw new Error('宿主没有确认附加备注，请检查对话输入框后重试。');
      }
    };
  }
  session.contextUpdater = connectContextPublisher(app, restoredView);
  if (session.contextUpdater) {
    bridge.updateContext = session.contextUpdater.update;
  }
  return bridge;
}
