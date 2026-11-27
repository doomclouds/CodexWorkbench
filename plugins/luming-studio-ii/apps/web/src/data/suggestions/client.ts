import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { DescMessage, DescMethodUnary, MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardSuggestionService,
  type BoardReviewSource as WireReviewSource,
  type BoardSuggestion as WireSuggestion,
  type CreateBoardReviewSourceRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/suggestions/service';
import {
  readBoardEditChanges,
  readBoardEditReceipt,
  type WhiteboardEditService,
} from '../whiteboard/index.js';
import type {
  BoardReviewSource,
  BoardSuggestion,
  ReviewSourceCommand,
  ReviewSourceTarget,
  SuggestionPost,
  SuggestionService,
} from './contracts.js';

type ResolveAsset = (source: string) => string;
type AcceptanceReceipts = Pick<WhiteboardEditService, 'getReceipt'>;

async function request<Input extends DescMessage, Output extends DescMessage>(
  post: SuggestionPost,
  method: DescMethodUnary<Input, Output>,
  input: MessageInitShape<Input>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const path = '/' + method.parent.typeName + '/' + method.name;
  const payload = toBinary(method.input, create(method.input, input));
  const response = await post(path, payload, signal);
  signal?.throwIfAborted();

  return fromBinary(method.output, response, { readUnknownFields: false });
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error('建议服务未返回' + name + '。');
  }

  return value;
}

function readIdentifier(id: string, name: string): string {
  if (!id.trim()) {
    throw new Error('建议服务返回了无效的' + name + '。');
  }

  return id;
}

function readIdentifiers(ids: readonly string[], name: string): readonly string[] {
  const distinct = new Set(ids);
  if (distinct.size !== ids.length) {
    throw new Error('建议服务返回了重复的' + name + '。');
  }

  return ids.map((id) => readIdentifier(id, name));
}

function readSuggestion(value: WireSuggestion): BoardSuggestion {
  const {
    proposalId,
    sourceId,
    observation,
    proposalVersion,
    expiresAtMillis,
    options,
    acceptedOptionId,
    acceptedBoardRevision,
    activeOptionIds,
    rejected,
  } = value;
  const optionIds = readIdentifiers(
    options.map(({ optionId }) => optionId),
    '方案 ID',
  );

  const active = readIdentifiers(activeOptionIds, '已应用方案 ID');
  if (active.some((optionId) => !optionIds.includes(optionId))) {
    throw new Error('建议服务返回的应用状态与方案不匹配。');
  }

  return {
    proposalId: readIdentifier(proposalId, '建议 ID'),
    sourceId: readIdentifier(sourceId, '来源 ID'),
    observation,
    proposalVersion: required(proposalVersion, '建议版次'),
    expiresAtMillis,
    options: options.map(({ optionId, label, description }) => ({
      optionId,
      label: readIdentifier(label, '方案名称'),
      description,
    })),
    rejected,
    acceptedOptionId,
    acceptedBoardRevision,
    activeOptionIds: active,
  };
}

type WireReviewTarget = WireReviewSource['targets'][number];

function readTarget(target: WireReviewTarget): ReviewSourceTarget {
  const { x, y, width, height, rotation } = required(target.geometry, '目标几何');
  const coordinates = [x, y, width, height, rotation];
  if (!coordinates.every(Number.isFinite) || width < 0 || height < 0) {
    throw new Error('冻结来源含无效目标几何。');
  }

  return {
    objectId: readIdentifier(target.objectId, '目标 ID'),
    kind: readIdentifier(target.kind, '目标类型'),
    geometryVersion: required(target.geometryVersion, '目标几何版次'),
    payloadVersion: target.payloadVersion,
    geometry: { x, y, width, height, rotation },
  };
}

function readSource(
  source: WireReviewSource | undefined,
  command: ReviewSourceCommand,
): BoardReviewSource {
  const value = required(source, '冻结来源');
  const {
    sourceId,
    boardId,
    capturedBoardRevision,
    targetsBoardRevision,
    objectIds,
    feedbackThreadId,
  } = value;

  if (boardId !== command.boardId) {
    throw new Error('冻结来源与当前白板不匹配。');
  }

  const ids = readIdentifiers(objectIds, '来源对象 ID');
  const targets = value.targets.map(readTarget);
  const targetIds = readIdentifiers(
    targets.map(({ objectId }) => objectId),
    '目标 ID',
  );
  const frozenIds = new Set(ids);
  if (targetIds.length !== ids.length || targetIds.some((id) => !frozenIds.has(id))) {
    throw new Error('冻结来源的目标超出了明确指定的对象。');
  }

  if (command.origin.kind === 'selection') {
    const selected = new Set(command.origin.objectIds);
    if (ids.length !== selected.size || ids.some((id) => !selected.has(id))) {
      throw new Error('冻结来源与原选区不匹配。');
    }
  }
  if (command.origin.kind === 'feedback' && feedbackThreadId !== command.origin.threadId) {
    throw new Error('冻结来源与原批注不匹配。');
  }

  return {
    boardId,
    sourceId: readIdentifier(sourceId, '来源 ID'),
    capturedBoardRevision: required(capturedBoardRevision, '冻结版次'),
    targetsBoardRevision: required(targetsBoardRevision, '目标冻结版次'),
    targets,
    objectIds: ids,
    feedbackThreadId,
  };
}

function encodeSource(
  command: ReviewSourceCommand,
): MessageInitShape<typeof CreateBoardReviewSourceRequestSchema> {
  const { boardId, commandId, origin, expectedBoardRevision } = command;
  const identity = { boardId, commandId, expectedBoardRevision };
  if (origin.kind === 'selection') {
    return {
      ...identity,
      origin: { case: 'selection', value: { objectIds: [...origin.objectIds] } },
    };
  }

  return { ...identity, origin: { case: 'feedbackThreadId', value: origin.threadId } };
}

export function createSuggestionService(
  post: SuggestionPost,
  edits: AcceptanceReceipts,
  resolveAsset: ResolveAsset = (source) => source,
): SuggestionService {
  const {
    createBoardReviewSource,
    listBoardSuggestions,
    previewBoardSuggestion,
    acceptBoardSuggestion,
    rejectBoardSuggestion,
  } = BoardSuggestionService.method;

  return {
    async createReviewSource(command, signal) {
      const response = await request(post, createBoardReviewSource, encodeSource(command), signal);

      return readSource(response.source, command);
    },
    async listSuggestions(query, signal) {
      const { proposals, nextBeforeProposalId } = await request(
        post,
        listBoardSuggestions,
        query,
        signal,
      );
      readIdentifiers(
        proposals.map(({ proposalId }) => proposalId),
        '建议 ID',
      );

      return { proposals: proposals.map(readSuggestion), nextBeforeProposalId };
    },
    async previewSuggestion(query, signal) {
      const { result } = await request(post, previewBoardSuggestion, query, signal);
      switch (result.case) {
        case 'preview':
          return {
            kind: 'preview',
            frame: {
              boardId: query.boardId,
              proposalId: query.proposalId,
              optionId: query.optionId,
              changes: readBoardEditChanges(result.value, resolveAsset),
            },
          };
        case 'conflict':
          return { kind: 'conflict', revision: result.value.boardRevision };
        case 'rejected':
          return { kind: 'rejected', reason: 'unknown' };
        case undefined:
          throw new Error('建议服务未返回预览结果。');
      }
    },
    async acceptSuggestion(command, signal) {
      const response = await request(post, acceptBoardSuggestion, command, signal);

      return readBoardEditReceipt(
        response.receipt,
        command.boardId,
        command.commandId,
        resolveAsset,
      );
    },
    async rejectSuggestion(command, signal) {
      const response = await request(post, rejectBoardSuggestion, command, signal);
      const suggestion = readSuggestion(required(response.suggestion, '拒绝结果'));
      if (!suggestion.rejected || suggestion.proposalId !== command.proposalId) {
        throw new Error('建议服务返回的拒绝结果与原命令不匹配。');
      }

      return suggestion;
    },
    getAcceptReceipt(boardId, commandId, signal) {
      return edits.getReceipt(boardId, commandId, signal);
    },
  };
}
