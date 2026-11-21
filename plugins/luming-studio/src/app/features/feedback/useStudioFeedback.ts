import { useCallback, useEffect, useRef, useState, type SubmitEvent } from 'react';
import {
  STUDIO_TOOLS,
  type Actor,
  type Anchor,
  type Feedback,
  type StudioClient,
} from '../../../contracts/studio';
import type { ProposalOperation } from '../../../contracts/proposals';
import type { ProductAnnotation, StudioDocument } from '../../product-contract';
import { isAttachmentPending } from '../../shared/comments/attachment';
import type { CommentAction, CommentActionArguments } from '../../shared/comments/comment-action';
import { describeCommentTarget, type CommentPoint } from '../../shared/comments/comment-target';
import { newClientId } from '../../shared/client-id';
import type { StudioViewRequests, StudioViewScope } from '../../shared/studio-view-scope';

export interface CommentSelection {
  id: string;
  point?: CommentPoint;
  inList?: boolean;
}

interface StudioFeedbackOptions {
  activeId: string;
  actor: Actor;
  busy: string;
  canComment: boolean;
  canManage: boolean;
  client: StudioClient;
  historyPreview: boolean;
  panelOpen: boolean;
  readingDocument: boolean;
  scope: StudioViewRequests;
  isMounted: () => boolean;
  attachContext?: (feedback: Feedback, board: StudioDocument) => Promise<void>;
  closePanel: () => void;
  closeHistoryPreview: () => void;
  describeError: (cause: unknown) => string;
  feedbackChanged: () => void;
  getDocument: () => StudioDocument | null;
  inform: (message: string) => void;
  locateAnchor: (anchor: Anchor) => { x: number; y: number } | undefined;
  refreshFeedback: () => void;
  reportError: (cause: unknown) => void;
  setBusy: (busy: string) => void;
  setError: (message: string) => void;
  stopFollowing: () => void;
}

function attachmentResult(attached: boolean, owner: boolean, queuedMessage: string): string {
  if (attached) {
    return '已附加到对话。';
  }
  if (owner) {
    return '请求已保留，请从 Codex 打开白板后附加到对话。';
  }

  return queuedMessage;
}

function useAttachmentNotice(
  activeId: string,
  feedback: Feedback[],
  actor: Actor,
  panelOpen: boolean,
) {
  const [attachmentNoticeId, setAttachmentNoticeId] = useState('');
  const canReceiveAttachments = actor.role === 'owner' && actor.kind === 'human';
  const pendingAttachments = canReceiveAttachments
    ? feedback.filter((item) => item.artifactId === activeId && isAttachmentPending(item))
    : [];
  const [attachmentInput, setAttachmentInput] = useState({
    activeId,
    feedback,
    canReceiveAttachments,
    actorId: actor.id,
    requests: new Set<string>(),
  });
  const inputChanged =
    attachmentInput.activeId !== activeId || attachmentInput.feedback !== feedback;
  const authorityChanged =
    attachmentInput.canReceiveAttachments !== canReceiveAttachments ||
    attachmentInput.actorId !== actor.id;

  if (inputChanged || authorityChanged) {
    const sameArtifact = attachmentInput.activeId === activeId;
    const requests = sameArtifact ? new Set(attachmentInput.requests) : new Set<string>();
    let nextNotice = sameArtifact ? attachmentNoticeId : '';
    for (const item of pendingAttachments) {
      const key = `${item.id}:${item.attachment?.requestId || 'legacy'}`;
      if (requests.has(key)) {
        continue;
      }

      requests.add(key);
      const requester = item.attachment?.requestedBy || item.author;
      if (!panelOpen && (requester.kind !== actor.kind || requester.id !== actor.id)) {
        nextNotice = item.id;
      }
    }

    setAttachmentInput({ activeId, feedback, canReceiveAttachments, actorId: actor.id, requests });
    if (nextNotice !== attachmentNoticeId) {
      setAttachmentNoticeId(nextNotice);
    }
  }

  const attachmentNotice = pendingAttachments.find((item) => item.id === attachmentNoticeId);
  useEffect(() => {
    if (!attachmentNoticeId) {
      return;
    }

    const timer = window.setTimeout(() => setAttachmentNoticeId(''), 8000);

    return () => window.clearTimeout(timer);
  }, [attachmentNoticeId]);

  return { attachmentNotice, pendingAttachments, setAttachmentNoticeId };
}

function findActiveFeedback(
  feedback: Feedback[],
  selection: CommentSelection | null,
  panelOpen: boolean,
) {
  if (!selection || (selection.inList && !panelOpen)) {
    return undefined;
  }

  return feedback.find((item) => item.id === selection.id);
}

export function useStudioFeedback({
  activeId,
  actor,
  busy,
  canComment,
  canManage,
  client,
  historyPreview,
  panelOpen,
  readingDocument,
  scope,
  isMounted,
  attachContext,
  closePanel,
  closeHistoryPreview,
  describeError,
  feedbackChanged,
  getDocument,
  inform,
  locateAnchor,
  refreshFeedback,
  reportError,
  setBusy,
  setError,
  stopFollowing,
}: StudioFeedbackOptions) {
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [attachingId, setAttachingId] = useState('');
  const attachmentInFlight = useRef(false);
  const acceptedAttachments = useRef(new Set<string>());
  const [feedbackText, setFeedbackText] = useState('');
  const [annotation, setAnnotation] = useState<ProductAnnotation | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [annotationActive, setAnnotationActive] = useState(false);
  const [attachComment, setAttachComment] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [savedComment, setSavedComment] = useState<Feedback | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<CommentSelection | null>(null);
  const commentPending = useRef<{
    fingerprint: string;
    args: Record<string, unknown>;
    created?: Feedback;
  } | null>(null);
  const commentSubmitting = useRef(false);

  const [suggestionPreview, setSuggestionPreview] = useState<StudioDocument | null>(null);
  const suggestionSequence = useRef(0);

  const [replies, setReplies] = useState<Record<string, string>>({});
  const replyAttempts = useRef(new Map<string, { text: string; replyId: string }>());
  const [showResolved, setShowResolved] = useState(false);

  const { attachmentNotice, pendingAttachments, setAttachmentNoticeId } = useAttachmentNotice(
    activeId,
    feedback,
    actor,
    panelOpen,
  );
  const activeFeedback = findActiveFeedback(feedback, selectedFeedback, panelOpen);

  const changeAnnotationMode = useCallback(
    (active: boolean) => {
      const next = active && canComment && !historyPreview && !suggestionPreview;
      setAnnotationActive(next);
      if (next) {
        closePanel();
        if (annotation && feedbackText.trim()) {
          setCommentOpen(true);
        }
      } else {
        setCommentOpen(false);
        setSelectedFeedback(null);
      }
    },
    [canComment, historyPreview, suggestionPreview, annotation, feedbackText, closePanel],
  );

  const acceptFeedback = useCallback(
    (next: Feedback[], changedId: string) => {
      feedbackChanged();

      setFeedback((previous) => {
        const changed = next.find((item) => item.id === changedId);
        const current = previous.find((item) => item.id === changedId);
        if (!changed) {
          return previous.filter((item) => item.id !== changedId);
        }
        if (!current) {
          return [...previous, changed];
        }
        if (current.updatedAt > changed.updatedAt) {
          return previous;
        }

        return previous.map((item) => (item.id === changedId ? changed : item));
      });
      refreshFeedback();
    },
    [feedbackChanged, refreshFeedback],
  );

  function resetComment() {
    setAnnotation(null);
    setCommentOpen(false);
    setFeedbackText('');
    setAttachComment(false);
    setCommentError('');
    setSavedComment(null);
    setSelectedFeedback(null);
    commentPending.current = null;
  }

  function annotate(selection: ProductAnnotation) {
    if (!canComment || historyPreview || suggestionPreview) {
      return;
    }

    closePanel();
    setSelectedFeedback(null);
    if (savedComment) {
      setCommentOpen(true);
      inform('当前备注已保存，请先完成附加。');

      return;
    }
    if (annotation && feedbackText.trim()) {
      setCommentOpen(true);
      inform('已有未发送的备注草稿，请先完成或清空当前备注，再选择新目标。');

      return;
    }

    const current = getDocument();
    setAnnotation({
      ...selection,
      label: current
        ? describeCommentTarget(current, selection.anchor, selection.label)
        : selection.label,
    });
    setCommentOpen(true);
    setCommentError('');
    commentPending.current = null;
  }

  function selectFeedback(item: Feedback, point?: { x: number; y: number }, inList = false) {
    if (readingDocument && item.anchor.pin?.coordinateSpace === 'board') {
      inform('这条备注位于画板。返回画板后可查看。');

      return;
    }

    suggestionSequence.current += 1;
    closeHistoryPreview();
    setSuggestionPreview(null);
    stopFollowing();
    setCommentOpen(false);
    setAnnotationActive(true);
    setSelectedFeedback({ id: item.id, point: point || locateAnchor(item.anchor), inList });
    if (!inList) {
      closePanel();
    }
  }

  function changeReplyText(id: string, text: string) {
    setReplies((previous) => ({ ...previous, [id]: text }));
  }

  async function deliverFeedback(item: Feedback, current: StudioDocument): Promise<boolean> {
    const request = scope.capture();
    const isCurrent = () => scope.isCurrent(request) && request.artifactId === item.artifactId;
    const result = await client.call<{ feedback: Feedback[] }>(STUDIO_TOOLS.feedback, {
      action: 'send',
      artifactId: item.artifactId,
      feedbackId: item.id,
      targetViewId: request.viewId,
    });
    const requested = result.feedback.find((entry) => entry.id === item.id);
    if (!requested?.attachment) {
      throw new Error('未取得附加请求，请重试。');
    }

    if (isCurrent()) {
      acceptFeedback(result.feedback, item.id);
    }
    if (requested.attachment.state === 'attached') {
      return true;
    }
    if (!attachContext || !canManage || actor.kind !== 'human') {
      return false;
    }

    const requestId = requested.attachment.requestId;
    const key = JSON.stringify([item.artifactId, item.id, requestId]);
    if (!acceptedAttachments.current.has(key)) {
      if (!isCurrent()) {
        return false;
      }

      setAttachingId(item.id);
      await attachContext(requested, current);

      acceptedAttachments.current.add(key);
    }
    if (isCurrent()) {
      setAttachingId(item.id);
    }

    try {
      const receipt = await client.call<{ feedback: Feedback[] }>(STUDIO_TOOLS.feedback, {
        action: 'attached',
        artifactId: item.artifactId,
        feedbackId: item.id,
        requestId,
      });
      const attached = receipt.feedback.find((entry) => entry.id === item.id);
      if (
        attached?.attachment?.requestId !== requestId ||
        attached.attachment.state !== 'attached'
      ) {
        throw new Error('未收到状态确认。');
      }

      acceptedAttachments.current.delete(key);
      if (isCurrent()) {
        acceptFeedback(receipt.feedback, item.id);
      }
    } catch (cause) {
      throw new Error(
        `已附加到对话，状态尚未保存。请重试补记状态，本页面不会重复附加。${describeError(cause)}`,
        { cause },
      );
    }

    return true;
  }

  function feedbackWritePending() {
    return busy || commentSubmitting.current || attachmentInFlight.current;
  }

  async function persistComment(
    pending: NonNullable<typeof commentPending.current>,
    request: StudioViewScope,
  ): Promise<Feedback> {
    if (pending.created) {
      return pending.created;
    }

    const result = await client.call<{ feedback: Feedback[]; contextId?: string }>(
      STUDIO_TOOLS.feedback,
      pending.args,
    );
    const created = result.feedback.find((item) => item.id === result.contextId);
    if (!created) {
      throw new Error('备注已提交，但未取得保存结果，请重试。');
    }

    pending.created = created;
    if (scope.isCurrent(request)) {
      acceptFeedback(result.feedback, created.id);
      setSavedComment(created);
    }

    return created;
  }

  async function createFeedback(event: SubmitEvent) {
    event.preventDefault();
    const current = getDocument();
    const text = feedbackText.trim();
    if (!current || !annotation || feedbackWritePending()) {
      return;
    }
    if (!text) {
      return;
    }

    const id = current.artifact.id;
    const request = scope.capture();
    const fingerprint = JSON.stringify({
      id,
      text,
      anchor: annotation.anchor,
    });

    if (commentPending.current?.fingerprint !== fingerprint) {
      commentPending.current = {
        fingerprint,
        args: {
          action: 'create',
          operationId: newClientId('comment'),
          artifactId: id,
          type: 'comment',
          text,
          anchor: annotation.anchor,
          versions: annotation.versions,
          targetViewId: request.viewId,
        },
      };
    }

    const pending = commentPending.current;
    commentSubmitting.current = true;
    setBusy('feedback');
    setCommentError('');
    try {
      const created = await persistComment(pending, request);
      if (!scope.isCurrent(request)) {
        return;
      }

      const attached = attachComment ? await deliverFeedback(created, current) : false;
      if (!scope.isCurrent(request)) {
        return;
      }

      const point = annotation.screenPoint;
      resetComment();
      if (!attachComment) {
        setSelectedFeedback({ id: created.id, point });
      }

      inform(
        attachComment
          ? attachmentResult(attached, canManage, '备注已提交，等待房主附加到对话。')
          : '备注已保存。',
      );
    } catch (cause) {
      if (scope.isCurrent(request)) {
        setCommentError(describeError(cause));
      }
    } finally {
      commentSubmitting.current = false;
      if (isMounted()) {
        setBusy('');
        setAttachingId('');
      }
    }
  }

  async function feedbackAction(
    action: CommentAction,
    item: Feedback,
    args: CommentActionArguments = {},
  ): Promise<Feedback | null> {
    if (busy) {
      throw new Error('正在处理上一项操作，请稍候。');
    }

    const request = scope.capture();
    if (request.artifactId !== item.artifactId || !scope.isCurrent(request)) {
      return null;
    }

    const attemptKey = JSON.stringify([actor.kind, actor.id, item.artifactId, item.id]);
    let attempt: { text: string; replyId: string } | undefined;
    if (action === 'reply') {
      const text = args.text?.trim() || '';
      const previous = replyAttempts.current.get(attemptKey);
      attempt =
        previous?.text === text
          ? previous
          : {
              text,
              replyId: previous ? newClientId('reply') : args.replyId || newClientId('reply'),
            };
      replyAttempts.current.set(attemptKey, attempt);
      args = { ...args, text: attempt.text, replyId: attempt.replyId };
    }

    setBusy(`feedback:${item.id}`);
    setError('');
    try {
      const result = await client.call<{ feedback: Feedback[] }>(STUDIO_TOOLS.feedback, {
        action,
        artifactId: item.artifactId,
        feedbackId: item.id,
        ...args,
      });

      if (scope.isCurrent(request)) {
        acceptFeedback(result.feedback, item.id);
        if (action === 'delete' || action === 'resolve') {
          setSelectedFeedback((previous) => (previous?.id === item.id ? null : previous));
        }
        if (action === 'send') {
          inform('请求已提交，等待房主附加到对话。');
        }
      }
      if (attempt && replyAttempts.current.get(attemptKey) === attempt) {
        replyAttempts.current.delete(attemptKey);
      }

      return result.feedback.find((entry) => entry.id === item.id) || null;
    } finally {
      if (isMounted()) {
        setBusy('');
      }
    }
  }

  async function attachFeedback(item: Feedback): Promise<void> {
    const current = getDocument();
    if (!current || current.artifact.id !== item.artifactId || feedbackWritePending()) {
      throw new Error('正在处理上一项操作，请稍候。');
    }

    const request = scope.capture();
    attachmentInFlight.current = true;
    setBusy(`attach:${item.id}`);
    setError('');
    try {
      const attached = await deliverFeedback(item, current);
      if (scope.isCurrent(request)) {
        inform(attachmentResult(attached, canManage, '请求已提交，等待房主附加到对话。'));
      }
    } finally {
      attachmentInFlight.current = false;
      if (isMounted()) {
        setBusy('');
        setAttachingId('');
      }
    }
  }

  async function previewSuggestion(item: Feedback, operations: ProposalOperation[] | null) {
    const request = scope.capture();
    if (request.artifactId !== item.artifactId || !scope.isCurrent(request)) {
      return;
    }

    const sequence = ++suggestionSequence.current;
    if (!operations) {
      setSuggestionPreview(null);

      return;
    }

    const option = item.proposal?.options.find((value) => value.operations === operations);
    if (!option) {
      return;
    }

    try {
      const result = await client.call<{ document: StudioDocument }>(STUDIO_TOOLS.feedback, {
        artifactId: item.artifactId,
        action: 'preview',
        feedbackId: item.id,
        optionId: option.id,
      });

      if (sequence === suggestionSequence.current && scope.isCurrent(request)) {
        stopFollowing();
        setSuggestionPreview(result.document);
      }
    } catch (cause) {
      if (sequence === suggestionSequence.current && scope.isCurrent(request)) {
        setSuggestionPreview(null);
        reportError(cause);
      }
    }
  }

  function collapseListedComment() {
    setSelectedFeedback((previous) => (previous?.inList ? null : previous));
  }

  function changePanel(showFeedback: boolean) {
    if (showFeedback) {
      setAttachmentNoticeId('');
      setSelectedFeedback(null);
    } else {
      collapseListedComment();
    }
  }

  function resetRoute() {
    resetComment();
    setAnnotationActive(false);
    setSuggestionPreview(null);
    suggestionSequence.current += 1;
  }

  return {
    data: {
      activeFeedback,
      feedback,
      pendingAttachments,
      attachingId,
      selectedFeedback,
      annotation,
      annotationActive,
      commentOpen,
      commentError,
      feedbackText,
      attachComment,
      savedComment,
      replies,
      showResolved,
    },
    actions: {
      annotate,
      changeAnnotationMode,
      selectFeedback,
      changeReplyText,
      feedbackAction,
      attachFeedback,
      hideCommentDraft: () => setCommentOpen(false),
      changeCommentText: setFeedbackText,
      changeCommentAttachment: setAttachComment,
      createFeedback: (event: SubmitEvent) => void createFeedback(event).catch(reportError),
      changeShowResolved: setShowResolved,
      dismissComment: () => setSelectedFeedback(null),
      collapseListedComment,
      previewSuggestion: (item: Feedback, operations: ProposalOperation[] | null) =>
        void previewSuggestion(item, operations).catch(reportError),
    },
    suggestionPreview,
    attachmentNotice,
    dismissAttachmentNotice: () => setAttachmentNoticeId(''),
    changePanel,
    resetRoute,
    receiveFeedback: setFeedback,
  };
}
