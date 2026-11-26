import { Check, Ellipsis, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type {
  FeedbackMessage,
  FeedbackOperation,
  FeedbackThread,
  FeedbackThreadPage,
} from '../../data/feedback/index.js';
import { ActionMenu, Button, Dialog, StatusText, type ButtonHandle } from '../../ui/base/index.js';
import { FeedbackComposer } from './FeedbackComposer.js';
import { FeedbackAvatar, feedbackAuthorName } from './feedback-author.js';
import { hasDraftChanges, type ThreadDraft } from './thread-draft.js';

interface FeedbackThreadViewProps {
  readonly page?: FeedbackThreadPage;
  readonly replies: readonly FeedbackMessage[];
  readonly draft?: ThreadDraft;
  readonly setDraft: (draft: ThreadDraft | undefined) => void;
  readonly canEdit: boolean;
  readonly blocked: boolean;
  readonly pending: boolean;
  readonly error?: string;
  readonly targetMissing: boolean;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  readonly onRefresh: () => void;
  readonly onBack: () => void;
  readonly onLocate: () => void;
  readonly onSubmit: (operation: FeedbackOperation) => void;
}

const displayTime = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' });

interface MenuAction {
  readonly id: string;
  readonly label: string;
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
  readonly onSubmit: (operation: FeedbackOperation) => void;
}

function ThreadComposer({
  draft,
  thread,
  canWrite,
  blocked,
  setDraft,
  onSubmit,
}: ThreadComposerProps) {
  const editing = draft?.kind === 'edit';

  function handleSubmitDraft() {
    if (!draft) {
      return;
    }

    const threadId = thread.id;
    if (draft.kind === 'reply') {
      onSubmit({ kind: 'reply', threadId, text: draft.text });
      return;
    }

    const { messageId, expectedVersion, text } = draft;
    onSubmit({ kind: 'edit', threadId, messageId, expectedVersion, text });
  }

  return (
    <FeedbackComposer
      key={editing ? 'edit-' + draft.messageId : 'reply'}
      label={editing ? '编辑备注内容' : '回复批注：' + thread.first.text}
      submitLabel={editing ? '保存修改' : '发送回复'}
      value={draft?.text ?? ''}
      variant={editing ? 'edit' : 'reply'}
      resolved={thread.status === 'resolved'}
      onChange={(text) => setDraft(draft ? { ...draft, text } : { kind: 'reply', text })}
      onSubmit={handleSubmitDraft}
      onCancel={draft ? () => setDraft(undefined) : undefined}
      disabled={!canWrite}
      cancelDisabled={blocked}
      focusOnMount={editing}
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

function ThreadContents({
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
  onLocate,
  onClose,
}: ThreadContentsProps) {
  const [confirm, setConfirm] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<ButtonHandle>(null);
  const resolved = thread.status === 'resolved';
  const editing = draft?.kind === 'edit';
  const editingLoadedMessage =
    editing && [thread.first, ...replies].some(({ id }) => id === draft.messageId);
  const menu: MenuAction[] = [];
  if (thread.first.canEdit && canEdit) {
    menu.push({ id: 'edit', label: '编辑', run: () => onEdit(thread.first) });
  }
  if (thread.canResolve && resolved && canEdit) {
    menu.push({ id: 'reopen', label: '重新打开', run: () => handleChangeStatus('reopen') });
  }

  menu.push({ id: 'locate', label: '定位备注', run: onLocate });
  if (thread.canDelete && canEdit) {
    menu.push({ id: 'delete', label: '删除备注线程', run: () => setConfirm(true) });
  }

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
      {hasMore && <Button label="更多回复" disabled={pending} onActivate={loadMore} />}
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
  targetMissing,
  hasMore,
  loadMore,
  onRefresh,
  onBack,
  onLocate,
  onSubmit,
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
      {targetMissing && (
        <StatusText message="原对象已删除，显示留下备注时的位置。" tone="warning" />
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
        />
      )}
      {replacement && canWrite && (
        <ChangeEditDialog onKeep={() => setReplacement(undefined)} onDiscard={handleReplaceDraft} />
      )}
    </article>
  );
}
