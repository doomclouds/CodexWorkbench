import {
  guestRoles,
  isSharingIdentifier,
  nextSharingVersion,
  type GuestRole,
  type ShareSettings,
  type SharingCommand,
  type SharingOperation,
  type SharingReceipt,
  type SharingRejection,
} from '../domain/index.js';
import type { SharingReader, SharingWriter } from '../ports/index.js';
import { getSettings, type SharingApplicationServices } from './access.js';

type InviteOperation = Extract<SharingOperation, { kind: 'setInvitation' | 'resetInvitation' }>;
type MemberOperation = Extract<SharingOperation, { actorId: string }>;

function rejected(command: SharingCommand, reason: SharingRejection): SharingReceipt {
  return {
    boardId: command.boardId,
    commandId: command.commandId,
    outcome: { kind: 'rejected', reason },
  };
}

function commandSignature(command: SharingCommand, services: SharingApplicationServices) {
  const value = JSON.stringify([command.expectedVersion.toString(), command.operation]);

  return services.digest(value);
}

function validIdentity({ boardId, commandId }: SharingCommand) {
  return isSharingIdentifier(boardId) && isSharingIdentifier(commandId);
}

export function previousOrRejected(
  reader: SharingReader,
  services: SharingApplicationServices,
  actorId: string,
  command: SharingCommand,
): SharingReceipt | undefined {
  const { boardId, commandId, expectedVersion } = command;
  if (!validIdentity(command)) {
    return rejected(command, 'invalidCommand');
  }
  if (!reader.ownsBoard(boardId, actorId)) {
    return rejected(command, 'forbidden');
  }

  const prior = reader.getReceipt(boardId, actorId, commandId);
  if (prior) {
    return prior.signature === commandSignature(command, services)
      ? prior.receipt
      : rejected(command, 'commandIdReuse');
  }

  return getSettings(reader, boardId).version === expectedVersion
    ? undefined
    : rejected(command, 'versionChanged');
}

function rotateInvitation(
  writer: SharingWriter,
  services: SharingApplicationServices,
  boardId: string,
  version: bigint,
  role: GuestRole,
) {
  const enabled = writer.getInvitation(boardId, role)?.enabled ?? true;
  writer.saveInvitation(boardId, { role, enabled, version, seed: services.newInvitationSeed() });
}

function updateInvitations(
  writer: SharingWriter,
  services: SharingApplicationServices,
  command: SharingCommand,
  version: bigint,
  operation: InviteOperation,
): SharingRejection | undefined {
  const { boardId } = command;
  if (operation.kind === 'resetInvitation') {
    const roles = operation.role === undefined ? guestRoles : [operation.role];

    for (const role of roles) {
      rotateInvitation(writer, services, boardId, version, role);
    }

    return;
  }

  const invitation = writer.getInvitation(boardId, operation.role);
  if (!invitation) {
    return 'roleDisabled';
  }

  writer.saveInvitation(boardId, { ...invitation, enabled: operation.enabled });
}

function updateMember(
  writer: SharingWriter,
  boardId: string,
  operation: MemberOperation,
): SharingRejection | undefined {
  const member = writer.getMember(boardId, operation.actorId);
  if (!member) {
    return 'memberUnavailable';
  }

  if (operation.kind === 'forgetMember') {
    if (!member.removed) {
      return 'memberUnavailable';
    }

    writer.deleteMember(boardId, member.actorId);

    return;
  }
  if (operation.kind === 'removeMember') {
    if (member.removed) {
      return 'memberUnavailable';
    }

    writer.saveMember(boardId, { ...member, removed: true });

    return;
  }
  if (!('role' in operation) || member.removed !== (operation.kind === 'restoreMember')) {
    return 'memberUnavailable';
  }

  const invitation = writer.getInvitation(boardId, operation.role);
  if (!invitation?.enabled) {
    return 'roleDisabled';
  }

  writer.saveMember(boardId, {
    ...member,
    removed: false,
    role: operation.role,
    invitationVersion: invitation.version,
  });
}

function startSharing(
  writer: SharingWriter,
  services: SharingApplicationServices,
  boardId: string,
  current: ShareSettings,
  next: ShareSettings,
) {
  writer.saveSettings(boardId, next);
  if (!current.enabled) {
    for (const role of guestRoles) {
      rotateInvitation(writer, services, boardId, next.version, role);
    }
  }
}

function perform(
  writer: SharingWriter,
  services: SharingApplicationServices,
  command: SharingCommand,
  current: ShareSettings,
  version: bigint,
): SharingRejection | undefined {
  const { boardId, operation } = command;
  if (operation.kind === 'setScope') {
    if (!services.inviteOrigin(operation.scope)) {
      return 'lanUnavailable';
    }

    startSharing(writer, services, boardId, current, {
      enabled: true,
      scope: operation.scope,
      version,
    });

    return;
  }
  if (!current.enabled) {
    return 'invalidCommand';
  }

  if (operation.kind === 'stop') {
    writer.saveSettings(boardId, { enabled: false, scope: 'local', version });

    return;
  }

  const problem =
    operation.kind === 'setInvitation' || operation.kind === 'resetInvitation'
      ? updateInvitations(writer, services, command, version, operation)
      : updateMember(writer, boardId, operation);

  if (problem) {
    return problem;
  }

  writer.saveSettings(boardId, { ...current, version });
}

export function applySharing(
  writer: SharingWriter,
  services: SharingApplicationServices,
  actorId: string,
  command: SharingCommand,
): SharingReceipt {
  const prior = previousOrRejected(writer, services, actorId, command);
  if (prior) {
    return prior;
  }

  const { boardId, commandId } = command;
  const current = getSettings(writer, boardId);
  const version = nextSharingVersion(current.version);
  if (version === undefined) {
    return rejected(command, 'invalidCommand');
  }

  const problem = perform(writer, services, command, current, version);
  if (problem) {
    return rejected(command, problem);
  }

  const receipt: SharingReceipt = { boardId, commandId, outcome: { kind: 'applied', version } };
  writer.saveReceipt(actorId, { signature: commandSignature(command, services), receipt });

  return receipt;
}
