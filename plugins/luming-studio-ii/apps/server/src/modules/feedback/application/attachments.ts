import type {
  FeedbackActor,
  FeedbackAttachment,
  FeedbackAttachmentOperation,
  FeedbackOutcome,
  FeedbackThread,
} from '../domain/index.js';
import type { FeedbackWriter } from '../ports/index.js';

const claimRecoveryDelay = 120_000n;

export function applyAttachment(
  writer: FeedbackWriter,
  actor: FeedbackActor,
  owner: boolean,
  boardId: string,
  thread: FeedbackThread,
  operation: FeedbackAttachmentOperation,
  commandId: string,
  now: bigint,
): FeedbackOutcome {
  const current = thread.attachment;
  const applied = {
    kind: 'applied',
    threadId: thread.threadId,
    threadVersion: thread.version,
    deleted: false,
  } as const;

  function store(attachment: FeedbackAttachment) {
    writer.updateThread(boardId, { ...thread, attachment });

    return applied;
  }

  if (actor.kind === 'agent') {
    return { kind: 'rejected', reason: 'forbidden' };
  }

  if (operation.kind === 'requestAttachment') {
    if (operation.expectedThreadVersion !== thread.version) {
      return { kind: 'rejected', reason: 'versionChanged', currentVersion: thread.version };
    }
    if (current?.threadVersion === thread.version) {
      return applied;
    }
    if (current?.state === 'claimed') {
      return { kind: 'rejected', reason: 'attachmentClaimed' };
    }

    return store({
      requestId: writer.allocateId(),
      state: 'pending',
      threadVersion: thread.version,
    });
  }
  if (!owner) {
    return { kind: 'rejected', reason: 'forbidden' };
  }
  if (!current || current.requestId !== operation.requestId) {
    return { kind: 'rejected', reason: 'notFound' };
  }

  if (operation.kind === 'claimAttachment') {
    if (current.state !== 'pending') {
      return { kind: 'rejected', reason: 'attachmentClaimed' };
    }
    if (current.threadVersion !== thread.version) {
      return { kind: 'rejected', reason: 'versionChanged', currentVersion: thread.version };
    }

    return store({ ...current, state: 'claimed', claimId: commandId, claimedAtMillis: now });
  }
  if (operation.kind === 'resetAttachmentClaim') {
    const abandoned =
      current.state === 'claimed' &&
      (current.claimedAtMillis === undefined ||
        now - current.claimedAtMillis >= claimRecoveryDelay);

    return abandoned
      ? store({ requestId: writer.allocateId(), state: 'pending', threadVersion: thread.version })
      : { kind: 'rejected', reason: 'attachmentClaimed' };
  }
  if (current.state !== 'claimed' || current.claimId !== operation.claimId) {
    return { kind: 'rejected', reason: 'attachmentClaimed' };
  }

  return store({ ...current, state: 'attached', claimId: undefined, claimedAtMillis: undefined });
}
