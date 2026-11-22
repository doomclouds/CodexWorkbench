import { Clock3, RotateCcw } from 'lucide-react';
import { StudioDialog } from '../../shared/StudioDialog';
import type { VersionHistoryView } from './useVersionHistory';
import './history.css';

interface HistoryPreviewProps {
  history: VersionHistoryView;
  canEdit: boolean;
  busy: boolean;
}

export function HistoryPreviewControls({ history, canEdit, busy }: HistoryPreviewProps) {
  const { preview, closePreview, requestRestore, restoreOpen, cancelRestore, confirmRestore } =
    history;

  if (!preview) {
    return null;
  }

  const { revision } = preview.version;
  return (
    <>
      <div className="studio-preview-banner">
        <Clock3 size={16} />
        <span>正在预览版本 {revision}，当前白板未改变。</span>
        <button className="studio-button studio-compact" onClick={closePreview}>
          退出预览
        </button>
        {canEdit && (
          <button
            className="studio-button studio-primary studio-compact"
            disabled={busy}
            onClick={requestRestore}
          >
            <RotateCcw size={14} />
            恢复此版本
          </button>
        )}
      </div>
      {restoreOpen && (
        <StudioDialog title="恢复此版本？" onClose={cancelRestore}>
          <p>
            将整个作品恢复到版本 {revision}
            。恢复会创建新版本，已有历史记录将保留。
          </p>
          <div className="studio-modal-footer">
            <button type="button" className="studio-button" disabled={busy} onClick={cancelRestore}>
              取消
            </button>
            <button
              type="button"
              className="studio-button studio-primary"
              disabled={busy}
              onClick={confirmRestore}
            >
              确认恢复
            </button>
          </div>
        </StudioDialog>
      )}
    </>
  );
}
