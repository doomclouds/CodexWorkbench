import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { DescMessage, DescMethodUnary, MessageInitShape } from '@bufbuild/protobuf';
import { BoardSharingService as WireSharingService } from '@codexworkbench/luming-studio-ii-contracts/sharing/service';

import type { BoardSharingService, SharingCommand, SharingPost } from './contracts.js';
import {
  readBoardInvitation,
  readBoardSharing,
  readGuestJoin,
  readSharingReceipt,
} from './decode.js';
import { encodeSharingCommand } from './encode.js';

export type {
  BoardInvitation,
  BoardInvitationJoin,
  BoardInvitationRequest,
  BoardInvitationResult,
  BoardSharingService,
  BoardSharingState,
  GuestJoinResult,
  InvitationRole,
  SharingCommand,
  SharingGuestSession,
  SharingLink,
  SharingMember,
  SharingOperation,
  SharingPost,
  SharingReceipt,
  SharingRejection,
  SharingRole,
  SharingScope,
} from './contracts.js';

async function request<Input extends DescMessage, Output extends DescMessage>(
  post: SharingPost,
  method: DescMethodUnary<Input, Output>,
  input: MessageInitShape<Input>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const path = '/' + method.parent.typeName + '/' + method.name;
  const body = toBinary(method.input, create(method.input, input));
  const response = await post(path, body, signal);
  signal?.throwIfAborted();

  return fromBinary(method.output, response, { readUnknownFields: false });
}

export function createBoardSharingService(post: SharingPost): BoardSharingService {
  const methods = WireSharingService.method;

  async function getReceipt(boardId: string, commandId: string, signal?: AbortSignal) {
    const response = await request(
      post,
      methods.getBoardSharingReceipt,
      { boardId, commandId },
      signal,
    );

    return response.receipt ? readSharingReceipt(response.receipt, boardId, commandId) : undefined;
  }

  async function checkAfterDisconnect(
    command: SharingCommand,
    disconnect: unknown,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();

    try {
      return await getReceipt(command.boardId, command.commandId, signal);
    } catch (lookupFailure) {
      signal?.throwIfAborted();
      throw new AggregateError([disconnect, lookupFailure], '分享命令结果尚未确认。', {
        cause: lookupFailure,
      });
    }
  }

  async function update(command: SharingCommand, signal?: AbortSignal) {
    const { boardId, commandId } = command;
    const input = encodeSharingCommand(command);

    try {
      const response = await request(post, methods.updateBoardSharing, input, signal);

      return readSharingReceipt(response.receipt, boardId, commandId);
    } catch (disconnect) {
      const receipt = await checkAfterDisconnect(command, disconnect, signal);
      if (receipt) {
        return receipt;
      }

      throw new Error('分享命令结果尚未确认，未查到原回执。', { cause: disconnect });
    }
  }

  return {
    async getBoardSharing(boardId, signal) {
      const response = await request(post, methods.getBoardSharing, { boardId }, signal);

      return readBoardSharing(response.sharing, boardId);
    },
    updateBoardSharing: update,
    getBoardSharingReceipt: getReceipt,
    async retryBoardSharing(command, signal) {
      const receipt = await getReceipt(command.boardId, command.commandId, signal);

      return receipt ?? update(command, signal);
    },
    async inspectBoardInvitation(input, signal) {
      const response = await request(post, methods.inspectBoardInvitation, input, signal);

      return readBoardInvitation(response, input.boardId);
    },
    async joinBoardInvitation(input, signal) {
      const response = await request(post, methods.joinBoardInvitation, input, signal);

      return readGuestJoin(response, input.boardId);
    },
  };
}
