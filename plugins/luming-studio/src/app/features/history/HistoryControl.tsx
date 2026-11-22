import { useRef } from 'react';
import { Clock3 } from 'lucide-react';
import type { Actor } from '../../../contracts/studio';
import { EditorPopover } from '../../shared/editor-panels/EditorPopover';
import { HistoryPanel } from './HistoryPanel';
import type { VersionHistoryView } from './useVersionHistory';

interface HistoryControlProps {
  actor: Actor;
  currentRevision: number;
  busy: boolean;
  canEdit: boolean;
  open: boolean;
  history: VersionHistoryView;
  onToggle: () => void;
  onClose: () => void;
}

export function HistoryControl({
  actor,
  currentRevision,
  busy,
  canEdit,
  open,
  history,
  onToggle,
  onClose,
}: HistoryControlProps) {
  const historyButton = useRef<HTMLButtonElement>(null);
  return (
    <div className="studio-editor-popover-anchor">
      <button
        ref={historyButton}
        className={`studio-icon-button${open ? ' is-active' : ''}`}
        aria-label="版本历史"
        title="版本历史"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Clock3 size={20} />
      </button>
      {open && (
        <EditorPopover
          title="版本历史"
          className="studio-history-popover"
          hideHeading
          anchorRef={historyButton}
          onClose={onClose}
        >
          <div aria-label="版本历史面板">
            <HistoryPanel
              history={history.batches}
              currentRevision={currentRevision}
              actor={actor}
              loading={history.loading}
              busy={busy}
              previewId={history.preview?.version.id}
              canRestore={canEdit}
              onRefresh={history.refresh}
              onPreview={history.previewVersion}
              onRestore={history.restoreVersion}
              onLoadChanges={history.loadChanges}
              onReturnToCurrent={history.closePreview}
              onClose={onClose}
            />
          </div>
        </EditorPopover>
      )}
    </div>
  );
}
