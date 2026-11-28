import {
  freezeFeedbackAnchor,
  freezeFeedbackSelection,
  validFeedbackContentUnit,
} from '../domain/index.js';
import type {
  FeedbackActor,
  FeedbackAnchorTarget,
  FeedbackApplied,
  FeedbackBoardAccess,
  FeedbackMessage,
  FeedbackOperation,
  FeedbackOutcome,
  FeedbackReceipt,
  FeedbackThread,
} from '../domain/index.js';
import type { FeedbackRepository, FeedbackWriter } from '../ports/index.js';
import { canDeleteThread, requireWriteAccess } from './access.js';
import { applyAttachment } from './attachments.js';

const maximumTextLength = 16_000;

type CreateOperation = Extract<FeedbackOperation, { readonly kind: 'create' }>;
type ReplyOperation = Extract<FeedbackOperation, { readonly kind: 'reply' }>;
type EditOperation = Extract<FeedbackOperation, { readonly kind: 'edit' }>;
type ThreadOperation = Extract<
  FeedbackOperation,
  { readonly kind: 'resolve' | 'reopen' | 'delete' }
>;

export interface FeedbackServices {
  readonly now: () => number;
  readonly digest: (value: string) => string;
  readonly ownerDisplayName?: string;
  readonly onChanged?: (boardId: string) => void;
}

interface CommandContext {
  readonly writer: FeedbackWriter;
  readonly actor: FeedbackActor;
  readonly access: FeedbackBoardAccess;
  readonly boardId: string;
  readonly commandId: string;
  readonly now: () => number;
  readonly authorName?: string;
}

export interface FeedbackCommand {
  readonly boardId: string;
  readonly commandId: string;
  readonly operation: FeedbackOperation;
}

function normalizedText(text: string): string {
  const content = text.trim();
  const validLength = content.length <= maximumTextLength;

  return validLength && !content.includes('\0') ? content : '';
}

function timestamp(now: () => number, previous = 0n): bigint {
  const current = now();
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new Error('Feedback clock returned an invalid timestamp.');
  }

  const millis = BigInt(current);

  return millis > previous ? millis : previous;
}

function anchorSignature(target: FeedbackAnchorTarget): readonly unknown[] {
  if (target.kind === 'board') {
    return [target.kind, String(target.point.x), String(target.point.y)];
  }

  if (target.kind === 'selection') {
    const { point, bounds, objects, expectedBoardRevision } = target;

    return [
      target.kind,
      point,
      bounds,
      expectedBoardRevision.toString(),
      objects.map(({ objectId, geometryVersion, payloadVersion }) => [
        objectId,
        geometryVersion.toString(),
        payloadVersion?.toString(),
      ]),
    ];
  }

  if (target.kind === 'content') {
    const unit = target.content;
    const value =
      unit.kind === 'html' ? { ...unit, sourceRevision: unit.sourceRevision.toString() } : unit;

    return [
      target.kind,
      target.objectId,
      String(target.u),
      String(target.v),
      target.geometryVersion.toString(),
      target.payloadVersion.toString(),
      value,
    ];
  }

  return [
    target.kind,
    target.objectId,
    String(target.u),
    String(target.v),
    target.geometryVersion.toString(),
  ];
}

function commandSignature(operation: FeedbackOperation): string {
  switch (operation.kind) {
    case 'create':
      return JSON.stringify([
        operation.kind,
        anchorSignature(operation.anchor),
        operation.text.trim(),
      ]);
    case 'reply':
      return JSON.stringify([operation.kind, operation.threadId, operation.text.trim()]);
    case 'edit':
      return JSON.stringify([
        operation.kind,
        operation.threadId,
        operation.messageId,
        operation.expectedMessageVersion.toString(),
        operation.text.trim(),
      ]);
    case 'resolve':
    case 'reopen':
    case 'delete':
    case 'requestAttachment':
      return JSON.stringify([
        operation.kind,
        operation.threadId,
        operation.expectedThreadVersion.toString(),
      ]);
    case 'claimAttachment':
    case 'resetAttachmentClaim':
      return JSON.stringify([operation.kind, operation.threadId, operation.requestId]);
    case 'confirmAttachment':
      return JSON.stringify([
        operation.kind,
        operation.threadId,
        operation.requestId,
        operation.claimId,
      ]);
  }
}

function makeMessage(
  context: CommandContext,
  messageId: string,
  text: string,
  updatedAtMillis: bigint,
): FeedbackMessage {
  return {
    messageId,
    authorActorId: context.actor.id,
    authorName: context.authorName,
    text,
    version: 1n,
    createdAtMillis: updatedAtMillis,
    updatedAtMillis,
  };
}

function applied(thread: FeedbackThread, message?: FeedbackMessage): FeedbackApplied {
  return {
    kind: 'applied',
    threadId: thread.threadId,
    threadVersion: thread.version,
    messageId: message?.messageId,
    messageVersion: message?.version,
    deleted: false,
  };
}

function freezeThreadAnchor({ writer, boardId }: CommandContext, target: FeedbackAnchorTarget) {
  const revision = writer.getBoardRevision(boardId);
  if (target.kind === 'selection') {
    const objects =
      target.objects.length <= 120
        ? target.objects.map(({ objectId }) => writer.getObject(boardId, objectId))
        : [];

    return freezeFeedbackSelection(revision, target, objects);
  }
  if (target.kind === 'content' && !validFeedbackContentUnit(target.content)) {
    return { kind: 'rejected', reason: 'invalidAnchor' } as const;
  }

  const object = target.kind === 'board' ? undefined : writer.getObject(boardId, target.objectId);
  const content =
    target.kind === 'content' && object ? writer.getContentSource(boardId, target) : undefined;

  return freezeFeedbackAnchor(revision, target, object, content);
}

function createThread(context: CommandContext, operation: CreateOperation): FeedbackOutcome {
  const text = normalizedText(operation.text);
  if (!text) {
    return { kind: 'rejected', reason: 'invalidText' };
  }

  const { writer, boardId, now } = context;
  const anchor = freezeThreadAnchor(context, operation.anchor);
  if ('kind' in anchor) {
    return anchor;
  }

  const threadId = writer.allocateId();
  const updatedAtMillis = timestamp(now);
  const first = makeMessage(context, threadId, text, updatedAtMillis);

  const thread: FeedbackThread = {
    threadId,
    anchor,
    status: 'open',
    first,
    updatedAtMillis,
    version: 1n,
    replyCount: 0,
  };
  writer.insertThread(boardId, thread);

  return applied(thread, first);
}

function replyToThread(
  context: CommandContext,
  thread: FeedbackThread,
  operation: ReplyOperation,
): FeedbackOutcome {
  const text = normalizedText(operation.text);
  if (!text) {
    return { kind: 'rejected', reason: 'invalidText' };
  }

  const { writer, boardId, now } = context;
  const updatedAtMillis = timestamp(now, thread.updatedAtMillis);
  const reply = makeMessage(context, writer.allocateId(), text, updatedAtMillis);
  const updated: FeedbackThread = {
    ...thread,
    status: 'open',
    updatedAtMillis,
    version: thread.version + 1n,
    replyCount: thread.replyCount + 1,
  };
  writer.insertReply(boardId, thread.threadId, updated.replyCount, reply);
  writer.updateThread(boardId, updated);

  return applied(updated, reply);
}

function editMessage(
  context: CommandContext,
  thread: FeedbackThread,
  operation: EditOperation,
): FeedbackOutcome {
  const { actor, writer, boardId, now } = context;
  const previous = writer.getMessage(boardId, thread.threadId, operation.messageId);
  if (!previous) {
    return { kind: 'rejected', reason: 'notFound' };
  }
  if (previous.authorActorId !== actor.id) {
    return { kind: 'rejected', reason: 'forbidden' };
  }
  if (previous.version !== operation.expectedMessageVersion) {
    return { kind: 'rejected', reason: 'versionChanged', currentVersion: previous.version };
  }

  const text = normalizedText(operation.text);
  if (!text) {
    return { kind: 'rejected', reason: 'invalidText' };
  }
  if (text === previous.text) {
    return applied(thread, previous);
  }

  const updatedAtMillis = timestamp(now, thread.updatedAtMillis);
  const message = { ...previous, text, updatedAtMillis, version: previous.version + 1n };
  const updated = { ...thread, updatedAtMillis, version: thread.version + 1n };
  writer.updateMessage(boardId, thread.threadId, message);
  writer.updateThread(boardId, updated);

  return applied(updated, message);
}

function changeThread(
  context: CommandContext,
  thread: FeedbackThread,
  operation: ThreadOperation,
): FeedbackOutcome {
  const { actor, access, writer, boardId, now } = context;
  if (operation.kind === 'delete' && !canDeleteThread(actor, access, thread)) {
    return { kind: 'rejected', reason: 'forbidden' };
  }
  if (thread.version !== operation.expectedThreadVersion) {
    return { kind: 'rejected', reason: 'versionChanged', currentVersion: thread.version };
  }

  if (operation.kind === 'delete') {
    writer.deleteThread(boardId, thread.threadId);

    return { ...applied(thread), deleted: true };
  }

  const status = operation.kind === 'resolve' ? 'resolved' : 'open';
  if (thread.status === status) {
    return applied(thread);
  }

  const updated: FeedbackThread = {
    ...thread,
    status,
    updatedAtMillis: timestamp(now, thread.updatedAtMillis),
    version: thread.version + 1n,
  };
  writer.updateThread(boardId, updated);

  return applied(updated);
}

function executeCommand(context: CommandContext, operation: FeedbackOperation): FeedbackOutcome {
  if (operation.kind === 'create') {
    return createThread(context, operation);
  }

  const thread = context.writer.getThread(context.boardId, operation.threadId);
  if (!thread) {
    return { kind: 'rejected', reason: 'notFound' };
  }

  switch (operation.kind) {
    case 'reply':
      return replyToThread(context, thread, operation);
    case 'edit':
      return editMessage(context, thread, operation);
    case 'delete':
    case 'resolve':
    case 'reopen':
      return changeThread(context, thread, operation);
    case 'requestAttachment':
    case 'claimAttachment':
    case 'confirmAttachment':
    case 'resetAttachmentClaim':
      return applyAttachment(
        context.writer,
        context.actor,
        context.access.isOwner,
        context.boardId,
        thread,
        operation,
        context.commandId,
        timestamp(context.now),
      );
  }
}

export function applyFeedback(
  repository: FeedbackRepository,
  services: FeedbackServices,
  actor: FeedbackActor,
  command: FeedbackCommand,
): FeedbackReceipt {
  const { boardId, commandId, operation } = command;

  let changed = false;
  const receipt = repository.write((writer): FeedbackReceipt => {
    const access = requireWriteAccess(writer, actor, boardId);
    const signature = services.digest(commandSignature(operation));
    const previous = writer.getReceipt(boardId, actor.id, commandId);
    if (previous) {
      if (previous.signature === signature) {
        return previous.receipt;
      }

      return { boardId, commandId, outcome: { kind: 'rejected', reason: 'commandIdReuse' } };
    }

    const principalName = access.isOwner ? services.ownerDisplayName : access.name;
    const authorName = actor.kind === 'agent' ? 'Codex · ' + actor.id.slice(-8) : principalName;
    const outcome = executeCommand(
      {
        writer,
        actor,
        access,
        boardId,
        commandId,
        now: services.now,
        authorName,
      },
      operation,
    );
    const receipt = { boardId, commandId, outcome };
    writer.saveReceipt(actor.id, { signature, receipt });
    changed = outcome.kind === 'applied';

    return receipt;
  });

  if (changed) {
    services.onChanged?.(boardId);
  }

  return receipt;
}
