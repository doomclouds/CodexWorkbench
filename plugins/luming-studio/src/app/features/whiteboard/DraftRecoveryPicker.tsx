import { useState } from 'react';
import { StudioDialog } from '../../shared/StudioDialog';
import { copyPlainText } from '../../clipboard';
import type { DraftCandidate, DraftSlot } from './draft-workspace';

interface DraftComparison {
  saved: string;
  draft: string;
  recoverable: boolean;
}

interface DraftRecoveryProps {
  slot: DraftSlot;
  canRecover: boolean;
  hidden?: boolean;
  portalRoot?: HTMLElement | null;
  compare: (raw: string) => DraftComparison;
  onRecover: (raw: string) => void;
  onError?: (cause: unknown) => void;
}

const sourceLabels: Record<DraftCandidate['source'], string> = {
  panel: '比较上次面板草稿',
  legacy: '比较旧版本机草稿',
  other: '比较本机草稿',
};

function readCandidates(slot: DraftSlot) {
  try {
    return { candidates: slot.list(), warning: '' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { candidates: [], warning: `无法读取本机草稿。${detail}` };
  }
}

export function DraftRecoveryPicker({
  slot,
  canRecover,
  hidden,
  portalRoot,
  compare,
  onRecover,
  onError,
}: DraftRecoveryProps) {
  const [{ candidates, warning }, refresh] = useState(() => readCandidates(slot));
  const [selected, setSelected] = useState<DraftCandidate>();
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [error, setError] = useState('');
  const available = candidates.filter((item) => !reviewed.includes(item.key));

  if (hidden) {
    return null;
  }

  function report(cause: unknown) {
    setError(cause instanceof Error ? cause.message : String(cause));
    onError?.(cause);
  }

  function recover(choice: DraftCandidate) {
    try {
      if (!slot.matches(choice)) {
        refresh(readCandidates(slot));
        setSelected(undefined);
        throw new Error('草稿在另一视图中已变化，请重新比较。');
      }

      onRecover(choice.raw);
      setReviewed((previous) => [...previous, choice.key]);
      setSelected(undefined);
    } catch (cause) {
      report(cause);
    }
  }

  const comparison = selected ? compare(selected.raw) : undefined;
  return (
    <>
      {warning && <p role="status">{warning}</p>}
      {error && <p role="alert">{error}</p>}
      {available.map((item, index) => (
        <button
          key={item.key}
          type="button"
          className="studio-button studio-compact"
          onClick={() => setSelected(item)}
        >
          {sourceLabels[item.source]}
          {available.length > 1 && ` ${index + 1}`}
        </button>
      ))}
      {selected && comparison && (
        <StudioDialog
          title="比较本机草稿"
          onClose={() => setSelected(undefined)}
          portalRoot={portalRoot}
          wide
        >
          <p>对照当前已保存内容后，可将草稿复制到本视图继续编辑。</p>
          <label className="studio-field-label">
            当前已保存内容
            <textarea className="studio-text-field" readOnly rows={6} value={comparison.saved} />
          </label>
          <label className="studio-field-label">
            本机草稿
            <textarea className="studio-text-field" readOnly rows={6} value={comparison.draft} />
          </label>
          <div className="studio-modal-footer">
            <button
              type="button"
              className="studio-button"
              onClick={() => void copyPlainText(selected.raw).catch(report)}
            >
              复制原始草稿
            </button>
            <button
              type="button"
              className="studio-button studio-primary"
              disabled={!canRecover || !comparison.recoverable}
              onClick={() => recover(selected)}
            >
              恢复为本视图草稿
            </button>
          </div>
        </StudioDialog>
      )}
    </>
  );
}
