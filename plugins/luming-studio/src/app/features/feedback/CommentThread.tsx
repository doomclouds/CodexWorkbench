import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SubmitEvent,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { ArrowUp, Check, MoreHorizontal, Pencil, RotateCcw, Send, Trash2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { Actor, Feedback } from '../../../contracts/studio';
import { attachmentStatus } from '../../shared/comments/attachment';
import type {
  CommentAction,
  CommentActionArguments,
  RunCommentAction,
} from '../../shared/comments/comment-action';
import { CommentAuthorAvatar, commentAuthorName } from '../../shared/comments/comment-author';
import { newClientId } from '../../shared/client-id';

interface MenuItem {
  label: string;
  icon: ReactNode;
  title?: string;
  danger?: boolean;
  checked?: boolean;
  run: () => void;
}

export function CommentMenu({
  label,
  items,
  disabled,
  icon,
}: {
  label: string;
  items: MenuItem[];
  disabled: boolean;
  icon?: ReactNode;
}) {
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = portalHost !== null;
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!open) {
      return;
    }

    menu.current?.querySelector<HTMLButtonElement>('[role^=menuitem]')?.focus();
    const place = () => {
      const anchor = button.current?.getBoundingClientRect();
      const popup = menu.current?.getBoundingClientRect();
      if (anchor && popup) {
        setPosition({
          left: Math.max(
            8,
            Math.min(
              anchor.right - (popup.width || 150),
              window.innerWidth - (popup.width || 150) - 8,
            ),
          ),
          top:
            anchor.bottom + 4 + popup.height > window.innerHeight - 8
              ? Math.max(8, anchor.top - popup.height - 4)
              : anchor.bottom + 4,
        });
      }
    };

    place();
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !menu.current?.contains(event.target)
      ) {
        setPortalHost(null);
      }
    };

    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);

    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  function handleMenuToggle(event: MouseEvent<HTMLButtonElement>) {
    const host =
      event.currentTarget.closest<HTMLElement>('.studio') ?? event.currentTarget.ownerDocument.body;
    setPortalHost((previous) => (previous ? null : host));
  }

  function closeAndFocus() {
    setPortalHost(null);
    button.current?.focus();
  }

  function handleMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();

      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const options = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^=menuitem]'),
    ];

    if (event.key === 'Home') {
      options[0]?.focus();

      return;
    }
    if (event.key === 'End') {
      options.at(-1)?.focus();

      return;
    }

    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    options[(index + direction + options.length) % options.length]?.focus();
  }

  function handleMenuItem(item: MenuItem) {
    closeAndFocus();
    item.run();
  }

  if (!items.length) {
    return null;
  }

  return (
    <div ref={root} className="studio-comment-menu-anchor">
      <button
        ref={button}
        type="button"
        className="studio-icon-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={handleMenuToggle}
      >
        {icon || <MoreHorizontal size={16} />}
      </button>
      {portalHost &&
        createPortal(
          <div
            ref={menu}
            className="studio-comment-menu"
            data-studio-comment-menu=""
            role="menu"
            style={position}
            onKeyDown={handleMenuKey}
          >
            {items.map((item) => (
              <button
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={item.checked}
                title={item.title}
                key={item.label}
                className={item.danger ? 'is-danger' : ''}
                onClick={() => handleMenuItem(item)}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.checked && <Check size={14} />}
              </button>
            ))}
          </div>,
          portalHost,
        )}
    </div>
  );
}

function stamp(value: string, expanded: boolean) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(expanded ? { year: 'numeric' } : {}),
  });
}

function own(author: Actor, actor: Actor) {
  return author.kind === 'human' && author.kind === actor.kind && author.id === actor.id;
}

function MessageHeader({
  author,
  date,
  expanded,
  children,
}: {
  author: Actor;
  date: string;
  expanded: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="studio-comment-message-header">
      <CommentAuthorAvatar author={author} />
      <div className="studio-comment-author">
        <strong>{commentAuthorName(author)}</strong>
        <time dateTime={date}>{stamp(date, expanded)}</time>
      </div>
      <div className="studio-comment-message-actions">{children}</div>
    </div>
  );
}

interface Props {
  feedback: Feedback;
  actor: Actor;
  busy: boolean;
  compact?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  onAction: RunCommentAction;
  onAttach: (feedback: Feedback) => Promise<void>;
  attaching?: boolean;
  replyText?: string;
  onReplyTextChange?: (value: string) => void;
}

function commentPermissions(feedback: Feedback, actor: Actor) {
  const canComment = actor.role !== 'viewer';
  const isAuthor = own(feedback.author, actor);
  const canDelete = canComment && (actor.role === 'owner' || isAuthor);
  const processing = feedback.status === 'processing';
  const claimant = processing && actor.kind === 'agent' ? feedback.processingBy : undefined;
  const claimedByOther = claimant && (claimant.id !== actor.id || claimant.kind !== actor.kind);
  const canReview = actor.role === 'owner' || actor.role === 'editor';
  const canResolve = !claimedByOther && (canReview || (canComment && isAuthor));

  return { canComment, canDelete, canResolve, processing };
}

function ThreadStatus({
  feedback,
  attachmentBusy,
}: {
  feedback: Feedback;
  attachmentBusy: boolean;
}) {
  const attachment = attachmentStatus(feedback);
  const attached = attachment === 'attached' ? '已附加到对话' : '待附加到对话';
  const claimant = feedback.processingBy;
  let processingLabel = '处理中';
  if (claimant) {
    const fallback = claimant.kind === 'agent' ? 'Codex' : '协作者';
    processingLabel = `${claimant.name || fallback} 正在处理`;
  }

  const resolved = feedback.status === 'resolved';
  const processing = feedback.status === 'processing';

  return (
    <>
      {(attachment || attachmentBusy) && (
        <span
          className={`studio-feedback-status studio-feedback-attachment-${attachmentBusy ? 'attaching' : attachment}`}
          role="status"
        >
          {attachmentBusy ? '附加中…' : attached}
        </span>
      )}
      {(resolved || processing) && (
        <span className={`studio-feedback-status studio-feedback-status-${feedback.status}`}>
          {resolved ? '已解决' : processingLabel}
        </span>
      )}
    </>
  );
}

function threadMenu({
  feedback,
  actor,
  canComment,
  canResolve,
  canDelete,
  processing,
  onEdit,
  onReopen,
  onAttach,
  onDelete,
}: {
  feedback: Feedback;
  actor: Actor;
  canComment: boolean;
  canResolve: boolean;
  canDelete: boolean;
  processing: boolean;
  onEdit: () => void;
  onReopen: () => void;
  onAttach: () => void;
  onDelete: () => void;
}): MenuItem[] {
  const items: MenuItem[] = [];
  if (canComment && own(feedback.author, actor)) {
    items.push({ label: '编辑', icon: <Pencil size={14} />, run: onEdit });
  }
  if (canResolve && feedback.status === 'resolved') {
    items.push({ label: '重新打开', icon: <RotateCcw size={14} />, run: onReopen });
  }
  if (processing && actor.kind === 'human' && actor.role === 'owner') {
    items.push({
      label: '重新打开备注',
      title: '仅清除处理标记；已经开始的任务不会因此中断。',
      icon: <RotateCcw size={14} />,
      run: onReopen,
    });
  }
  if (canComment) {
    const attached = attachmentStatus(feedback) === 'attached';
    items.push({
      label: '附加到对话',
      title: attached ? '这条请求已附加；若内容没有变化，不会重复插入附件。' : undefined,
      icon: <Send size={14} />,
      run: onAttach,
    });
  }
  if (canDelete) {
    items.push({ label: '删除备注线程', icon: <Trash2 size={14} />, danger: true, run: onDelete });
  }

  return items;
}

function CommentEditor({
  input,
  text,
  canComment,
  disabled,
  saved,
  attach,
  onAttach,
  onText,
  onSubmit,
  onKeyDown,
  onCancel,
}: {
  input: RefObject<HTMLTextAreaElement | null>;
  text: string;
  canComment: boolean;
  disabled: boolean;
  saved: boolean;
  attach: boolean;
  onAttach: (value: boolean) => void;
  onText: (text: string) => void;
  onSubmit: (event: SubmitEvent) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form className="studio-comment-edit" onSubmit={onSubmit}>
      <textarea
        ref={input}
        aria-label="编辑备注内容"
        value={text}
        rows={3}
        maxLength={16000}
        readOnly={!canComment}
        disabled={disabled || saved}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <label className="studio-comment-edit-attach">
        <input
          type="checkbox"
          checked={attach}
          disabled={!canComment || disabled || saved}
          onChange={(event) => onAttach(event.target.checked)}
        />
        附加到对话
      </label>
      <div>
        <button type="button" className="studio-button" disabled={disabled} onClick={onCancel}>
          取消
        </button>
        <button
          type="submit"
          className="studio-button studio-primary"
          disabled={!canComment || disabled || !text.trim()}
        >
          {saved ? '重试附加' : '保存'}
        </button>
      </div>
    </form>
  );
}

function ThreadReplies({
  replies,
  actor,
  canComment,
  disabled,
  editing,
  editor,
  onEdit,
}: {
  replies: Feedback['replies'];
  actor: Actor;
  canComment: boolean;
  disabled: boolean;
  editing: string | null;
  editor: ReactNode;
  onEdit: (id: string, text: string) => void;
}) {
  return (
    <div className="studio-comment-replies">
      {replies.map((reply) => (
        <div className="studio-feedback-reply" key={reply.id}>
          <MessageHeader author={reply.author} date={reply.createdAt} expanded>
            <CommentMenu
              label={`回复操作：${reply.author.name}`}
              disabled={disabled}
              items={
                canComment && own(reply.author, actor)
                  ? [
                      {
                        label: '编辑回复',
                        icon: <Pencil size={14} />,
                        run: () => onEdit(reply.id, reply.text),
                      },
                    ]
                  : []
              }
            />
          </MessageHeader>
          {editing === reply.id ? editor : <p>{reply.text}</p>}
        </div>
      ))}
    </div>
  );
}

function ReplyComposer({
  feedback,
  resolved,
  replyText,
  canComment,
  disabled,
  pending,
  blocked,
  attach,
  onReplyTextChange,
  onSubmit,
  onAttach,
}: {
  feedback: Feedback;
  resolved: boolean;
  replyText: string;
  canComment: boolean;
  disabled: boolean;
  pending: boolean;
  blocked: boolean;
  attach: boolean;
  onReplyTextChange?: (text: string) => void;
  onSubmit: (event: SubmitEvent) => void;
  onAttach: (value: boolean) => void;
}) {
  const hasReply = !!replyText.trim() || pending;
  if (blocked || (!canComment && !hasReply)) {
    return null;
  }

  function handleReplyKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form className="studio-reply-form" onSubmit={onSubmit}>
      <textarea
        aria-label={`回复批注：${feedback.text}`}
        placeholder={resolved ? '回复以重新打开…' : '回复…'}
        value={replyText}
        rows={1}
        maxLength={16000}
        readOnly={!canComment}
        disabled={disabled || pending}
        onChange={(event) => onReplyTextChange?.(event.target.value)}
        onKeyDown={handleReplyKey}
      />
      <div className="studio-comment-compose-footer">
        {canComment ? (
          <>
            <label>
              <input
                type="checkbox"
                checked={attach}
                disabled={disabled || pending}
                onChange={(event) => onAttach(event.target.checked)}
              />
              附加到对话
            </label>
            <button
              type="submit"
              className="studio-comment-submit"
              aria-label={pending ? '重试附加回复' : '发送回复'}
              disabled={disabled || (!replyText.trim() && !pending)}
            >
              <ArrowUp size={18} />
            </button>
          </>
        ) : (
          <span>当前为只读查看，回复草稿已保留。</span>
        )}
      </div>
    </form>
  );
}

function CommentThreadHeader({
  feedback,
  actor,
  compact,
  disabled,
  permissions,
  onEdit,
  onResolve,
  onReopen,
  onAttach,
  onDelete,
  onClose,
}: {
  feedback: Feedback;
  actor: Actor;
  compact: boolean;
  disabled: boolean;
  permissions: ReturnType<typeof commentPermissions>;
  onEdit: () => void;
  onResolve: () => void;
  onReopen: () => void;
  onAttach: () => void;
  onDelete: () => void;
  onClose?: () => void;
}) {
  const { canResolve } = permissions;
  const resolved = feedback.status === 'resolved';
  const mainMenu = threadMenu({
    feedback,
    actor,
    ...permissions,
    onEdit,
    onReopen,
    onAttach,
    onDelete,
  });

  return (
    <MessageHeader author={feedback.author} date={feedback.createdAt} expanded={!compact}>
      {canResolve && !resolved && (
        <button
          type="button"
          className="studio-icon-button"
          aria-label="解决"
          title="解决"
          disabled={disabled}
          onClick={onResolve}
        >
          <Check size={16} />
        </button>
      )}
      <CommentMenu label="备注操作" items={mainMenu} disabled={disabled} />
      {!compact && (
        <button
          type="button"
          className="studio-icon-button"
          aria-label="关闭备注"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      )}
    </MessageHeader>
  );
}

export function CommentThread({
  feedback,
  actor,
  busy,
  compact = false,
  onOpen,
  onClose,
  onAction,
  onAttach,
  attaching = false,
  replyText = '',
  onReplyTextChange,
}: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [attach, setAttach] = useState(false);
  const [pendingReply, setPendingReply] = useState<Feedback | null>(null);
  const [editAttach, setEditAttach] = useState(false);
  const [savedEdit, setSavedEdit] = useState<Feedback | null>(null);
  const [localAttaching, setLocalAttaching] = useState(false);
  const [attachFailed, setAttachFailed] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const submitLock = useRef(false);
  const editBase = useRef('');
  const replyAttempt = useRef<{
    threadId: string;
    actorId: string;
    actorKind: Actor['kind'];
    text: string;
    replyId: string;
  } | null>(null);
  const currentReplyText = useRef(replyText);
  const permissions = commentPermissions(feedback, actor);
  const { canComment, canDelete } = permissions;
  const commentPermission = useRef(canComment);
  useLayoutEffect(() => {
    currentReplyText.current = replyText;
    commentPermission.current = canComment;
  }, [replyText, canComment]);
  const disabled = busy || running || attaching;
  const resolved = feedback.status === 'resolved';
  const attachmentBusy = attaching || localAttaching;
  useEffect(() => {
    if (editing) {
      input.current?.focus();
    }
  }, [editing]);
  function reportError(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
  }

  async function run(action: CommentAction, args?: CommentActionArguments) {
    if (submitLock.current || !commentPermission.current) {
      return undefined;
    }

    submitLock.current = true;
    setRunning(true);
    setError('');
    setAttachFailed(false);
    try {
      return await onAction(action, feedback, args);
    } catch (cause) {
      reportError(cause);

      return undefined;
    } finally {
      submitLock.current = false;
      setRunning(false);
    }
  }

  async function attachToConversation(item: Feedback) {
    if (submitLock.current || !commentPermission.current) {
      return false;
    }

    submitLock.current = true;
    setRunning(true);
    setLocalAttaching(true);
    setError('');
    setAttachFailed(false);
    try {
      await onAttach(item);

      return true;
    } catch (cause) {
      setAttachFailed(true);
      reportError(cause);

      return false;
    } finally {
      submitLock.current = false;
      setRunning(false);
      setLocalAttaching(false);
    }
  }

  function handleEdit(id: string, text: string) {
    if (!commentPermission.current) {
      return;
    }

    editBase.current = text;
    setDeleting(false);
    setEditText(text);
    setEditing(id);
    setEditAttach(false);
    setSavedEdit(null);
    setError('');
  }

  async function saveEdit(event: SubmitEvent) {
    event.preventDefault();
    if (!commentPermission.current || !editText.trim()) {
      return;
    }

    const result =
      savedEdit ||
      (await run('edit', {
        text: editText.trim(),
        expectedText: editBase.current,
        ...(editing !== 'main' ? { replyId: editing! } : {}),
      }));

    if (!result) {
      return;
    }

    if (editAttach && commentPermission.current) {
      if (!(await attachToConversation(result))) {
        setSavedEdit(result);

        return;
      }

      setSavedEdit(null);
    }

    setEditing(null);
  }

  async function submitReply(event: SubmitEvent) {
    event.preventDefault();
    if (!commentPermission.current) {
      return;
    }

    let saved = pendingReply;
    if (!saved) {
      const content = replyText.trim();
      if (!content) {
        return;
      }

      let attempt = replyAttempt.current;
      const sameThread = attempt?.threadId === feedback.id && attempt.actorId === actor.id;
      const sameText = attempt?.actorKind === actor.kind && attempt.text === content;
      if (!attempt || !sameThread || !sameText) {
        attempt = replyAttempt.current = {
          threadId: feedback.id,
          actorId: actor.id,
          actorKind: actor.kind,
          text: content,
          replyId: newClientId(),
        };
      }

      saved = (await run('reply', { text: attempt.text, replyId: attempt.replyId })) || null;
      if (!saved) {
        return;
      }

      replyAttempt.current = null;
      if (currentReplyText.current === replyText) {
        onReplyTextChange?.('');
      }
    }
    if (attach && commentPermission.current) {
      if (await attachToConversation(saved)) {
        setPendingReply(null);
        setAttach(false);
      } else {
        setPendingReply(saved);
      }
    }
  }

  function handleSaveEdit(event: SubmitEvent) {
    saveEdit(event).catch(reportError);
  }

  function handleEditKeys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setEditing(null);
    }
  }

  function handleAttach() {
    attachToConversation(feedback).catch(reportError);
  }

  function handleAction(action: CommentAction) {
    run(action).catch(reportError);
  }

  function handleDelete() {
    setEditing(null);
    setDeleting(true);
  }

  function handleOpen(event: MouseEvent) {
    if (!(event.target as Element).closest('button,input,textarea,form,[role=menu]')) {
      onOpen?.();
    }
  }

  function handleOpenKey(event: KeyboardEvent) {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onOpen?.();
    }
  }

  function handleReply(event: SubmitEvent) {
    submitReply(event).catch(reportError);
  }

  const editor = (
    <CommentEditor
      input={input}
      text={editText}
      canComment={canComment}
      disabled={disabled}
      saved={!!savedEdit}
      attach={editAttach}
      onAttach={setEditAttach}
      onText={setEditText}
      onSubmit={handleSaveEdit}
      onKeyDown={handleEditKeys}
      onCancel={() => setEditing(null)}
    />
  );

  return (
    <article
      className={`studio-comment-thread${compact ? ' studio-comment-list-item' : ' is-expanded'}`}
      data-feedback-id={feedback.id}
      data-status={feedback.status}
      {...(compact
        ? {
            role: 'button',
            tabIndex: 0,
            onClick: handleOpen,
            onKeyDown: handleOpenKey,
          }
        : {})}
    >
      <CommentThreadHeader
        feedback={feedback}
        actor={actor}
        compact={compact}
        disabled={disabled}
        permissions={permissions}
        onEdit={() => handleEdit('main', feedback.text)}
        onResolve={() => handleAction('resolve')}
        onReopen={() => handleAction('reopen')}
        onAttach={handleAttach}
        onDelete={handleDelete}
        onClose={onClose}
      />
      <ThreadStatus feedback={feedback} attachmentBusy={attachmentBusy} />
      {editing === 'main' ? editor : <p className="studio-feedback-message">{feedback.text}</p>}
      {deleting && (
        <div className="studio-comment-delete-confirm" role="group" aria-label="删除备注确认">
          <p>删除这条备注及其所有回复？</p>
          <div>
            <button
              type="button"
              className="studio-button"
              disabled={disabled}
              onClick={() => setDeleting(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="studio-button is-danger"
              disabled={!canDelete || disabled}
              onClick={() => handleAction('delete')}
            >
              删除
            </button>
          </div>
        </div>
      )}
      {compact ? (
        feedback.replies.length > 0 && (
          <button
            type="button"
            className="studio-link-button studio-comment-reply-count"
            onClick={onOpen}
          >
            {feedback.replies.length} 条回复
          </button>
        )
      ) : (
        <>
          <ThreadReplies
            replies={feedback.replies}
            actor={actor}
            canComment={canComment}
            disabled={disabled}
            editing={editing}
            editor={editor}
            onEdit={handleEdit}
          />
          <ReplyComposer
            feedback={feedback}
            resolved={resolved}
            replyText={replyText}
            canComment={canComment}
            disabled={disabled}
            pending={!!pendingReply}
            blocked={!!editing || deleting}
            attach={attach}
            onReplyTextChange={onReplyTextChange}
            onSubmit={handleReply}
            onAttach={setAttach}
          />
        </>
      )}
      {error && (
        <p className="studio-comment-error" role="alert">
          {error}
        </p>
      )}
      {attachFailed && !editing && !pendingReply && (
        <button
          type="button"
          className="studio-link-button studio-comment-attach-retry"
          disabled={disabled || !canComment}
          onClick={handleAttach}
        >
          重试附加
        </button>
      )}
    </article>
  );
}
