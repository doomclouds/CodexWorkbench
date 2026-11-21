import type { CSSProperties, ReactNode } from 'react';
import type { BoardElement } from '../../../../../contracts/studio.js';
import OperationNotice from '../../../../shared/OperationNotice.js';
import type { NativeTableDraft } from '../objects/table/NativeTable.js';
import type { CanvasDraft, CanvasDraftRecovery, TextDraft } from '../sync/canvas-drafts.js';
import type { ContentTask } from '../sync/content-queue.js';

const inlineCanvasNotice: CSSProperties = {
  position: 'relative',
  bottom: 'auto',
  left: 'auto',
  maxWidth: 'none',
  flexWrap: 'wrap',
};

export type CanvasFailedSaveNotice = Pick<ContentTask, 'id' | 'summary' | 'recovered'> & {
  message: string;
  canRetry: boolean;
};

interface SaveNoticesProps {
  messages: {
    status?: string | null;
    previewError?: string | null;
    historyError?: string | null;
    error?: string;
  };
  unconfirmedHistory?: Pick<ContentTask, 'id' | 'summary'>;
  failures: CanvasFailedSaveNotice[];
  textDeletion: { blocked: boolean; failedTaskId?: string; onCancel: () => void };
  canEdit: boolean;
  onClearHistoryError: () => void;
  onClearError: () => void;
  onCompareDraft: (id: string) => void;
  onRetry: (id: string) => void;
  children: ReactNode;
}

function CancelTextDraftButton({ onCancel }: { onCancel: () => void }) {
  return (
    <button type="button" aria-label="取消本次文字编辑" onClick={onCancel}>
      取消本次文字编辑
    </button>
  );
}

export function CanvasSaveNotices({
  messages,
  unconfirmedHistory,
  failures,
  textDeletion,
  canEdit,
  onClearHistoryError,
  onClearError,
  onCompareDraft,
  onRetry,
  children,
}: SaveNoticesProps) {
  return (
    <div
      aria-label="草稿与保存提示"
      style={{
        position: 'absolute',
        bottom: 87,
        left: 18,
        maxWidth: 'min(620px, calc(100% - 36px))',
        maxHeight: '45%',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 60,
      }}
    >
      {messages.status && (
        <div
          role="status"
          style={{
            padding: '8px 12px',
            border: '1px solid var(--canvas-ui-border)',
            borderRadius: 7,
            background: 'var(--canvas-ui)',
            color: 'var(--canvas-ui-text)',
          }}
        >
          {messages.status}
        </div>
      )}
      {messages.previewError && (
        <OperationNotice
          source="画布预览"
          message={messages.previewError}
          fallbackClass="studio-canvas-error"
          fallbackStyle={inlineCanvasNotice}
        />
      )}
      {messages.historyError && (
        <OperationNotice
          source="撤销与重做"
          message={messages.historyError}
          closeLabel="关闭撤销或重做提示"
          onClose={onClearHistoryError}
          fallbackClass="studio-canvas-error"
          fallbackStyle={inlineCanvasNotice}
        />
      )}
      {unconfirmedHistory && (
        <OperationNotice
          key={unconfirmedHistory.id}
          source="撤销与重做"
          message={`「${unconfirmedHistory.summary}」的结果待确认。`}
          fallbackClass="studio-canvas-error"
          fallbackStyle={inlineCanvasNotice}
          actions={
            <button
              type="button"
              disabled={!canEdit}
              onClick={() => onRetry(unconfirmedHistory.id)}
            >
              重试确认原结果
            </button>
          }
        />
      )}
      {messages.error && (
        <OperationNotice
          source="画布操作"
          message={messages.error}
          closeLabel="关闭错误提示"
          onClose={onClearError}
          fallbackClass="studio-canvas-error"
          fallbackStyle={inlineCanvasNotice}
          actions={
            textDeletion.blocked ? (
              <CancelTextDraftButton onCancel={textDeletion.onCancel} />
            ) : undefined
          }
        />
      )}
      {failures.map((task) => (
        <OperationNotice
          key={task.id}
          source={`画布 · ${task.summary}`}
          message={task.message}
          closeLabel="关闭画布保存通知"
          fallbackClass="studio-canvas-error"
          fallbackStyle={inlineCanvasNotice}
          actions={
            <>
              {textDeletion.failedTaskId === task.id && (
                <CancelTextDraftButton onCancel={textDeletion.onCancel} />
              )}
              <button type="button" onClick={() => onCompareDraft(task.id)}>
                比较双方内容
              </button>
              {task.canRetry && (
                <button type="button" disabled={!canEdit} onClick={() => onRetry(task.id)}>
                  {task.recovered ? '核对上次保存' : '重试原操作'}
                </button>
              )}
            </>
          }
        />
      ))}
      {children}
    </div>
  );
}

interface LocalDraftNoticesProps {
  activeDraft: CanvasDraft | null;
  recovery: CanvasDraftRecovery;
  storageError: string;
  actions: {
    copy: (text: string) => void;
    download: (text: string) => void;
    clearStorageError: () => void;
    apply: () => void;
    discard: () => void;
    viewPrevious: () => void;
  };
  children?: ReactNode;
}

function DraftExportActions({
  readDraft,
  actions,
}: {
  readDraft: () => string;
  actions: Pick<LocalDraftNoticesProps['actions'], 'copy' | 'download'>;
}) {
  return (
    <>
      <button type="button" onClick={() => actions.copy(readDraft())}>
        复制草稿
      </button>
      <button type="button" onClick={() => actions.download(readDraft())}>
        下载草稿副本
      </button>
    </>
  );
}

function RecoveredDraftNotice({
  activeDraft,
  recovery: { draft, unreadableDraft, retainedDrafts = [] },
  actions,
}: Pick<LocalDraftNoticesProps, 'activeDraft' | 'recovery' | 'actions'>) {
  const visibleDraft = draft || unreadableDraft !== undefined;
  if (!visibleDraft && !retainedDrafts.length) {
    return null;
  }

  const retainedText = retainedDrafts.length ? JSON.stringify(retainedDrafts, null, 2) : '';
  const canViewPrevious = !visibleDraft && !activeDraft;

  return (
    <div className="studio-canvas-error" style={inlineCanvasNotice} role="status">
      {visibleDraft && (
        <>
          <span>
            {unreadableDraft === undefined
              ? '此白板有上次未保存的本机草稿。'
              : '此白板有无法读取的本机草稿，原始内容仍可复制或下载。'}
          </span>
          {draft && (
            <button type="button" onClick={actions.apply} disabled={activeDraft !== null}>
              应用已比较的草稿
            </button>
          )}
          <DraftExportActions
            readDraft={() => unreadableDraft ?? JSON.stringify(draft, null, 2)}
            actions={actions}
          />
          <button type="button" onClick={actions.discard}>
            放弃上次草稿
          </button>
        </>
      )}
      {retainedDrafts.length > 0 && (
        <>
          <span>较早的本机草稿已保留。</span>
          {canViewPrevious && (
            <button type="button" onClick={actions.viewPrevious}>
              查看较早草稿
            </button>
          )}
          <button type="button" onClick={() => actions.copy(retainedText)}>
            复制较早草稿
          </button>
        </>
      )}
    </div>
  );
}

export function CanvasLocalDraftNotices({
  activeDraft,
  recovery,
  storageError,
  actions,
  children,
}: LocalDraftNoticesProps) {
  return (
    <>
      {storageError && (
        <OperationNotice
          source="本机草稿"
          message={storageError}
          closeLabel="关闭本机草稿提示"
          onClose={actions.clearStorageError}
          fallbackClass="studio-canvas-error"
          fallbackStyle={inlineCanvasNotice}
          actions={
            activeDraft && (
              <DraftExportActions
                readDraft={() => JSON.stringify(activeDraft, null, 2)}
                actions={actions}
              />
            )
          }
        />
      )}
      {children}
      <RecoveredDraftNotice activeDraft={activeDraft} recovery={recovery} actions={actions} />
    </>
  );
}

type InspectDetachedDraft = (base: BoardElement, changes: Partial<BoardElement>) => void;

function RemovedTextDraftNotice({
  draft,
  elements,
  onInspect,
}: {
  draft: TextDraft | null;
  elements: readonly BoardElement[];
  onInspect: InspectDetachedDraft;
}) {
  const base = draft?.base;
  if (
    !draft ||
    !base ||
    elements.some((element) => element.id === draft.id && element.type === base.type)
  ) {
    return null;
  }

  const inspect = () => onInspect(base, { [base.type === 'arrow' ? 'label' : 'text']: draft.text });

  return (
    <OperationNotice
      key={draft.id}
      source="文字草稿"
      message="正在编辑的对象已被删除，文字草稿仍可恢复。"
      fallbackClass="studio-canvas-error"
      fallbackStyle={inlineCanvasNotice}
      actions={
        <button type="button" onClick={inspect}>
          查看并恢复文字草稿
        </button>
      }
    />
  );
}

export function DetachedCanvasDraftNotices({
  text,
  tables,
  elements,
  onInspect,
}: {
  text: TextDraft | null;
  tables: Record<string, NativeTableDraft>;
  elements: readonly BoardElement[];
  onInspect: InspectDetachedDraft;
}) {
  return (
    <>
      <RemovedTextDraftNotice draft={text} elements={elements} onInspect={onInspect} />
      {Object.entries(tables).map(([id, draft]) => {
        if (elements.some((element) => element.id === id && element.type === 'table')) {
          return null;
        }

        return (
          <OperationNotice
            key={id}
            source="表格草稿"
            message="正在编辑的表格已被删除，草稿仍可恢复。"
            fallbackClass="studio-canvas-error"
            fallbackStyle={inlineCanvasNotice}
            actions={
              <button type="button" onClick={() => onInspect(draft.base, draft.changes)}>
                查看并恢复表格草稿
              </button>
            }
          />
        );
      })}
    </>
  );
}
