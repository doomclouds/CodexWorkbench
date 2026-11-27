import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  SharingRole as WireRole,
  SharingScope as WireScope,
  type UpdateBoardSharingRequestSchema,
} from '@codexworkbench/luming-studio-ii-contracts/sharing/service';

import type {
  InvitationRole,
  SharingCommand,
  SharingOperation,
  SharingScope,
} from './contracts.js';

const roles: Readonly<Record<InvitationRole, WireRole>> = {
  editor: WireRole.EDITOR,
  commenter: WireRole.COMMENTER,
  viewer: WireRole.VIEWER,
};

const scopes: Readonly<Record<SharingScope, WireScope>> = {
  local: WireScope.LOCAL,
  lan: WireScope.LAN,
};

type SharingOperationInit = MessageInitShape<typeof UpdateBoardSharingRequestSchema>['operation'];

function encodeOperation(operation: SharingOperation): SharingOperationInit {
  switch (operation.kind) {
    case 'setScope':
      return { case: 'setScope', value: { scope: scopes[operation.scope] } };
    case 'stop':
      return { case: 'stop', value: {} };
    case 'setInvitation':
      return {
        case: 'setInvitation',
        value: { role: roles[operation.role], enabled: operation.enabled },
      };
    case 'resetInvitation':
      return { case: 'resetInvitation', value: { role: roles[operation.role] } };
    case 'changeMemberRole':
    case 'restoreMember':
      return {
        case: operation.kind,
        value: { actorId: operation.actorId, role: roles[operation.role] },
      };
    case 'removeMember':
    case 'forgetMember':
      return { case: operation.kind, value: { actorId: operation.actorId } };
  }
}

export function encodeSharingCommand(command: SharingCommand) {
  const { boardId, commandId, expectedVersion, operation } = command;

  return { boardId, commandId, expectedVersion, operation: encodeOperation(operation) };
}
