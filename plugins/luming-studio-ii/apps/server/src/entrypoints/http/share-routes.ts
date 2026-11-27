import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardSharingService,
  SharingRejectionReason,
  SharingRole as WireRole,
  SharingScope as WireScope,
  type BoardSharingSchema,
  type SharingCommandReceiptSchema,
  type UpdateBoardSharingRequest,
} from '@codexworkbench/luming-studio-ii-contracts/sharing/service';
import type {
  BoardSharing,
  GuestRole,
  SharingApplication,
  SharingCommand,
  SharingOperation,
  SharingReceipt,
  SharingRejection,
  SharingRole,
  SharingScope,
} from '../../modules/sharing/application/index.js';
import { HttpRequestError, requireId } from './request.js';
import { asyncUnaryRoute, unaryRoute, type RouteEntry } from './unary-route.js';

export interface SharingRoutesOptions {
  readonly application: SharingApplication;
  readonly activateScope?: (scope: SharingScope) => Promise<void>;
  readonly newBrowserToken: () => string;
  readonly onActivationError: (error: unknown) => void;
  readonly onAccessChanged?: (boardId: string) => void;
}

export const wireRoles: Readonly<Record<SharingRole, WireRole>> = {
  owner: WireRole.OWNER,
  editor: WireRole.EDITOR,
  commenter: WireRole.COMMENTER,
  viewer: WireRole.VIEWER,
};

export const wireRejection: Readonly<Record<SharingRejection, SharingRejectionReason>> = {
  forbidden: SharingRejectionReason.FORBIDDEN,
  versionChanged: SharingRejectionReason.VERSION_CHANGED,
  commandIdReuse: SharingRejectionReason.COMMAND_ID_REUSE,
  invalidCommand: SharingRejectionReason.INVALID_COMMAND,
  lanUnavailable: SharingRejectionReason.LAN_UNAVAILABLE,
  invitationUnavailable: SharingRejectionReason.INVITATION_UNAVAILABLE,
  nameTaken: SharingRejectionReason.NAME_TAKEN,
  memberUnavailable: SharingRejectionReason.MEMBER_UNAVAILABLE,
  roleDisabled: SharingRejectionReason.ROLE_DISABLED,
};

function scope(value: WireScope): SharingScope {
  if (value === WireScope.LOCAL) {
    return 'local';
  }
  if (value === WireScope.LAN) {
    return 'lan';
  }

  throw new HttpRequestError(400, 'Invalid sharing scope.');
}

function guestRole(value: WireRole): GuestRole {
  switch (value) {
    case WireRole.EDITOR:
      return 'editor';
    case WireRole.COMMENTER:
      return 'commenter';
    case WireRole.VIEWER:
      return 'viewer';
    case WireRole.UNSPECIFIED:
    case WireRole.OWNER:
      throw new HttpRequestError(400, 'Invalid invitation role.');
  }

  throw new HttpRequestError(400, 'Invalid invitation role.');
}

function readOperation(operation: UpdateBoardSharingRequest['operation']): SharingOperation {
  switch (operation.case) {
    case 'setScope':
      return { kind: operation.case, scope: scope(operation.value.scope) };
    case 'stop':
      return { kind: operation.case };
    case 'setInvitation':
      return {
        kind: operation.case,
        role: guestRole(operation.value.role),
        enabled: operation.value.enabled,
      };
    case 'resetInvitation':
      return {
        kind: operation.case,
        role:
          operation.value.role === WireRole.UNSPECIFIED
            ? undefined
            : guestRole(operation.value.role),
      };
    case 'changeMemberRole':
    case 'restoreMember':
      return {
        kind: operation.case,
        actorId: requireId(operation.value.actorId),
        role: guestRole(operation.value.role),
      };
    case 'removeMember':
    case 'forgetMember':
      return { kind: operation.case, actorId: requireId(operation.value.actorId) };
    case undefined:
      throw new HttpRequestError(400, 'A sharing operation is required.');
  }
}

function readCommand(request: UpdateBoardSharingRequest): SharingCommand {
  const { boardId, commandId, expectedVersion, operation } = request;
  if (expectedVersion === undefined) {
    throw new HttpRequestError(400, 'The expected sharing version is required.');
  }

  return {
    boardId: requireId(boardId),
    commandId: requireId(commandId),
    expectedVersion,
    operation: readOperation(operation),
  };
}

function writeSharing(sharing: BoardSharing): MessageInitShape<typeof BoardSharingSchema> {
  return {
    ...sharing,
    scope: sharing.scope === 'local' ? WireScope.LOCAL : WireScope.LAN,
    role: wireRoles[sharing.role],
    links: sharing.links.map((link) => ({ ...link, role: wireRoles[link.role] })),
    members: sharing.members.map((member) => ({ ...member, role: wireRoles[member.role] })),
  };
}

function writeReceipt({
  boardId,
  commandId,
  outcome,
}: SharingReceipt): MessageInitShape<typeof SharingCommandReceiptSchema> {
  return {
    boardId,
    commandId,
    outcome:
      outcome.kind === 'applied'
        ? { case: 'applied', value: { version: outcome.version } }
        : { case: 'rejected', value: { reason: wireRejection[outcome.reason] } },
  };
}

async function update(options: SharingRoutesOptions, actorId: string, command: SharingCommand) {
  const { application, activateScope } = options;
  const checked = application.prepareUpdate(actorId, command);
  if (checked) {
    return writeReceipt(checked);
  }

  if (command.operation.kind === 'setScope' && activateScope) {
    try {
      await activateScope(command.operation.scope);
    } catch (error) {
      options.onActivationError(error);

      return writeReceipt({
        boardId: command.boardId,
        commandId: command.commandId,
        outcome: { kind: 'rejected', reason: 'lanUnavailable' },
      });
    }
  }

  const receipt = application.update(actorId, command);
  if (receipt.outcome.kind === 'applied') {
    options.onAccessChanged?.(command.boardId);
  }

  return writeReceipt(receipt);
}

export function createSharingRoutes(options: SharingRoutesOptions): readonly RouteEntry[] {
  const { application } = options;
  const { getBoardSharing, updateBoardSharing, getBoardSharingReceipt } =
    BoardSharingService.method;

  return [
    unaryRoute(getBoardSharing, (actor, { boardId }) => ({
      sharing: writeSharing(application.getSharing(requireId(boardId), actor.id, actor.guestScope)),
    })),
    asyncUnaryRoute(updateBoardSharing, async (actor, request) => ({
      receipt: await update(options, actor.id, readCommand(request)),
    })),
    unaryRoute(getBoardSharingReceipt, (actor, { boardId, commandId }) => {
      const receipt = application.getReceipt(requireId(boardId), actor.id, requireId(commandId));

      return { receipt: receipt && writeReceipt(receipt) };
    }),
  ];
}
