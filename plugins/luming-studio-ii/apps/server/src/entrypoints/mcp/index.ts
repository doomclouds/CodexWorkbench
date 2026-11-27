import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  BoardCatalogService,
  BoardSortOrder,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Buffer } from 'node:buffer';
import { registerAgentActivity } from './agent-activity.js';
import { createAppBridge, type AppBridgeOptions } from './bridge.js';
import { BridgeError } from './errors.js';
import { protobufMediaType } from './operations.js';
import { bridgeSchema, openSchema } from './schema.js';

export type { AppBridgeOptions, LocalRequest } from './bridge.js';
export type { TransferFile } from './transfers.js';

const appUri = 'ui://luming-studio-ii/app';
const appMimeType = 'text/html;profile=mcp-app';
const appTitle = '鹿鸣 · Luming Studio II';
const name = 'luming-studio-ii';
const boardListBytes = 16 * 1024;
const defaultPageSize = 10;
const maxAgentSuggestionBytes = 128 * 1024;

const listSchema = z
  .object({
    query: z.string().max(200).optional(),
    cursor: z.string().max(2048).optional(),
    pageSize: z.number().int().min(1).max(20).optional(),
  })
  .strict();

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

interface StudioMcpOptions extends AppBridgeOptions {
  readonly html: string;
  readonly pluginVersion: string;
  readonly onError: (error: unknown) => void;
  readonly submitSuggestion?: SubmitSuggestion;
  readonly dispatchAgentActivity?: (body: Uint8Array, signal: AbortSignal) => Promise<Response>;
}

type ListInput = z.infer<typeof listSchema>;

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

async function listBoards(options: StudioMcpOptions, input: ListInput, signal: AbortSignal) {
  const method = BoardCatalogService.method.listBoards;
  const wire = create(method.input, {
    query: input.query ?? '',
    cursor: input.cursor,
    order: BoardSortOrder.RECENT,
    pageSize: input.pageSize ?? defaultPageSize,
  });
  const response = await options.dispatch(
    {
      route: '/' + BoardCatalogService.typeName + '/' + method.name,
      method: 'POST',
      mediaType: protobufMediaType,
      body: toBinary(method.input, wire),
    },
    signal,
  );
  const contentLength = Number(response.headers.get('content-length'));
  if (!response.ok || contentLength > boardListBytes) {
    await response.body?.cancel();
    throw new BridgeError('UNAVAILABLE', '当前无法读取作品列表。');
  }

  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > boardListBytes) {
    throw new BridgeError('TOO_LARGE', '作品列表超过单页大小限制。');
  }

  const { boards, nextCursor } = fromBinary(method.output, body, { readUnknownFields: false });
  const artifacts = boards.map(({ boardId, title, pinned }) => ({
    id: boardId,
    title,
    pinned,
    type: 'whiteboard',
  }));

  return { artifacts, nextCursor };
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
  const server = new McpServer({ name, version: options.pluginVersion });
  const bridge = createAppBridge(options);
  const { allocateId, dispatchAgentActivity, now, onError } = options;
  const closeAgentActivity =
    dispatchAgentActivity &&
    registerAgentActivity(server, {
      allocateId,
      dispatch: dispatchAgentActivity,
      now,
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
      description: '按名称查找本机可读取的活跃白板，使用游标续读。',
      inputSchema: listSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input, { signal }) => {
      try {
        return {
          content: [],
          structuredContent: { ok: true, data: await listBoards(options, input, signal) },
        };
      } catch (error) {
        return appError(error, options.onError);
      }
    },
  );
  registerSuggestions(server, options);

  server.registerResource(
    'studio-ui',
    appUri,
    { title: appTitle, mimeType: appMimeType },
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
      await Promise.all([bridge.close(), closeAgentActivity?.()]);
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
