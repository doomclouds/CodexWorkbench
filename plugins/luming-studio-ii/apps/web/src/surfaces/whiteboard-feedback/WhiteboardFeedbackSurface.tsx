import { X } from 'lucide-react';
import type { FeedbackPoint } from '../../data/feedback/index.js';
import { StatusText } from '../../ui/base/index.js';
import type { FeedbackViewport, WhiteboardFeedbackSurfaceProps } from './contracts.js';
import { FeedbackComposer } from './FeedbackComposer.js';
import { FeedbackList } from './FeedbackList.js';
import { FeedbackPanel, FeedbackSaveNotice } from './FeedbackPanel.js';
import { FeedbackDetails } from './FeedbackPanelContent.js';
import { FeedbackPins } from './FeedbackPins.js';
import { FeedbackPopup } from './FeedbackPopup.js';
import { locateDraft, screenPoint } from './geometry.js';
import { useFeedbackSurface } from './use-feedback-surface.js';
import './whiteboard-feedback.css';

function layerPoint(point: FeedbackPoint | undefined, viewport: FeedbackViewport) {
  if (point) {
    const { left, top } = screenPoint(point, viewport);

    return { x: left, y: top };
  }
}

export function WhiteboardFeedbackSurface(props: WhiteboardFeedbackSurfaceProps) {
  const { viewport, anchor, panelOpen, canEdit, viewing } = props;
  const surface = useFeedbackSurface(props);
  const { stage, queries, command, objectsById, createDraft, activeThreadId } = surface;
  if (viewing) {
    return null;
  }

  const threadPoint = layerPoint(surface.threadPoint, viewport);
  const draftPosition =
    createDraft && (locateDraft(createDraft.target, objectsById) ?? createDraft.frozenPoint);
  const draftPoint = layerPoint(draftPosition, viewport);
  const details = activeThreadId && (
    <FeedbackDetails
      threadId={activeThreadId}
      queries={queries}
      objects={objectsById}
      draft={surface.threadDraft}
      setDraft={surface.handleSetThreadDraft}
      canEdit={canEdit}
      blocked={surface.blocked}
      onLocate={surface.handleLocateCurrentThread}
      onClose={surface.handleCloseThread}
      onSubmit={command.submit}
    />
  );

  return (
    <div className="whiteboard-feedback" ref={stage} tabIndex={-1}>
      <FeedbackPins
        threads={queries.pinnedThreads}
        selectedThreadId={activeThreadId}
        draft={surface.draftShown ? createDraft?.target : undefined}
        objects={objectsById}
        viewport={viewport}
        picking={surface.picking}
        onThread={surface.handleOpenThread}
        onPick={surface.handlePickLocation}
        onCancelPicking={surface.stopPicking}
      />
      {panelOpen && (
        <FeedbackPanel
          anchor={anchor}
          canvas={stage}
          onClose={surface.handleClosePanel}
          restoreFocus={surface.restoreListFocus}
          progress={command.progress}
          onRetry={command.retry}
          onCheck={command.check}
        >
          <FeedbackList
            threads={queries.list.items}
            authorId={queries.authorId}
            authors={queries.authors}
            mine={queries.mine}
            showResolved={queries.showResolved}
            onAuthorChange={queries.setAuthorId}
            onMineChange={queries.setMine}
            onShowResolvedChange={queries.setShowResolved}
            expandedId={surface.expandedId}
            expanded={details}
            onThread={surface.handleOpenThread}
            draftThreadIds={surface.draftThreadIds}
            pending={queries.list.pending}
            hasMore={Boolean(queries.list.page?.nextCursor)}
            loadMore={queries.list.loadMore}
            error={queries.list.error}
            onRefresh={queries.refresh}
          />
        </FeedbackPanel>
      )}
      {surface.selectedPin && threadPoint && (
        <FeedbackPopup
          kind="pin"
          label="备注线程"
          canvas={stage}
          point={threadPoint}
          onClose={surface.handleCloseThread}
          onOutside={surface.handleCloseThread}
          restoreFocus={surface.restoreCanvasFocus}
        >
          <FeedbackSaveNotice
            progress={command.progress}
            onRetry={command.retry}
            onCheck={command.check}
          />
          {details}
        </FeedbackPopup>
      )}
      {surface.draftShown && createDraft && draftPoint && (
        <FeedbackPopup
          kind="draft"
          label="新建备注"
          canvas={stage}
          point={draftPoint}
          onClose={surface.handleHideDraft}
          onOutside={surface.handleDraftOutside}
          restoreFocus={surface.restoreCanvasFocus}
        >
          <div className="whiteboard-feedback__target">
            <span title={createDraft.label}>{createDraft.label}</span>
            <button
              type="button"
              aria-label="关闭备注"
              className="whiteboard-feedback__icon"
              disabled={surface.blocked}
              onClick={surface.handleHideDraft}
            >
              <X size={15} />
            </button>
          </div>
          {surface.draftTargetConflict && (
            <StatusText
              message="已有未发送的备注草稿，请先完成或清空当前备注，再选择新目标。"
              announcement="polite"
            />
          )}
          <FeedbackSaveNotice
            progress={command.progress}
            onRetry={command.retry}
            onCheck={command.check}
          />
          <FeedbackComposer
            label="批注内容"
            submitLabel="保存备注"
            value={createDraft.text}
            onChange={(text) => surface.setCreateDraft({ ...createDraft, text })}
            onSubmit={() =>
              command.submit({ kind: 'create', anchor: createDraft.target, text: createDraft.text })
            }
            onCancel={surface.handleCancelDraft}
            disabled={surface.blocked || !surface.canWrite}
            focusOnMount
          />
        </FeedbackPopup>
      )}
    </div>
  );
}
