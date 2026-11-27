import { X } from 'lucide-react';
import { useState } from 'react';
import type { FeedbackPoint } from '../../data/feedback/index.js';
import { Button, StatusText } from '../../ui/base/index.js';
import type { FeedbackViewport, WhiteboardFeedbackSurfaceProps } from './contracts.js';
import { FeedbackAttachmentNotice } from './FeedbackAttachmentNotice.js';
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

function reviewLink(
  surface: ReturnType<typeof useFeedbackSurface>,
  threadId: string,
  onReviewThread: WhiteboardFeedbackSurfaceProps['onReviewThread'],
) {
  const { attachment, queries, blocked } = surface;
  if (attachment.available || !onReviewThread || queries.detail.page?.thread.id !== threadId) {
    return null;
  }

  return (
    <Button
      label="使用此批注作为建议来源"
      disabled={blocked}
      onActivate={() => onReviewThread(threadId)}
    />
  );
}

function useFeedbackSuggestions(
  { panelOpen, viewing, renderSuggestions }: WhiteboardFeedbackSurfaceProps,
  { mine, authorId }: ReturnType<typeof useFeedbackSurface>['queries'],
) {
  const [outlet, setOutlet] = useState<HTMLElement | null>(null);
  const [hasCards, setHasCards] = useState(false);
  const render = viewing ? undefined : renderSuggestions;

  return {
    outletRef: render && setOutlet,
    hasVisibleSuggestions: Boolean(render) && hasCards,
    contents: render?.({
      outlet: panelOpen ? outlet : null,
      showCards: !mine && !authorId,
      onCardsVisibleChange: setHasCards,
    }),
  };
}

export function WhiteboardFeedbackSurface(props: WhiteboardFeedbackSurfaceProps) {
  const {
    viewport,
    anchor,
    panelOpen,
    canEdit,
    viewing,
    onReviewThread,
    contentPoints,
    hostPicking,
    focusedObjectId,
  } = props;
  const surface = useFeedbackSurface(props);
  const { stage, queries, command, attachment, objectsById, createDraft, activeThreadId } = surface;
  const suggestions = useFeedbackSuggestions(props, queries);
  if (viewing) {
    return null;
  }

  const threadPoint = layerPoint(surface.threadPoint, viewport);
  const draftPosition =
    createDraft && (locateDraft(createDraft.target, objectsById) ?? createDraft.frozenPoint);
  const draftPoint = layerPoint(draftPosition, viewport);
  const details = activeThreadId && (
    <>
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
        attachment={attachment}
      />
      {reviewLink(surface, activeThreadId, onReviewThread)}
    </>
  );

  return (
    <div className="whiteboard-feedback" ref={stage} tabIndex={-1}>
      <FeedbackPins
        threads={queries.pinnedThreads}
        selectedThreadId={activeThreadId}
        draft={surface.draftShown ? createDraft?.target : undefined}
        objects={objectsById}
        contentPoints={contentPoints}
        viewport={viewport}
        picking={surface.picking && !hostPicking}
        focusedObjectId={focusedObjectId}
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
          <FeedbackAttachmentNotice attachment={attachment} />
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
            suggestionsOutlet={suggestions.outletRef}
            hasVisibleSuggestions={suggestions.hasVisibleSuggestions}
          />
        </FeedbackPanel>
      )}
      {suggestions.contents}
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
          <FeedbackAttachmentNotice attachment={attachment} />
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
              command.submit(
                { kind: 'create', anchor: createDraft.target, text: createDraft.text },
                createDraft.attach,
              )
            }
            attachment={
              attachment.available
                ? {
                    checked: createDraft.attach === true,
                    label: attachment.mode === 'copy' ? '复制批注引用' : '附加到对话',
                    disabled: Boolean(attachment.pending),
                    onChange: (attach) => surface.setCreateDraft({ ...createDraft, attach }),
                  }
                : undefined
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
