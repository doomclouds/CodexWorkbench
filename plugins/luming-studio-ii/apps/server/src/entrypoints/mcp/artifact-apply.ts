import { Buffer } from 'node:buffer';
import { create, fromBinary, fromJson, toBinary, toJson, type JsonValue } from '@bufbuild/protobuf';
import { BoardAgentWriteService } from '@codexworkbench/luming-studio-ii-contracts/agent-write/service';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeError, invalidArgument, tooLarge } from './errors.js';
import { readModelBytes } from './model-tool.js';

const { applyAgentBoardEdit, getAgentBoardEditReceipt } = BoardAgentWriteService.method;
const maximumRequestBytes = 256 * 1024;
const maximumReceiptBytes = 2 * 1024 * 1024;
const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/u);
const operation = z.union([
  z.strictObject({ geometry: z.record(z.string(), z.unknown()) }),
  z.strictObject({ content: z.record(z.string(), z.unknown()) }),
]);

export const artifactApplySchema = z.strictObject({
  boardId: identifier,
  taskId: identifier,
  generation: identifier,
  commandId: identifier,
  operations: z.array(operation).min(1).max(60),
});

type ArtifactApplyInput = z.infer<typeof artifactApplySchema>;
export type AgentReceiptLookup = (
  input: ArtifactApplyInput,
  signal: AbortSignal,
) => Promise<JsonValue>;

interface ArtifactApplyOptions {
  readonly agentId: string;
  readonly dispatch: (body: Uint8Array, signal: AbortSignal) => Promise<Response>;
  readonly onError: (error: unknown) => void;
}

function editRequest(input: ArtifactApplyInput, agentId: string) {
  const json = JSON.stringify({ ...input, agentId });
  if (Buffer.byteLength(json, 'utf8') > maximumRequestBytes) {
    throw tooLarge('Agent 写入超过单次提交限制。');
  }

  try {
    const value = JSON.parse(json) as JsonValue;
    return fromJson(applyAgentBoardEdit.input, value);
  } catch (error) {
    throw new BridgeError('INVALID_ARGUMENT', '请使用 II 的 Protobuf JSON 几何或正文操作。', {
      cause: error,
    });
  }
}

function checkStatus(status: number) {
  switch (status) {
    case 200:
      return;
    case 400:
      throw invalidArgument('请提供有效的工作区和有序白板操作。');
    case 401:
    case 403:
      throw new BridgeError('FORBIDDEN', '当前 Agent 没有对白板工作区的写入权限。');
    case 409:
      throw new BridgeError('CONFLICT', '请求内容与原白板写入命令不一致。');
    case 413:
      throw tooLarge('Agent 写入超过单次提交限制。');
    default:
      throw new BridgeError('UNAVAILABLE', '白板写入结果待核对。以相同命令 ID 重送原请求。');
  }
}

async function receiptBytes(response: Response) {
  checkStatus(response.status);
  return readModelBytes(response, maximumReceiptBytes);
}

export function createAgentReceiptLookup(
  agentId: string,
  dispatch: ArtifactApplyOptions['dispatch'],
): AgentReceiptLookup {
  return async (input, signal) => {
    signal.throwIfAborted();
    const method = getAgentBoardEditReceipt;
    const request = create(method.input, { original: editRequest(input, agentId) });
    const body = toBinary(method.input, request);
    const bytes = await receiptBytes(await dispatch(body, signal));
    const result = fromBinary(method.output, bytes, { readUnknownFields: false });
    signal.throwIfAborted();
    if (!result.receipt) {
      throw new BridgeError('COMMIT_RESULT_UNKNOWN', '未找到同一任务与原命令的已提交回执。');
    }
    if (result.receipt.boardId !== input.boardId || result.receipt.commandId !== input.commandId) {
      throw new BridgeError('UNAVAILABLE', '白板返回了无法核对的写入回执。');
    }

    return toJson(method.output, result);
  };
}

export function registerArtifactApply(server: McpServer, options: ArtifactApplyOptions) {
  const { agentId, dispatch, onError } = options;
  server.registerTool(
    'artifact_apply',
    {
      title: '提交工作区内的白板修改',
      description:
        '使用 artifact_activity 返回的 taskId 与 generation，原子执行实际工作范围内的有序修改。operations 每项是 II Protobuf JSON geometry 或 content 操作，内层省略白板及命令 ID。从有界回执确认已保存版次。失联时先用 artifact_read 的 operation-receipt 模式和原请求查询。',
      inputSchema: artifactApplySchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (input, { signal }) => {
      try {
        signal.throwIfAborted();
        const method = applyAgentBoardEdit;
        const body = toBinary(method.input, editRequest(input, agentId));
        const bytes = await receiptBytes(await dispatch(body, signal));
        const result = fromBinary(method.output, bytes, { readUnknownFields: false });
        signal.throwIfAborted();
        const receipt = result.receipt;
        if (receipt?.boardId !== input.boardId || receipt.commandId !== input.commandId) {
          throw new BridgeError('UNAVAILABLE', '白板返回了无法核对的写入回执。');
        }

        const ok = receipt.outcome.case === 'applied';
        return {
          content: [],
          structuredContent: { ok, data: toJson(method.output, result) },
          isError: !ok,
        };
      } catch (error) {
        if (!(error instanceof BridgeError)) {
          onError(error);
        }

        const failure =
          error instanceof BridgeError
            ? error
            : new BridgeError('UNAVAILABLE', '写入结果待核对，请以相同命令 ID 重送原请求。');

        return {
          content: [],
          structuredContent: { ok: false, error: { code: failure.code, message: failure.message } },
          isError: true,
        };
      }
    },
  );
}
