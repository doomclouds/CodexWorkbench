import { App, PostMessageTransport, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { PLUGIN_VERSION } from '../contracts/version';
import type { AttachReadingContextInput, ReadingContextSummary, ReadingSelectionPart } from '../contracts/context';
import { paperMarkdownGenerationDraft, readingDraft } from './reading-context-client';
import { createPickerClient } from './picker-client';
import { mergeHostPatch } from './activity';

export interface HostState {
  connected: boolean;
  preview: boolean;
  theme: 'light' | 'dark';
  canSendSelection: boolean;
  canAttachContext?: boolean;
  error?: string;
  view?: string;
  paperPath?: string;
  vaultId?: string;
  routeRevision?: number;
}

const embedded = window.parent !== window;
const app = new App({ name: 'Agentero Library', version: PLUGIN_VERSION }, {}, { autoResize: false });
const extensions = new OpenAIExtensions(app);
const listeners = new Set<(state: HostState) => void>();
const beforeTeardown = new Set<() => Promise<void>>();
const pickers = createPickerClient(callRemoteTool);
let state: HostState = { connected: false, preview: !embedded, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', canSendSelection: false };
let connection: Promise<void> | undefined;
const publish = (patch: Partial<HostState>) => {
  const next = mergeHostPatch(state, patch);
  if (next === state) return;
  const changedTheme = next.theme !== state.theme;
  state = next;
  if (changedTheme) applyDocumentTheme(state.theme);
  for (const listener of listeners) listener(state);
};

app.onhostcontextchanged = (context) => {
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.theme) publish({ theme: context.theme === 'dark' ? 'dark' : 'light' });
};
app.ontoolinput = ({ arguments: args }) => {
  if (args) publish({ view: typeof args.view === 'string' ? args.view : undefined, paperPath: typeof args.paperPath === 'string' ? args.paperPath : undefined, vaultId: typeof args.vaultId === 'string' ? args.vaultId : undefined, routeRevision: (state.routeRevision ?? 0) + 1 });
};
app.ontoolresult = (result) => {
  const content = result.structuredContent as Record<string, unknown> | undefined;
  const data = content?.data as Record<string, unknown> | undefined;
  if (data && typeof data.view === 'string') publish({ view: data.view, paperPath: typeof data.paperPath === 'string' ? data.paperPath : undefined, vaultId: typeof data.vaultId === 'string' ? data.vaultId : undefined, routeRevision: (state.routeRevision ?? 0) + 1 });
};
app.onteardown = async () => {
  // Await a separate server acknowledgement; SDK cancellation may stop at the host.
  // Other cleanup, including note recovery, must also run when cancellation fails.
  const [pickerCleanup] = await Promise.allSettled([
    pickers.cancelAll(),
    ...[...beforeTeardown].map(async task => { await task(); }),
  ]);
  if (pickerCleanup.status === 'rejected') throw pickerCleanup.reason;
  publish({ connected: false, canSendSelection: false });
  return {};
};

function connect() {
  if (!embedded) return Promise.reject(new Error('请在 Codex 插件中打开文献库；此页面仅供界面预览。'));
  connection ??= app.connect(new PostMessageTransport(window.parent, window.parent), { timeout: 15_000 }).then(() => {
    const context = app.getHostContext();
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
    const canAttachContext = Boolean(extensions.message && app.getHostCapabilities()?.message);
    publish({ connected: true, theme: context?.theme === 'dark' ? 'dark' : 'light', canSendSelection: canAttachContext, canAttachContext });
  }).catch((error: unknown) => {
    publish({ error: error instanceof Error ? error.message : String(error), connected: false });
    throw error;
  });
  return connection;
}

export function getHostState() { return state; }
export function registerBeforeTeardown(task: () => Promise<void>) {
  beforeTeardown.add(task);
  return () => { beforeTeardown.delete(task); };
}
export function subscribeHost(listener: (state: HostState) => void) {
  listeners.add(listener);
  listener(state);
  return () => { listeners.delete(listener); };
}

export async function callTool<T = unknown>(name: string, args: Record<string, unknown> = {}, options: { signal?: AbortSignal } = {}): Promise<T> {
  if (name === 'file_picker') return await pickers.pick(args, options) as T;
  return callRemoteTool<T>(name, args, options);
}

/** Used before a local view unmounts; a failed cancellation remains retryable. */
export const cancelAppPickers = () => pickers.cancelAll();

async function callRemoteTool<T = unknown>(name: string, args: Record<string, unknown> = {}, options: { signal?: AbortSignal } = {}): Promise<T> {
  await connect();
  options.signal?.throwIfAborted();
  const timeout = name === 'file_picker' ? 300_000 : name === 'file_picker_cancel' ? 15_000 : 90_000;
  const result = await app.callServerTool({ name, arguments: args }, { timeout, signal: options.signal });
  const content = result.structuredContent as Record<string, unknown> | undefined;
  if (result.isError || content?.ok === false) {
    const failure = content?.error as { message?: string; code?: string } | undefined;
    const error = new Error(failure?.message ?? '操作失败，请重试或查看配置与诊断。') as Error & { code?: string };
    error.code = failure?.code;
    throw error;
  }
  if (name === 'pdf_read_chunk') return result._meta?.pdfChunk as T;
  const payloadKey = ({ file_picker: 'picker', paper_export: 'export', bibliography_export: 'export', note_asset_read: 'asset', note_asset_import: 'asset', mark_asset_read: 'asset', paper_layout: 'layout', paper_markdown: 'document', mark_list: 'marks', mark_add: 'marks', mark_update: 'marks', mark_delete: 'marks' } as Record<string, string>)[name];
  if (payloadKey && result._meta?.[payloadKey]) return result._meta[payloadKey] as T;
  if (name === 'settings_read' || name === 'settings_update') return (result._meta?.settings ?? content?.values) as T;
  return (content?.data ?? content) as T;
}

export async function openLink(value: string): Promise<void> {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('链接地址无效。'); }
  if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) throw new Error('只支持安全的网页或邮件链接。');
  await connect();
  const result = await app.openLink({ url: url.href });
  if (result.isError) throw new Error('宿主未能打开此链接，请复制地址后重试。');
}
export const openExternalLink = openLink;

export async function appendPaperMarkdownGenerationDraft(input: { vaultId: string; paperPath: string }): Promise<void> {
  await connect();
  const message = extensions.message;
  if (!state.canAttachContext || !message) throw new Error('当前宿主不支持附加任务草稿，请复制任务后手动发送；尚未解析论文。');
  const paper = await callTool<{ vaultId: string; path: string; title: string }>('paper_get', input);
  if (paper.vaultId !== input.vaultId || paper.path !== input.paperPath || !paper.title?.trim()) throw new Error('论文引用已变化，请重新打开论文后再附加任务。');
  const response = await message.send(paperMarkdownGenerationDraft({ ...input, title: paper.title }));
  if (response.isError) throw new Error('宿主未确认附加任务草稿，请检查输入框后再重试；尚未解析论文。');
}

export async function attachReadingContext(input: AttachReadingContextInput): Promise<{ contextId: string; attached: true }> {
  await connect();
  const message = extensions.message;
  if (!state.canAttachContext || !message) throw new Error('当前宿主未提供原生输入框草稿能力，未自动发送。请复制来源后手动附加。');
  const { title: _title, taskText, ...request } = input;
  const result = await callTool<ReadingContextSummary>('reading_context_create', request);
  // Titled text becomes a removable composer item. send:false appends without
  // replacing the user's existing draft or launching a model turn.
  const response = await message.send(readingDraft(result, taskText));
  if (response.isError) throw new Error('宿主未确认附加到输入框；未自动发送，请先检查输入框再重试。');
  return { contextId: result.contextId, attached: true };
}

export async function sendSelection(input: { text: string; paperPath: string; vaultId: string; page: number; title: string; question?: string; parts?: ReadingSelectionPart[] }) {
  return attachReadingContext({ vaultId: input.vaultId, paperPath: input.paperPath, title: input.title, pages: input.parts?.map(part => part.page) ?? [input.page], markIds: [],
    selection: { text: input.text, parts: input.parts ?? [{ page: input.page, quote: input.text }] }, action: 'summarize', taskText: input.question });
}

if (embedded) void connect().catch(() => {});
