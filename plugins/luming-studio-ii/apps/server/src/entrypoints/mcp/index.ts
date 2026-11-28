import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Buffer } from 'node:buffer';
import { registerAgentActivity } from './agent-activity.js';
import { createAgentReceiptLookup, registerArtifactApply } from './artifact-apply.js';
import { registerArtifactContext } from './artifact-context.js';
import { artifactListSchema, listArtifacts } from './artifact-list.js';
import { registerArtifactRead } from './artifact-read.js';
import { registerArtifactTools } from './artifact-tools.js';
import { studioMcpIcon } from './branding.js';
import { createAppBridge, type AppBridgeOptions } from './bridge.js';
import type { LocalRequest } from './local-request.js';
import { BridgeError } from './errors.js';
import type { ModelToolOptions } from './model-tool.js';
import { bridgeSchema, openSchema } from './schema.js';

export type { AppBridgeOptions } from './bridge.js';
export type { LocalRequest } from './local-request.js';
export type { TransferFile } from './transfers.js';

const appUri = 'ui://luming-studio-ii/app';
const appMimeType = 'text/html;profile=mcp-app';
const appTitle = '鹿鸣 · Luming Studio II';
const name = 'luming-studio-ii';
const maxAgentSuggestionBytes = 128 * 1024;

const suggestionId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const commandObject = z.record(z.string(), z.json());
const suggestionOperationSchema = z.union([
  z.object({ geometry: commandObject }).strict(),
  z.object({ content: commandObject }).strict(),
]);
const suggestionOption = z.object({
  optionId: suggestionId,
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
});
const suggestionOptionSchema = z.union([
  suggestionOption.extend({ edit: suggestionOperationSchema }).strict(),
  suggestionOption
    .extend({ operations: z.array(suggestionOperationSchema).min(1).max(60) })
    .strict(),
]);
const suggestionSchema = z
  .object({
    boardId: suggestionId,
    sourceId: suggestionId,
    commandId: suggestionId,
    observation: z.string().trim().min(1).max(2000),
    options: z.array(suggestionOptionSchema).min(2).max(4),
  })
  .strict();

type SuggestionInput = z.infer<typeof suggestionSchema>;
type SuggestionResult = { readonly ok: boolean } & Readonly<Record<string, unknown>>;
type SubmitSuggestion = (input: SuggestionInput, signal: AbortSignal) => Promise<SuggestionResult>;

interface StudioMcpOptions extends AppBridgeOptions, ModelToolOptions {
  readonly html: string;
  readonly pluginVersion: string;
  readonly submitSuggestion?: SubmitSuggestion;
  readonly dispatchAgentActivity?: (body: Uint8Array, signal: AbortSignal) => Promise<Response>;
  readonly dispatchAgentWrite?: (body: Uint8Array, signal: AbortSignal) => Promise<Response>;
  readonly dispatchAgentReceipt?: (body: Uint8Array, signal: AbortSignal) => Promise<Response>;
  readonly dispatchAgentChoice?: (body: Uint8Array, signal: AbortSignal) => Promise<Response>;
  readonly dispatchAgentCreateBoard?: (
    agentId: string,
    request: LocalRequest,
    signal: AbortSignal,
  ) => Promise<Response>;
  readonly dispatchAgentFeedback?: (
    agentId: string,
    request: LocalRequest,
    signal: AbortSignal,
  ) => Promise<Response>;
}

function appError(error: unknown, report: StudioMcpOptions['onError']) {
  if (error instanceof BridgeError) {
    return {
      isError: true,
      content: [],
      structuredContent: { ok: false, error: { code: error.code, message: error.message } },
    };
  }

  report(error);

  return {
    isError: true,
    content: [],
    structuredContent: {
      ok: false,
      error: { code: 'UNAVAILABLE', message: '本机白板服务暂时不可用，请重新连接。' },
    },
  };
}

function registerSuggestions(server: McpServer, options: StudioMcpOptions): void {
  const submit = options.submitSuggestion;
  if (!submit) {
    return;
  }

  server.registerTool(
    'artifact_suggest',
    {
      title: '提交白板建议',
      description:
        '为用户已冻结的来源提交 2 至 4 个待人工接受的方案。每项用 edit 描述单个 Protobuf JSON 几何或正文操作，或用 operations 描述 1 至 60 个按顺序且原子生效的操作。内层命令只携带目标和已冻结的基线。',
      inputSchema: suggestionSchema,
      annotations: { openWorldHint: false, destructiveHint: false },
    },
    async (input, { signal }) => {
      try {
        if (Buffer.byteLength(JSON.stringify(input), 'utf8') > maxAgentSuggestionBytes) {
          throw new BridgeError('TOO_LARGE', '建议内容超过单次提交限制。');
        }

        const result = await submit(input, signal);

        return { content: [], structuredContent: result, isError: !result.ok };
      } catch (error) {
        return appError(error, options.onError);
      }
    },
  );
}

export function createStudioMcpServer(options: StudioMcpOptions): McpServer {
  const server = new McpServer({
    name,
    title: appTitle,
    version: options.pluginVersion,
    icons: [studioMcpIcon],
  });
  const bridge = createAppBridge(options);
  const {
    allocateId,
    dispatchAgentActivity,
    dispatchAgentWrite,
    dispatchAgentReceipt,
    dispatchAgentChoice,
    dispatchAgentFeedback,
    dispatchAgentCreateBoard,
    onError,
  } = options;
  const usesAgentIdentity = Boolean(
    dispatchAgentActivity ||
    dispatchAgentWrite ||
    dispatchAgentReceipt ||
    dispatchAgentChoice ||
    dispatchAgentFeedback ||
    dispatchAgentCreateBoard,
  );
  const agentId = usesAgentIdentity ? 'agent-' + allocateId() : undefined;
  const agentActivity =
    dispatchAgentActivity &&
    registerAgentActivity(server, {
      allocateId,
      agentId,
      dispatch: dispatchAgentActivity,
      reportError: onError,
    });

  server.registerTool(
    'studio_open',
    {
      title: appTitle,
      description: '在当前 Codex 对话中打开 Studio 工作台或指定白板。',
      inputSchema: openSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: appUri, visibility: ['app'] },
        'openai/ui': { entrypoints: [{ type: 'thread' }] },
      },
    },
    async ({ boardId }, { signal }) => {
      try {
        signal.throwIfAborted();
        const session = await bridge.connect(boardId);

        return {
          content: [],
          structuredContent: { ok: true, data: { boardId } },
          _meta: { session },
        };
      } catch (error) {
        return appError(error, options.onError);
      }
    },
  );

  server.registerTool(
    'studio_app_request',
    {
      title: '白板界面传输',
      description: 'Studio App 专用。通过指定协议和有界内容调用本机服务。',
      inputSchema: bridgeSchema,
      annotations: { openWorldHint: false },
      _meta: { ui: { visibility: ['app'] } },
    },
    async (input, { signal }) => {
      try {
        signal.throwIfAborted();
        const result = await bridge.execute(input, signal);

        return { content: [], structuredContent: { ok: true }, _meta: result };
      } catch (error) {
        return appError(error, options.onError);
      }
    },
  );

  server.registerTool(
    'artifact_list',
    {
      title: '查找白板',
      description:
        '按名称查找可读取的活跃白板，或用 trashed:true 查找自己的已回收白板。pinned:true 只看置顶；sort 可用 recent 或 title。默认每页 10 条，limit 或 pageSize 最多 20 条。翻页保留查询和筛选条件，使用 nextCursor 或 offset。',
      inputSchema: artifactListSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input, { signal }) => {
      try {
        return {
          content: [],
          structuredContent: { ok: true, data: await listArtifacts(options, input, signal) },
        };
      } catch (error) {
        return appError(error, options.onError);
      }
    },
  );
  registerSuggestions(server, options);
  const readOptions = { ...options, observeRead: agentActivity?.startRead };
  registerArtifactContext(server, readOptions);
  const lookupReceipt =
    agentId && dispatchAgentReceipt && createAgentReceiptLookup(agentId, dispatchAgentReceipt);
  registerArtifactRead(server, readOptions, lookupReceipt || undefined);
  const dispatchCreateBoard =
    agentId && dispatchAgentCreateBoard
      ? (request: LocalRequest, signal: AbortSignal) =>
          dispatchAgentCreateBoard(agentId, request, signal)
      : undefined;
  registerArtifactTools(server, { ...options, agentId, dispatchCreateBoard });
  if (dispatchAgentWrite && agentId) {
    registerArtifactApply(server, { agentId, dispatch: dispatchAgentWrite, onError });
  }

  server.registerResource(
    'studio-ui',
    appUri,
    { title: appTitle, mimeType: appMimeType, icons: [studioMcpIcon] },
    async () => ({
      contents: [
        {
          uri: appUri,
          mimeType: appMimeType,
          text: options.html,
          _meta: {
            ui: {
              permissions: { clipboardWrite: {} },
              csp: {
                connectDomains: [],
                resourceDomains: ['data:', 'blob:'],
                frameDomains: ["'self'", 'blob:', 'data:'],
              },
              prefersBorder: false,
            },
            'openai/ui': {
              preferredDisplayMode: 'fullscreen',
              availableDisplayModes: ['inline', 'fullscreen'],
            },
          },
        },
      ],
    }),
  );

  const closeServer = server.close.bind(server);
  let closing: Promise<void> | undefined;

  async function close() {
    try {
      await Promise.all([bridge.close(), agentActivity?.close()]);
    } finally {
      await closeServer();
    }
  }

  server.close = () => (closing ??= close());

  return server;
}

export async function connectStudioMcpServer(options: StudioMcpOptions) {
  const server = createStudioMcpServer(options);
  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    try {
      await server.close();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Could not open the Studio MCP transport.', {
        cause: cleanupError,
      });
    }
    throw error;
  }

  return server;
}
