import type {
  FeedbackActor,
  FeedbackBoardAccess,
  FeedbackMessage,
  FeedbackMessageView,
  FeedbackThread,
  FeedbackThreadView,
} from '../domain/index.js';
import type { FeedbackReader } from '../ports/index.js';
import { FeedbackAccessError } from './errors.js';

export function permitsFeedback(access: FeedbackBoardAccess) {
  return access.canComment ?? access.canEdit;
}

export function requireAccess(
  reader: FeedbackReader,
  actor: FeedbackActor,
  boardId: string,
): FeedbackBoardAccess {
  const access = reader.getAccess(boardId, actor.id);
  if (!access) {
    throw new FeedbackAccessError();
  }

  return access;
}

export function requireWriteAccess(
  reader: FeedbackReader,
  actor: FeedbackActor,
  boardId: string,
): FeedbackBoardAccess {
  const access = requireAccess(reader, actor, boardId);
  if (!permitsFeedback(access)) {
    throw new FeedbackAccessError();
  }

  return access;
}

export function canDeleteThread(
  actor: FeedbackActor,
  access: FeedbackBoardAccess,
  thread: FeedbackThread,
): boolean {
  return permitsFeedback(access) && (access.isOwner || thread.first.authorActorId === actor.id);
}

export function viewMessage(
  actor: FeedbackActor,
  access: FeedbackBoardAccess,
  message: FeedbackMessage,
  legacyNames?: (authorId: string) => string | undefined,
): FeedbackMessageView {
  const authoredByViewer = message.authorActorId === actor.id;

  return {
    ...message,
    authorName: message.authorName ?? legacyNames?.(message.authorActorId),
    authoredByViewer,
    canEdit: permitsFeedback(access) && authoredByViewer,
  };
}

export function viewThread(
  actor: FeedbackActor,
  access: FeedbackBoardAccess,
  thread: FeedbackThread,
  legacyNames?: (authorId: string) => string | undefined,
): FeedbackThreadView {
  return {
    ...thread,
    first: viewMessage(actor, access, thread.first, legacyNames),
    canResolve: permitsFeedback(access),
    canDelete: canDeleteThread(actor, access, thread),
  };
}
