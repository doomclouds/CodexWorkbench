import { fromBinary, fromJson, toBinary, toJson, type JsonObject } from '@bufbuild/protobuf';
import { BoardSuggestionService } from '@codexworkbench/luming-studio-ii-contracts/suggestions/service';

type OptionEdit = { readonly geometry: JsonObject } | { readonly content: JsonObject };

interface SuggestionOptionMetadata {
  readonly optionId: string;
  readonly label: string;
  readonly description?: string;
}

interface SingleSuggestionEdit {
  readonly edit: OptionEdit;
  readonly operations?: never;
}

interface OrderedSuggestionEdits {
  readonly edit?: never;
  readonly operations: readonly OptionEdit[];
}

type SuggestionOptionInput = SuggestionOptionMetadata &
  (SingleSuggestionEdit | OrderedSuggestionEdits);

interface ModelSuggestionInput {
  readonly boardId: string;
  readonly commandId: string;
  readonly sourceId: string;
  readonly observation: string;
  readonly options: readonly SuggestionOptionInput[];
}

type AgentDispatch = (body: Uint8Array, signal: AbortSignal) => Promise<Response>;

const maximumSuggestionBytes = 128 * 1024;
const maximumReplyBytes = 32 * 1024;
const submission = BoardSuggestionService.method.submitBoardSuggestion;

function refusal(code: string, message: string) {
  return { ok: false, error: { code, message } };
}

function responseFailure(status: number) {
  if (status === 401 || status === 403) {
    return refusal('FORBIDDEN', '建议的冻结来源或 Agent 授权已失效。');
  }
  if (status === 413) {
    return refusal('TOO_LARGE', '建议内容超过单次提交限制。');
  }
  if (status >= 500) {
    return refusal('UNAVAILABLE', '本机白板服务暂时无法接收建议。');
  }

  return refusal('INVALID_ARGUMENT', '建议与当前冻结来源或支持的操作不匹配。');
}

function modelOption(option: SuggestionOptionInput): JsonObject {
  const { optionId, label, description, edit, operations } = option;
  const metadata = { optionId, label, ...(description === undefined ? {} : { description }) };
  if (edit && operations === undefined) {
    return { ...metadata, ...edit };
  }
  if (!edit && operations?.length && operations.length <= 60) {
    return { ...metadata, operations: operations.map((item) => ({ ...item })) };
  }

  throw new TypeError('A model suggestion option requires one edit or a bounded list of edits.');
}

function toSubmitWire(input: ModelSuggestionInput) {
  const wire = fromJson(submission.input, {
    boardId: input.boardId,
    commandId: input.commandId,
    sourceId: input.sourceId,
    observation: input.observation,
    options: input.options.map(modelOption),
  });

  return toBinary(submission.input, wire);
}

export function createModelSuggestionSubmitter(dispatch: AgentDispatch) {
  return async (input: ModelSuggestionInput, signal: AbortSignal) => {
    let wire: Uint8Array;
    try {
      wire = toSubmitWire(input);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      return refusal('INVALID_ARGUMENT', '建议选项必须是合法的 Protobuf JSON 几何或正文操作。');
    }
    if (wire.byteLength > maximumSuggestionBytes) {
      return refusal('TOO_LARGE', '建议内容超过单次提交限制。');
    }

    const response = await dispatch(wire, signal);
    if (!response.ok) {
      await response.body?.cancel();

      return responseFailure(response.status);
    }
    if (Number(response.headers.get('content-length')) > maximumReplyBytes) {
      await response.body?.cancel();

      return refusal('TOO_LARGE', '建议确认超出可返回大小。');
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumReplyBytes) {
      return refusal('TOO_LARGE', '建议确认超出可返回大小。');
    }

    const result = fromBinary(submission.output, bytes, { readUnknownFields: false });
    if (!result.suggestion) {
      return refusal('UNAVAILABLE', '白板未返回建议确认。');
    }

    return { ok: true, data: toJson(submission.output, result) };
  };
}
