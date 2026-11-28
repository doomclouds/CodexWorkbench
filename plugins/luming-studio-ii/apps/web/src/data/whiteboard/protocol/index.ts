import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { DescMessage, DescMethodUnary, MessageInitShape } from '@bufbuild/protobuf';
import {
  WhiteboardService as wireService,
  type MoveObjectsRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import type { WhiteboardMoveCommand, WhiteboardPost, WhiteboardService } from '../contracts.js';
import { readPayloads } from './payload.js';
import { readMoveReceipt, readReceiptLookup } from './receipt.js';
import { readScene } from './scene.js';
import { matchIdentity } from './values.js';

const payloadPageBudget = 512 * 1_024;

export async function request<Input extends DescMessage, Output extends DescMessage>(
  post: WhiteboardPost,
  method: DescMethodUnary<Input, Output>,
  input: MessageInitShape<Input>,
  signal?: AbortSignal,
) {
  const path = '/' + method.parent.typeName + '/' + method.name;
  const body = toBinary(method.input, create(method.input, input));
  const response = await post(path, body, signal);

  return fromBinary(method.output, response, { readUnknownFields: false });
}

function writeMove(
  command: WhiteboardMoveCommand,
): MessageInitShape<typeof MoveObjectsRequestSchema> {
  const { boardId, commandId, delta, targets } = command;

  return {
    boardId,
    commandId,
    delta: { dx: delta.x, dy: delta.y },
    targets: targets.map(({ id, expectedGeometryVersion }) => ({
      objectId: id,
      expectedGeometryVersion,
    })),
  };
}

export function createWhiteboardService(
  post: WhiteboardPost,
  resolveAssetUrl: (source: string) => string = (source) => source,
): WhiteboardService {
  const { getBoardScene, getObjectPayloads, moveObjects, getCommandReceipt } = wireService.method;

  return {
    async getScene(boardId, signal) {
      const response = await request(post, getBoardScene, { boardId }, signal);
      const scene = readScene(response.scene, boardId);

      return response.boundedPayloadRead ? { ...scene, boundedPayloadRead: true } : scene;
    },
    async getPayloads(boardId, ids, signal) {
      const objectIds = [...new Set(ids)];
      if (objectIds.length === 0) {
        return [];
      }

      const response = await request(post, getObjectPayloads, { boardId, objectIds }, signal);
      matchIdentity(response.boardId, boardId, 'board ID');

      return readPayloads(response.results, objectIds, resolveAssetUrl);
    },
    async getPayloadPage(boardId, objectIds, signal) {
      const response = await request(
        post,
        getObjectPayloads,
        { boardId, objectIds: [...objectIds], maxPayloadJsonBytes: payloadPageBudget },
        signal,
      );
      matchIdentity(response.boardId, boardId, 'board ID');
      const processed = objectIds.length - response.deferredObjectIds.length;
      const invalidSuffix = response.deferredObjectIds.some(
        (id, index) => id !== objectIds[processed + index],
      );

      if (processed <= 0 || invalidSuffix) {
        throw new Error('服务返回的正文分页范围无效。');
      }

      const results = readPayloads(
        response.results,
        objectIds.slice(0, processed),
        resolveAssetUrl,
      );

      return { results, processed };
    },
    async moveObjects(command, signal) {
      const response = await request(post, moveObjects, writeMove(command), signal);

      return readMoveReceipt(response.receipt, command);
    },
    async getReceipt(boardId, commandId, signal) {
      const response = await request(post, getCommandReceipt, { boardId, commandId }, signal);

      return readReceiptLookup(response, boardId, commandId);
    },
  };
}
