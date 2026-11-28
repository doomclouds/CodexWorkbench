import { toJson, type MessageInitShape } from '@bufbuild/protobuf';
import {
  FeedbackRejectionReason,
  FeedbackService,
  FeedbackThreadStatus,
  type ApplyFeedbackRequestSchema,
  type FeedbackReceipt,
} from '@codexworkbench/luming-studio-ii-contracts/feedback/service';
import { BoardSuggestionService } from '@codexworkbench/luming-studio-ii-contracts/suggestions/service';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { feedbackAnchor, modelFeedbackTarget } from './artifact-feedback-input.js';
import {
  artifactIdentifier,
  artifactVersion,
  modelBoardId,
  modelCommandId,
  modelVersion,
} from './artifact-tool-input.js';
import type { LocalRequest } from './local-request.js';
import { BridgeError, invalidArgument } from './errors.js';
import { callModelRpc, modelToolFailure, type ModelToolOptions } from './model-tool.js';

const wireObject = z.record(z.string(), z.json());
const suggestionEdit = z.union([
  z.object({ geometry: wireObject }).strict(),
  z.object({ content: wireObject }).strict(),
]);
const suggestionOption = z.object({
  optionId: artifactIdentifier,
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
});
const option = z.union([
  suggestionOption.extend({ edit: suggestionEdit }).strict(),
  suggestionOption.extend({ operations: z.array(suggestionEdit).min(1).max(60) }).strict(),
]);

const feedbackSchema = z
  .object({
    artifactId: artifactIdentifier.optional(),
    boardId: artifactIdentifier.optional(),
    action: z.enum([
      'list',
      'get',
      'create',
      'reply',
      'edit',
      'delete',
      'resolve',
      'reopen',
      'receipt',
      'suggest',
      'preview',
      'choose',
      'withdraw',
      'send',
      'attached',
      'processing',
    ]),
    feedbackId: artifactIdentifier.optional(),
    threadId: artifactIdentifier.optional(),
    replyId: artifactIdentifier.optional(),
    messageId: artifactIdentifier.optional(),
    operationId: artifactIdentifier.optional(),
    commandId: artifactIdentifier.optional(),
    type: z.enum(['comment', 'request']).optional(),
    text: z.string().trim().min(1).max(20000).optional(),
    expectedText: z.string().max(20000).optional(),
    expectedMessageVersion: artifactVersion.optional(),
    expectedThreadVersion: artifactVersion.optional(),
    anchor: feedbackAnchor.optional(),
    versions: z.record(artifactIdentifier, artifactVersion).optional(),
    cursor: z.string().min(1).max(2048).optional(),
    limit: z.number().int().min(1).max(20).optional(),
    status: z.enum(['all', 'open', 'unresolved', 'resolved']).optional(),
    sourceId: artifactIdentifier.optional(),
    proposalId: artifactIdentifier.optional(),
    optionId: artifactIdentifier.optional(),
    taskId: artifactIdentifier.optional(),
    generation: artifactIdentifier.optional(),
    expectedProposalVersion: artifactVersion.optional(),
    options: z.array(option).min(2).max(4).optional(),
  })
  .strict();

type FeedbackInput = z.infer<typeof feedbackSchema>;
type FeedbackOperation = MessageInitShape<typeof ApplyFeedbackRequestSchema>['operation'];
type SuggestionOption = z.infer<typeof option>;

interface FeedbackSuggestionInput {
  readonly boardId: string;
  readonly sourceId: string;
  readonly commandId: string;
  readonly observation: string;
  readonly options: SuggestionOption[];
}

export interface FeedbackToolOptions extends ModelToolOptions {
  readonly agentId?: string;
  readonly dispatchAgentChoice?: (body: Uint8Array, signal: AbortSignal) => Promise<Response>;
  readonly dispatchAgentFeedback?: (
    agentId: string,
    request: LocalRequest,
    signal: AbortSignal,
  ) => Promise<Response>;
  readonly submitSuggestion?: (
    input: FeedbackSuggestionInput,
    signal: AbortSignal,
  ) => Promise<{ readonly ok: boolean }>;
}

function feedbackRpcOptions(options: FeedbackToolOptions): ModelToolOptions {
  const { agentId, dispatchAgentFeedback } = options;
  if (!agentId || !dispatchAgentFeedback) {
    throw new BridgeError('UNAVAILABLE', '当前连接未提供独立的 Agent 备注身份。');
  }

  return {
    ...options,
    dispatch: (request, signal) => dispatchAgentFeedback(agentId, request, signal),
  };
}

const maximumFeedbackReply = 768 * 1024;
const maximumSuggestionReply = 2 * 1024 * 1024;
const rejections = new Map<FeedbackRejectionReason, [string, string]>([
  [FeedbackRejectionReason.INVALID_TEXT, ['INVALID_ARGUMENT', '备注内容无效。']],
  [FeedbackRejectionReason.INVALID_ANCHOR, ['INVALID_ARGUMENT', '备注来源无效，请重新读取目标。']],
  [FeedbackRejectionReason.TARGET_CHANGED, ['CONFLICT', '备注目标已有变化，请重新读取后再操作。']],
  [FeedbackRejectionReason.NOT_FOUND, ['NOT_FOUND', '找不到对应的备注或回复。']],
  [FeedbackRejectionReason.FORBIDDEN, ['FORBIDDEN', '当前身份无权执行这项备注操作。']],
  [
    FeedbackRejectionReason.VERSION_CHANGED,
    ['CONFLICT', '备注或回复已有新版本，请先核对最新内容。'],
  ],
  [FeedbackRejectionReason.COMMAND_ID_REUSE, ['CONFLICT', '同一操作 ID 已用于不同的请求。']],
]);

function success(data: unknown) {
  return { content: [], structuredContent: { ok: true, data } };
}

function feedbackError(code: string, message: string, data?: object) {
  return {
    content: [],
    isError: true,
    structuredContent: { ok: false, error: { code, message, ...data } },
  };
}

function required<T>(value: T | undefined, detail: string): T {
  if (value === undefined) {
    throw invalidArgument(detail);
  }

  return value;
}

function threadId(input: FeedbackInput) {
  if (input.threadId && input.feedbackId && input.threadId !== input.feedbackId) {
    throw invalidArgument('threadId 和 feedbackId 应指向同一条备注。');
  }

  return required(input.threadId ?? input.feedbackId, '请指定 feedbackId。');
}

function actionText(input: FeedbackInput) {
  return required(input.text, '请填写备注文本。');
}

function readThread(
  options: FeedbackToolOptions,
  boardId: string,
  input: FeedbackInput,
  signal: AbortSignal,
) {
  return callModelRpc(
    feedbackRpcOptions(options),
    FeedbackService.method.getThread,
    {
      boardId,
      threadId: threadId(input),
      pageSize: input.limit ?? 10,
      cursor: input.cursor,
    },
    signal,
    maximumFeedbackReply,
  );
}

function requireThreadVersion(input: FeedbackInput) {
  return required(
    modelVersion(input.expectedThreadVersion),
    '修改讨论状态前请读取备注并提供 expectedThreadVersion。',
  );
}

async function messageEdit(
  options: FeedbackToolOptions,
  boardId: string,
  input: FeedbackInput,
  signal: AbortSignal,
): Promise<FeedbackOperation> {
  const id = threadId(input);
  if (input.messageId && input.replyId && input.messageId !== input.replyId) {
    throw invalidArgument('messageId 和 replyId 应指向同一条回复。');
  }

  const messageId = input.messageId ?? input.replyId;
  const expected = modelVersion(input.expectedMessageVersion);
  const text = actionText(input);
  if (messageId && expected !== undefined && input.expectedText === undefined) {
    return {
      case: 'edit',
      value: { threadId: id, messageId, expectedMessageVersion: expected, text },
    };
  }

  const { thread, replies } = await readThread(options, boardId, input, signal);
  const message = messageId
    ? [thread?.first, ...replies].find((candidate) => candidate?.messageId === messageId)
    : thread?.first;

  if (!message) {
    throw new BridgeError('NOT_FOUND', '没有读到要编辑的回复，请提供回复 ID 和版本。');
  }
  if (expected === undefined && input.expectedText === undefined) {
    throw invalidArgument('请提供 expectedMessageVersion 或读取时的 expectedText。');
  }
  if (input.expectedText !== undefined && input.expectedText !== message.text) {
    throw new BridgeError('CONFLICT', '备注已被修改，请读取新内容后再编辑。');
  }

  return {
    case: 'edit',
    value: {
      threadId: id,
      messageId: message.messageId,
      expectedMessageVersion: expected ?? message.version,
      text,
    },
  };
}

function feedbackReceipt(receipt: FeedbackReceipt | undefined, boardId: string, commandId: string) {
  if (receipt?.boardId !== boardId || receipt.commandId !== commandId) {
    throw new BridgeError('UNAVAILABLE', '未取得对应操作回执，请按 operationId 核对。');
  }

  switch (receipt.outcome.case) {
    case 'applied': {
      const { threadId, threadVersion, messageId, messageVersion, deleted } = receipt.outcome.value;

      return success({
        commandId,
        feedbackId: threadId,
        threadId,
        threadVersion: threadVersion.toString(),
        messageId,
        messageVersion: messageVersion?.toString(),
        deleted,
      });
    }
    case 'rejected': {
      const { reason, currentVersion } = receipt.outcome.value;
      const [code, message] = rejections.get(reason) ?? ['UNAVAILABLE', '备注操作被拒绝。'];

      return feedbackError(code, message, {
        commandId,
        currentVersion: currentVersion?.toString(),
      });
    }
    case undefined:
      throw new BridgeError('UNAVAILABLE', '未得到完整回执，请核对原操作 ID。');
  }
}

async function mutateFeedback(
  options: FeedbackToolOptions,
  boardId: string,
  input: FeedbackInput,
  operation: FeedbackOperation,
  signal: AbortSignal,
) {
  const legacy =
    input.action === 'reply' && !input.commandId && !input.operationId ? input.replyId : undefined;
  const commandId = legacy ?? modelCommandId(input);
  const { receipt } = await callModelRpc(
    feedbackRpcOptions(options),
    FeedbackService.method.applyFeedback,
    {
      boardId,
      commandId,
      operation,
    },
    signal,
  );

  return feedbackReceipt(receipt, boardId, commandId);
}

async function getReceipt(
  options: FeedbackToolOptions,
  boardId: string,
  input: FeedbackInput,
  signal: AbortSignal,
) {
  const commandId = modelCommandId(input);
  const { result } = await callModelRpc(
    feedbackRpcOptions(options),
    FeedbackService.method.getFeedbackReceipt,
    { boardId, commandId },
    signal,
  );

  return result.case === 'receipt'
    ? feedbackReceipt(result.value, boardId, commandId)
    : success({ commandId, state: 'notRecorded' });
}

function proposalTarget(input: FeedbackInput) {
  return {
    proposalId: required(input.proposalId, '请指定建议回执中的 proposalId。'),
    expectedProposalVersion: required(
      modelVersion(input.expectedProposalVersion),
      '请提供已读取的 expectedProposalVersion。',
    ),
  };
}

async function previewSuggestion(
  options: ModelToolOptions,
  boardId: string,
  input: FeedbackInput,
  signal: AbortSignal,
) {
  const method = BoardSuggestionService.method.previewBoardSuggestion;
  const result = await callModelRpc(
    options,
    method,
    {
      ...proposalTarget(input),
      boardId,
      optionId: required(input.optionId, '请指定方案 optionId。'),
    },
    signal,
    maximumSuggestionReply,
  );

  if (result.result.case !== 'preview') {
    const code = result.result.case === 'conflict' ? 'CONFLICT' : 'INVALID_ARGUMENT';

    return feedbackError(code, '建议与当前保存状态不匹配，请重读后再预览。');
  }
  const { boardRevision, changedObjects, removedObjectIds, objectOrder } = result.result.value;
  const objects = changedObjects.map(({ objectId, label, kind, geometry }) => ({
    objectId,
    label,
    kind,
    geometry,
  }));

  return success({
    boardRevision: boardRevision?.toString(),
    changedObjects: objects,
    removedObjectIds,
    objectOrder,
  });
}

async function chooseSuggestion(
  options: FeedbackToolOptions,
  boardId: string,
  input: FeedbackInput,
  signal: AbortSignal,
) {
  const { agentId, dispatchAgentChoice } = options;
  if (!agentId || !dispatchAgentChoice) {
    throw new BridgeError(
      'FORBIDDEN',
      '当前会话没有 Agent 采纳能力。请在 Studio II 白板的「备注」面板打开建议，手动选择方案。',
    );
  }

  const method = BoardSuggestionService.method.chooseAgentBoardSuggestion;
  const commandId = modelCommandId(input);
  const result = await callModelRpc(
    {
      ...options,
      dispatch(request, requestSignal) {
        if (!(request.body instanceof Uint8Array)) {
          throw invalidArgument('Agent 采纳请求必须使用白板协议。');
        }

        return dispatchAgentChoice(request.body, requestSignal);
      },
    },
    method,
    {
      ...proposalTarget(input),
      boardId,
      commandId,
      agentId,
      taskId: required(input.taskId, '请提供 artifact_activity 返回的 taskId。'),
      generation: required(input.generation, '请提供当前工作区 generation。'),
      optionId: required(input.optionId, '请指定方案 optionId。'),
    },
    signal,
    maximumSuggestionReply,
  );
  const { receipt } = result;
  if (receipt?.commandId !== commandId || receipt.boardId !== boardId) {
    throw new BridgeError('UNAVAILABLE', '未取得该建议的保存回执。');
  }

  if (receipt.outcome.case === 'applied') {
    const { boardRevision, changedObjects, removedObjectIds } = receipt.outcome.value;

    return success({
      commandId,
      boardRevision: boardRevision?.toString(),
      changedIds: changedObjects.map(({ objectId }) => objectId),
      removedObjectIds,
    });
  }

  return feedbackError(
    receipt.outcome.case === 'conflict' ? 'CONFLICT' : 'INVALID_ARGUMENT',
    '未保存该方案的更改。请核对工作区代次、实际影响范围和建议版本。',
    { commandId },
  );
}

async function withdrawSuggestion(
  options: ModelToolOptions,
  boardId: string,
  input: FeedbackInput,
  signal: AbortSignal,
) {
  const method = BoardSuggestionService.method.rejectBoardSuggestion;
  const commandId = modelCommandId(input);
  const result = await callModelRpc(
    options,
    method,
    { ...proposalTarget(input), boardId, commandId },
    signal,
  );

  if (!result.suggestion) {
    throw new BridgeError('UNAVAILABLE', '未取得建议关闭确认。');
  }

  return success({ commandId, proposal: toJson(method.output, result) });
}

async function submitSuggestion(
  options: FeedbackToolOptions,
  boardId: string,
  input: FeedbackInput,
  signal: AbortSignal,
) {
  const submit = options.submitSuggestion;
  if (!submit) {
    throw new BridgeError('UNAVAILABLE', '当前宿主没有 Agent 建议传输入口。');
  }

  const result = await submit(
    {
      boardId,
      commandId: modelCommandId(input),
      sourceId: required(
        input.sourceId,
        '请使用用户从白板备注附加到对话所提供的审阅来源 sourceId。',
      ),
      observation: actionText(input),
      options: required(input.options, '请提供两个到四个候选方案。'),
    },
    signal,
  );

  return { content: [], structuredContent: result, isError: !result.ok };
}

function readStatus(status: FeedbackInput['status']) {
  if (status === 'resolved') {
    return FeedbackThreadStatus.RESOLVED;
  }

  return status === 'open' || status === 'unresolved'
    ? FeedbackThreadStatus.OPEN
    : FeedbackThreadStatus.UNSPECIFIED;
}

async function listFeedback(
  options: FeedbackToolOptions,
  boardId: string,
  input: FeedbackInput,
  signal: AbortSignal,
) {
  const method = FeedbackService.method.listThreads;
  const result = await callModelRpc(
    feedbackRpcOptions(options),
    method,
    {
      boardId,
      pageSize: input.limit ?? 10,
      cursor: input.cursor,
      status: readStatus(input.status),
    },
    signal,
    maximumFeedbackReply,
  );

  return success(toJson(method.output, result));
}

async function readFeedback(
  options: FeedbackToolOptions,
  boardId: string,
  input: FeedbackInput,
  signal: AbortSignal,
) {
  const result = await readThread(options, boardId, input, signal);

  return success(toJson(FeedbackService.method.getThread.output, result));
}

async function runFeedback(
  options: FeedbackToolOptions,
  input: FeedbackInput,
  signal: AbortSignal,
) {
  const boardId = modelBoardId(input);
  switch (input.action) {
    case 'list':
      return listFeedback(options, boardId, input, signal);
    case 'get':
      return readFeedback(options, boardId, input, signal);
    case 'receipt':
      return getReceipt(options, boardId, input, signal);
    case 'create': {
      const text = actionText(input);
      const anchor = await modelFeedbackTarget(
        options,
        boardId,
        input.anchor ?? {},
        input.versions,
        signal,
      );

      return mutateFeedback(
        options,
        boardId,
        input,
        { case: 'create', value: { text, anchor } },
        signal,
      );
    }
    case 'reply':
      return mutateFeedback(
        options,
        boardId,
        input,
        { case: 'reply', value: { threadId: threadId(input), text: actionText(input) } },
        signal,
      );
    case 'edit': {
      const operation = await messageEdit(options, boardId, input, signal);

      return mutateFeedback(options, boardId, input, operation, signal);
    }
    case 'resolve':
    case 'reopen':
    case 'delete':
      return mutateFeedback(
        options,
        boardId,
        input,
        {
          case: input.action,
          value: { threadId: threadId(input), expectedThreadVersion: requireThreadVersion(input) },
        },
        signal,
      );
    case 'suggest':
      return submitSuggestion(options, boardId, input, signal);
    case 'preview':
      return previewSuggestion(options, boardId, input, signal);
    case 'choose':
      return chooseSuggestion(options, boardId, input, signal);
    case 'withdraw':
      return withdrawSuggestion(options, boardId, input, signal);
    case 'send':
    case 'attached':
      return feedbackError('APP_ONLY', '附加备注请从白板的备注或 Codex 对话界面操作。');
    case 'processing':
      return feedbackError(
        'USE_ARTIFACT_ACTIVITY',
        '处理进度由 artifact_activity 的当前任务和代次维护。',
      );
  }
}

export function registerArtifactFeedbackTool(server: McpServer, options: FeedbackToolOptions) {
  server.registerTool(
    'artifact_feedback',
    {
      title: '读取与管理白板备注',
      description:
        '按页读取备注与回复，创建、编辑、解决和删除讨论，或通过冻结来源读写建议。正文位置绑定稳定对象及其版本。写入保留同一 operationId，超时后先查询 receipt。',
      inputSchema: feedbackSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ['model'] } },
    },
    async (input, { signal }) => {
      try {
        return await runFeedback(options, input, signal);
      } catch (error) {
        return modelToolFailure(error, options.onError);
      }
    },
  );
}
