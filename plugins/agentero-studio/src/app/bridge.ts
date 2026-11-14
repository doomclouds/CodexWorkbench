import { App, PostMessageTransport, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import type { Actor, ArtifactView, Connection, Feedback, StudioClient, ToolName, ToolResponse, ViewContext } from '../contracts/studio';
import { createHostContextUpdater } from './host-context';
import { createRpcTransport } from './rpc-transport';
import { feedbackDraft } from './feedback-draft';
export { feedbackDraft } from './feedback-draft';
import { STUDIO_ICON } from '../contracts/brand-icon';
import { PLUGIN_VERSION } from '../contracts/version';

declare global { interface Window { __STUDIO_BOOT__?: Connection } }
export interface StudioBridge {
  client: StudioClient;
  actor: Actor;
  artifactId?: string;
  view?: string;
  attachContext?: (feedback: Feedback, document: ArtifactView) => Promise<void>;
  updateContext?: (context: ViewContext | null) => void;
  close(): Promise<void>;
}
function unwrap<T>(result: ToolResponse<T>): T {
  if (!result.ok) throw Object.assign(new Error(result.error?.message || '操作未完成'), { code: result.error?.code, details: result.error?.details });
  return result.data as T;
}
export async function createStudioBridge(onNavigate: (artifactId?: string, view?: string) => void): Promise<StudioBridge> {
  if (window.parent === window) {
    const boot = window.__STUDIO_BOOT__;
    if (!boot) throw new Error('请从 Codex 插件或有效的作品分享链接打开 Agentero 创作。');
    const client: StudioClient = {
      embedded: false, baseUrl: boot.baseUrl || location.origin, token: boot.token,
      async call<T>(name: ToolName, args: Record<string, unknown> = {}) {
        const response = await fetch(`${client.baseUrl}/api/tools/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
        return unwrap(await response.json() as ToolResponse<T>);
      },
    };
    return { client, actor: boot.actor, artifactId: boot.artifactId, view: boot.artifactId ? 'editor' : 'library', close: async () => {} };
  }
  const app = new App({ name: 'Agentero Studio', title: 'Agentero 创作', version: PLUGIN_VERSION, icons: [STUDIO_ICON] }, {}, { autoResize: false });
  const extensions = new OpenAIExtensions(app);
  let connection: Connection | undefined;
  let initialArtifactId: string | undefined;
  let initialView = 'library';
  let bridge: StudioBridge | undefined;
  let contextUpdater: ReturnType<typeof createHostContextUpdater> | undefined;
  let tornDown = false;
  let bridgeTransportClose: (() => void) | undefined;
  const navigate = (args: Record<string, unknown>) => {
    initialArtifactId = typeof args.artifactId === 'string' && args.artifactId ? args.artifactId : undefined;
    initialView = typeof args.view === 'string' && ['library', 'editor', 'board', 'trash'].includes(args.view) ? args.view : initialArtifactId ? 'editor' : 'library';
    if (bridge) { bridge.artifactId = initialArtifactId; bridge.view = initialView; }
    onNavigate(initialArtifactId, initialView);
  };
  app.onhostcontextchanged = context => {
    if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
    if (context.theme) { applyDocumentTheme(context.theme); document.documentElement.dataset.theme = context.theme; }
  };
  app.ontoolinput = ({ arguments: args }) => { if (args) navigate(args); };
  app.ontoolresult = result => {
    const payload = result.structuredContent as ToolResponse<{ artifactId?: string; view?: string }> | undefined;
    if (payload?.ok) {
      if (result._meta?.connection) connection = result._meta.connection as Connection;
      if (payload.data && (typeof payload.data.view === 'string' || typeof payload.data.artifactId === 'string')) navigate(payload.data);
    }
  };
  app.onteardown = async () => {
    tornDown = true;
    contextUpdater?.close();
    bridgeTransportClose?.();
    // Keep the transport open until the SDK sends the teardown acknowledgement.
    return {};
  };
  try {
    await app.connect(new PostMessageTransport(window.parent, window.parent), { timeout: 15_000 });
    if (!connection) {
      const opened = await app.callServerTool({ name: 'studio_open', arguments: { view: initialView, ...(initialArtifactId ? { artifactId: initialArtifactId } : {}) } });
      // Bootstrap supplies only the UI connection; its default route must not replace host input.
      connection ??= opened._meta?.connection as Connection | undefined;
    }
    if (!connection?.baseUrl || !connection.token) throw new Error('本机作品服务没有返回有效连接。');
  } catch (error) {
    if (!tornDown) await app.close().catch(() => {});
    throw error;
  }
  const context = app.getHostContext();
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.theme) { applyDocumentTheme(context.theme); document.documentElement.dataset.theme = context.theme; }
  const transport = createRpcTransport(connection.baseUrl, async (args, signal) => {
    const result = await app.callServerTool({ name: 'studio_app_request', arguments: args }, { timeout: 120_000, signal });
    const status = result.structuredContent as ToolResponse | undefined;
    if (result.isError || status?.ok === false) throw Object.assign(new Error(status?.error?.message || '作品服务请求失败。'), { code: status?.error?.code });
    if (!result._meta?.response) throw new Error('作品服务没有返回界面响应，请更新插件后重新打开。');
    return result._meta.response;
  });
  bridgeTransportClose = transport.close;
  const client: StudioClient = {
    request: transport.request, assetUrl: transport.assetUrl,
    embedded: true, baseUrl: connection.baseUrl, token: connection.token,
    async call<T>(name: ToolName, args: Record<string, unknown> = {}) {
      const result = await transport.request(`${client.baseUrl}/api/tools/${name}`, { method: 'POST', headers: { Authorization: `Bearer ${client.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
      return unwrap(await result.json() as ToolResponse<T>);
    },
  };
  bridge = {
    client, actor: connection.actor, artifactId: initialArtifactId, view: initialView,
    async close() {
      transport.close();
      contextUpdater?.close();
      if (!tornDown) { tornDown = true; await app.close(); }
    },
  };
  if (extensions.message && app.getHostCapabilities()?.message) bridge.attachContext = async (feedback, document) => {
    const response = await extensions.message!.send(feedbackDraft(feedback, document));
    if (response.isError) throw new Error('宿主没有确认附加备注，请检查对话输入框后重试。');
  };
  const formats = app.getHostCapabilities()?.updateModelContext;
  if (formats?.text || formats?.structuredContent) {
    contextUpdater = createHostContextUpdater(snapshot => app.updateModelContext(formats.structuredContent
      ? { structuredContent: { ...snapshot } }
      : { content: [{ type: 'text', text: JSON.stringify(snapshot) }] }));
    bridge.updateContext = contextUpdater.update;
  }
  return bridge;
}
