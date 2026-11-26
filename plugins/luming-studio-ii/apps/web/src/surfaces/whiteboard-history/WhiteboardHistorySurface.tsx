import { useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type {
  BoardEditReceipt,
  ExportBoardScope,
  WhiteboardScene,
} from '../../data/whiteboard/index.js';
import type { WhiteboardHistorySurfaceProps } from './contracts.js';
import { RestoreConfirmation } from './RestoreConfirmation.js';
import { RestoreRecovery } from './RestoreRecovery.js';
import { useVersionRestore } from './useVersionRestore.js';
import { VersionHistoryPanel } from './VersionHistoryPanel.js';
import { VersionPreview } from './VersionPreview.js';
import './whiteboard-history.css';

interface HistoricalPreview {
  readonly scene: WhiteboardScene;
  readonly controller: AbortController;
  readonly trigger: HTMLElement;
}

function BoardHistorySession({
  anchor,
  boardId,
  service,
  canEdit,
  revision,
  createCommandId,
  onRestored,
  onClose,
  onPreviewChange,
  download,
  renderPreview,
}: WhiteboardHistorySurfaceProps) {
  const [preview, setPreview] = useState<HistoricalPreview>();
  const restoreTrigger = useRef<() => void>(undefined);
  const notifyPreview = useEffectEvent((active: boolean) => onPreviewChange?.(active));
  const restore = useVersionRestore({
    boardId,
    revision,
    canEdit,
    service,
    createCommandId,
    onRestored: handleRestored,
  });
  const stopHiddenRestore = useEffectEvent(restore.handleCancelRestore);

  useLayoutEffect(() => {
    if (!anchor && !preview) {
      stopHiddenRestore();
    }
  }, [anchor, preview]);

  useLayoutEffect(() => {
    if (!preview) {
      return;
    }

    notifyPreview(true);
    return () => {
      preview.controller.abort();
      notifyPreview(false);
      if (preview.trigger.isConnected) {
        preview.trigger.focus({ preventScroll: true });
      }
    };
  }, [preview]);

  function handlePreview(scene: WhiteboardScene) {
    if (anchor && preview?.scene.revision !== scene.revision) {
      setPreview({ scene, controller: new AbortController(), trigger: anchor });
    }
  }

  function handleExit() {
    restore.handleCancelRestore();
    setPreview(undefined);
  }

  function handleRestored(receipt: BoardEditReceipt) {
    setPreview(undefined);
    onRestored(receipt);
  }

  function handleClosePanel() {
    restore.handleCancelRestore();
    onClose();
  }

  function handleRequestRestore(source: bigint, scope: ExportBoardScope, restoreFocus: () => void) {
    restoreTrigger.current = restoreFocus;
    restore.handleRequestRestore(source, scope);
  }

  function focusAfterConfirmation() {
    if (restore.recovery) {
      (anchor ?? preview?.trigger)?.focus({ preventScroll: true });
    } else {
      restoreTrigger.current?.();
    }
  }

  const confirmation = canEdit ? restore.confirmation : undefined;
  const busy = restore.pending !== undefined;

  return (
    <>
      {preview && (
        <VersionPreview
          key={preview.scene.revision.toString()}
          boardId={boardId}
          canEdit={canEdit}
          scene={preview.scene}
          service={service}
          download={download}
          renderPreview={renderPreview}
          lifetime={preview.controller.signal}
          restore={restore}
          historyOpen={Boolean(anchor)}
          onExit={handleExit}
          onRequestRestore={handleRequestRestore}
        />
      )}
      {anchor && (
        <VersionHistoryPanel
          anchor={anchor}
          boardId={boardId}
          revision={revision}
          previewRevision={preview?.scene.revision}
          canRestore={canEdit && !restore.recovery}
          busy={busy}
          service={service}
          recovery={
            confirmation ? undefined : <RestoreRecovery restore={restore} canEdit={canEdit} />
          }
          onClose={handleClosePanel}
          onPreview={handlePreview}
          onReturnToCurrent={handleExit}
          onRequestRestore={handleRequestRestore}
        />
      )}
      {confirmation && (
        <RestoreConfirmation
          command={confirmation}
          unknownResult={Boolean(restore.recovery) && !busy}
          pending={busy}
          error={restore.notice?.message}
          onCancel={restore.handleCancelRestore}
          onConfirm={restore.handleConfirmRestore}
          restoreFocus={focusAfterConfirmation}
        />
      )}
    </>
  );
}

export function WhiteboardHistorySurface(props: WhiteboardHistorySurfaceProps) {
  return <BoardHistorySession key={props.boardId} {...props} />;
}
