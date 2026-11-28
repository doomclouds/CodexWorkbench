import { Check, Ellipsis, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type {
  FeedbackMessage,
  FeedbackAnchor,
  FeedbackOperation,
  FeedbackThread,
  FeedbackThreadPage,
} from '../../data/feedback/index.js';
import {
  ActionMenu,
  Button,
  Dialog,
  StatusText,
  type ActionMenuItem,
  type ButtonHandle,
} from '../../ui/base/index.js';
import { FeedbackComposer } from './FeedbackComposer.js';
import { FeedbackPager } from './FeedbackPager.js';
import { FeedbackAvatar, feedbackAuthorName } from './feedback-author.js';
import { hasDraftChanges, type ThreadDraft } from './thread-draft.js';
import type { FeedbackAttachment } from './use-feedback-attachment.js';

interface FeedbackThreadViewProps {
  readonly page?: FeedbackThreadPage;
  readonly replies: readonly FeedbackMessage[];
  readonly draft?: ThreadDraft;
  readonly setDraft: (draft: ThreadDraft | undefined) => void;
  readonly canEdit: boolean;
  readonly blocked: boolean;
  readonly pending: boolean;
  readonly error?: string;
  readonly targetLabel?: string;
  readonly targetMissing: boolean;
  readonly contentAnchor?: FeedbackAnchor;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  readonly onRefresh: () => void;
  readonly onBack: () => void;
  readonly onLocate: () => void;
  readonly onSubmit: (operation: FeedbackOperation, attach?: boolean) => void;
  readonly attachment: FeedbackAttachment;
}

const displayTime = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

interface MenuAction extends ActionMenuItem {
  readonly run: () => void;
}

interface FeedbackMessageMenuProps {
  readonly label: string;
  readonly items: readonly MenuAction[];
  readonly disabled: boolean;
  readonly button?: { readonly current: HTMLButtonElement | null };
}

function FeedbackMessageMenu({ label, items, disabled, button }: FeedbackMessageMenuProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  if (items.length === 0) {
    return null;
  }

  function handleAction(id: string) {
    setAnchor(null);
    items.find((item) => item.id === id)?.run();
  }

  return (
    <>
      <button
        type="button"
        className="whiteboard-feedback__icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        disabled={disabled}
        ref={button}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <Ellipsis size={16} />
      </button>
      <ActionMenu
        open={anchor !== null}
        anchor={anchor}
        label={label}
        items={items}
        onAction={handleAction}
        onRequestClose={() => setAnchor(null)}
      />
    </>
  );
}

function MessageHeader({
  message,
  actions,
}: {
  readonly message: FeedbackMessage;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="whiteboard-feedback__message-header">
      <FeedbackAvatar author={message} />
      <span className="whiteboard-feedback__message-author">
        <strong>{feedbackAuthorName(message)}</strong>
        <time dateTime={new Date(message.createdAt).toISOString()}>
          {displayTime.format(message.createdAt)}
        </time>
      </span>
      {actions && <div className="whiteboard-feedback__message-actions">{actions}</div>}
    </div>
  );
}

interface ThreadComposerProps {
  readonly draft?: ThreadDraft;
  readonly thread: FeedbackThread;
  readonly canWrite: boolean;
  readonly blocked: boolean;
  readonly setDraft: (draft: ThreadDraft | undefined) => void;
  readonly onSubmit: (operation: FeedbackOperation, attach?: boolean) => void;
  readonly attachment: FeedbackAttachment;
}

function ThreadComposer({
  draft,
  thread,
  canWrite,
  blocked,
  setDraft,
  onSubmit,
  attachment,
}: ThreadComposerProps) {
  const editing = draft?.kind === 'edit';

  function handleSubmitDraft() {
    if (!draft) {
      return;
    }

    const threadId = thread.id;
    if (draft.kind === 'reply') {
      onSubmit({ kind: 'reply', threadId, text: draft.text }, draft.attach);
      return;
    }

    const { messageId, expectedVersion, text } = draft;
    onSubmit({ kind: 'edit', threadId, messageId, expectedVersion, text }, draft.attach);
  }

  function toggleAttachment(attach: boolean) {
    setDraft(draft ? { ...draft, attach } : { kind: 'reply', text: '', attach });
  }

  return (
    <FeedbackComposer
      key={editing ? 'edit-' + draft.messageId : 'reply'}
      label={editing ? '编辑备注内容' : '回复批注：' + thread.first.text}
      submitLabel={editing ? '保存' : '发送回复'}
      value={draft?.text ?? ''}
      variant={editing ? 'edit' : 'reply'}
      resolved={thread.status === 'resolved'}
      onChange={(text) => setDraft(draft ? { ...draft, text } : { kind: 'reply', text })}
      onSubmit={handleSubmitDraft}
      onCancel={draft ? () => setDraft(undefined) : undefined}
      disabled={!canWrite}
      cancelDisabled={blocked}
      focusOnMount={editing}
      attachment={
        attachment.available
          ? {
              checked: draft?.attach === true,
              label: '附加到 Codex 对话',
              disabled: Boolean(attachment.pending),
              onChange: toggleAttachment,
            }
          : undefined
      }
    />
  );
}

interface ThreadContentsProps extends ThreadComposerProps {
  readonly replies: readonly FeedbackMessage[];
  readonly canEdit: boolean;
  readonly hasMore: boolean;
  readonly pending: boolean;
  readonly loadMore: () => void;
  readonly onEdit: (message: FeedbackMessage) => void;
  readonly onLocate: () => void;
  readonly onClose: () => void;
}

function threadMenu(
  { thread, canEdit, canWrite, onEdit, onLocate, attachment }: ThreadContentsProps,
  onReopen: () => void,
  onDelete: () => void,
): MenuAction[] {
  const menu: MenuAction[] = [];
  if (thread.first.canEdit && canEdit) {
    menu.push({ id: 'edit', label: '编辑', run: () => onEdit(thread.first) });
  }
  if (thread.canResolve && thread.status === 'resolved' && canEdit) {
    menu.push({ id: 'reopen', label: '重新打开', run: onReopen });
  }

  menu.push({ id: 'locate', label: '定位备注', run: onLocate });
  if (attachment.available && canWrite) {
    menu.push({
      id: 'attach',
      label: '附加到 Codex 对话',
      run: () => attachment.request({ threadId: thread.id, threadVersion: thread.version }),
    });
  }
  if (thread.canDelete && canEdit) {
    menu.push({ id: 'delete', label: '删除备注线程', tone: 'danger', run: onDelete });
  }

  return menu;
}

function attachedStatus(thread: FeedbackThread, attachment: FeedbackAttachment) {
  if (attachment.complete.get(thread.id) !== thread.version) {
    return null;
  }

  return <StatusText message="已附加到 Codex 对话" announcement="polite" />;
}

function ThreadContents(props: ThreadContentsProps) {
  const {
    thread,
    replies,
    draft,
    canEdit,
    canWrite,
    blocked,
    setDraft,
    onSubmit,
    hasMore,
    pending,
    loadMore,
    onEdit,
    onClose,
    attachment,
  } = props;
  const [confirm, setConfirm] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<ButtonHandle>(null);
  const resolved = thread.status === 'resolved';
  const editing = draft?.kind === 'edit';
  const editingLoadedMessage =
    editing && [thread.first, ...replies].some(({ id }) => id === draft.messageId);
  const menu = threadMenu(
    props,
    () => handleChangeStatus('reopen'),
    () => setConfirm(true),
  );

  useLayoutEffect(() => {
    if (confirm) {
      cancelDelete.current?.focus();
    }
  }, [confirm]);

  function handleChangeStatus(kind: 'resolve' | 'reopen') {
    if (thread.canResolve && canWrite) {
      onSubmit({ kind, threadId: thread.id, expectedVersion: thread.version });
    }
  }

  function handleDelete() {
    if (thread.canDelete && canWrite) {
      setConfirm(false);
      onSubmit({ kind: 'delete', threadId: thread.id, expectedVersion: thread.version });
    }
  }

  function handleCancelDelete() {
    setConfirm(false);
    menuButton.current?.focus();
  }

  function handleDeleteKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      handleCancelDelete();
    }
  }

  function composer() {
    return (
      <ThreadComposer
        draft={draft}
        thread={thread}
        canWrite={canWrite}
        blocked={blocked}
        setDraft={setDraft}
        onSubmit={onSubmit}
        attachment={attachment}
      />
    );
  }

  function bodyOf(message: FeedbackMessage) {
    return editing && draft.messageId === message.id ? composer() : <p>{message.text}</p>;
  }

  return (
    <>
      <div className="whiteboard-feedback__message">
        <MessageHeader
          message={thread.first}
          actions={
            <>
              {thread.canResolve && !resolved && canEdit && (
                <button
                  type="button"
                  className="whiteboard-feedback__icon"
                  aria-label="解决"
                  title="解决"
                  disabled={!canWrite}
                  onClick={() => handleChangeStatus('resolve')}
                >
                  <Check size={16} />
                </button>
              )}
              <FeedbackMessageMenu
                label="备注操作"
                items={menu}
                disabled={blocked}
                button={menuButton}
              />
              <button
                type="button"
                className="whiteboard-feedback__icon"
                aria-label="关闭备注"
                disabled={blocked}
                onClick={onClose}
              >
                <X size={15} />
              </button>
            </>
          }
        />
        <span className="whiteboard-feedback__sr-only">
          保存版次 {thread.anchor.sourceRevision.toString()}
        </span>
        {resolved && <span className="whiteboard-feedback__resolved">已解决</span>}
        {bodyOf(thread.first)}
        {attachedStatus(thread, attachment)}
      </div>
      {confirm && (
        <div
          className="whiteboard-feedback__delete-confirm"
          role="group"
          aria-label="删除备注确认"
          onKeyDown={handleDeleteKeys}
        >
          <p>
            {hasDraftChanges(draft)
              ? '删除这条备注、所有回复及未保存的草稿？'
              : '删除这条备注及其所有回复？'}
          </p>
          <div className="whiteboard-feedback__actions">
            <Button label="取消" onActivate={handleCancelDelete} ref={cancelDelete} />
            <Button
              label="确认删除"
              variant="primary"
              tone="danger"
              disabled={!canWrite}
              onActivate={handleDelete}
            />
          </div>
        </div>
      )}
      <ul className="whiteboard-feedback__messages" aria-label="讨论回复">
        {replies.map((reply) => (
          <li className="whiteboard-feedback__message" key={reply.id}>
            <MessageHeader
              message={reply}
              actions={
                reply.canEdit &&
                canEdit && (
                  <FeedbackMessageMenu
                    label={'回复操作：' + feedbackAuthorName(reply)}
                    items={[{ id: 'edit', label: '编辑回复', run: () => onEdit(reply) }]}
                    disabled={blocked}
                  />
                )
              }
            />
            {bodyOf(reply)}
          </li>
        ))}
      </ul>
      {hasMore && <FeedbackPager label="更多回复" pending={pending} onActivate={loadMore} />}
      {!editingLoadedMessage && (canEdit || draft) && composer()}
    </>
  );
}

interface ChangeEditDialogProps {
  readonly onKeep: () => void;
  readonly onDiscard: () => void;
}

function ChangeEditDialog({ onKeep, onDiscard }: ChangeEditDialogProps) {
  const keepButton = useRef<ButtonHandle>(null);

  return (
    <Dialog
      open
      title="放弃草稿？"
      description="编辑另一条消息会放弃当前尚未保存的草稿。"
      closeLabel="关闭放弃草稿确认"
      onRequestClose={onKeep}
      initialFocus={() => keepButton.current?.focus()}
    >
      <div className="whiteboard-feedback__actions">
        <Button label="保留草稿" onActivate={onKeep} ref={keepButton} />
        <Button label="放弃并编辑" variant="primary" onActivate={onDiscard} />
      </div>
    </Dialog>
  );
}

export function FeedbackThreadView({
  page,
  replies,
  draft,
  setDraft,
  canEdit,
  blocked,
  pending,
  error,
  targetLabel,
  targetMissing,
  contentAnchor,
  hasMore,
  loadMore,
  onRefresh,
  onBack,
  onLocate,
  onSubmit,
  attachment,
}: FeedbackThreadViewProps) {
  const [replacement, setReplacement] = useState<FeedbackMessage>();
  const thread = page?.thread;
  const canWrite = canEdit && page?.canWrite === true && !blocked;

  function beginEdit(message: FeedbackMessage) {
    setDraft({
      kind: 'edit',
      messageId: message.id,
      expectedVersion: message.version,
      originalText: message.text,
      text: message.text,
    });
  }

  function handleEditMessage(message: FeedbackMessage) {
    if (draft?.kind === 'edit' && draft.messageId === message.id) {
      return;
    }

    if (hasDraftChanges(draft)) {
      setReplacement(message);
      return;
    }

    beginEdit(message);
  }

  function handleReplaceDraft() {
    if (replacement) {
      beginEdit(replacement);
      setReplacement(undefined);
    }
  }

  return (
    <article className="whiteboard-feedback__thread">
      {pending && <StatusText message="正在加载讨论…" announcement="polite" />}
      {error && (
        <div className="whiteboard-feedback__actions">
          <StatusText message={error} tone="error" announcement="assertive" />
          <Button label="重新加载" onActivate={onRefresh} />
        </div>
      )}
      {targetLabel && (
        <div className="whiteboard-feedback__target whiteboard-feedback__thread-target">
          <span className="whiteboard-feedback__target-label" title={targetLabel}>
            {targetLabel}
          </span>
        </div>
      )}
      {targetMissing && (
        <StatusText
          message={
            contentAnchor
              ? '原内容已不可用，显示留下备注时的位置。'
              : '原对象已删除，显示留下备注时的位置。'
          }
          tone="warning"
        />
      )}
      {contentAnchor?.frozenExcerpt && (
        <blockquote className="whiteboard-feedback__frozen-excerpt">
          {contentAnchor.frozenExcerpt}
        </blockquote>
      )}
      {thread && (
        <ThreadContents
          draft={draft}
          thread={thread}
          replies={replies}
          canEdit={canEdit}
          canWrite={canWrite}
          blocked={blocked}
          setDraft={setDraft}
          onSubmit={onSubmit}
          hasMore={hasMore}
          pending={pending}
          loadMore={loadMore}
          onEdit={handleEditMessage}
          onLocate={onLocate}
          onClose={onBack}
          attachment={attachment}
        />
      )}
      {replacement && canWrite && (
        <ChangeEditDialog onKeep={() => setReplacement(undefined)} onDiscard={handleReplaceDraft} />
      )}
    </article>
  );
}
