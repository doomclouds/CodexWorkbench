import { ChevronDown, Clock3, Download, RotateCcw } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type {
  ExportBoardScope,
  ExportBoardVersionCommand,
  WhiteboardScene,
} from '../../data/whiteboard/index.js';
import {
  ActionMenu,
  AnchoredPopover,
  Button,
  Select,
  StatusText,
  type ButtonHandle,
} from '../../ui/base/index.js';
import type { WhiteboardHistorySurfaceProps } from './contracts.js';
import { RestoreRecovery } from './RestoreRecovery.js';
import { useVersionExport } from './useVersionExport.js';
import type { VersionRestore } from './useVersionRestore.js';

interface VersionPreviewProps extends Pick<
  WhiteboardHistorySurfaceProps,
  'boardId' | 'canEdit' | 'service' | 'download' | 'renderPreview'
> {
  readonly scene: WhiteboardScene;
  readonly lifetime: AbortSignal;
  readonly restore: VersionRestore;
  readonly historyOpen: boolean;
  readonly onExit: () => void;
  readonly onRequestRestore: (
    revision: bigint,
    scope: ExportBoardScope,
    restoreFocus: () => void,
  ) => void;
}

type ScopeKind = ExportBoardScope['kind'];

function actionScope(kind: ScopeKind, selection: readonly string[]): ExportBoardScope {
  return kind === 'whole' ? { kind } : { kind, objectIds: [...selection] };
}

const selectionFormats = [
  ['json', '导出 JSON'],
  ['svg', '导出 SVG'],
  ['png', '导出 PNG'],
] as const;

function VersionExportControl({
  selection,
  busy,
  onExport,
}: {
  readonly selection: readonly string[];
  readonly busy: boolean;
  readonly onExport: (format: ExportBoardVersionCommand['format'], scope: ExportBoardScope) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [scope, setScope] = useState<ScopeKind>('whole');
  const panel = useRef<HTMLDivElement>(null);
  const currentScope = selection.length > 0 ? scope : 'whole';

  function handleExport(format: ExportBoardVersionCommand['format']) {
    setAnchor(null);
    anchor?.focus({ preventScroll: true });
    onExport(format, actionScope(format === 'html' ? 'whole' : currentScope, selection));
  }

  return (
    <>
      <button
        type="button"
        className="studio-ui-button"
        aria-label="导出历史版本"
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        aria-disabled={busy || undefined}
        onClick={(event) => {
          if (!busy) {
            setAnchor(anchor ? null : event.currentTarget);
          }
        }}
      >
        <Download size={14} aria-hidden="true" />
        导出
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      <AnchoredPopover
        open={anchor !== null}
        anchor={anchor}
        label="导出历史版本"
        align="end"
        initialFocus={() => panel.current?.querySelector('select')?.focus({ preventScroll: true })}
        onRequestClose={(reason) => {
          setAnchor(null);
          if (reason === 'escape') {
            anchor?.focus({ preventScroll: true });
          }
        }}
      >
        <div className="whiteboard-history-preview__export" ref={panel}>
          <Select
            label="导出范围"
            value={currentScope}
            disabled={busy}
            options={[
              { id: 'whole', label: '整张白板' },
              {
                id: 'selection',
                label: '所选对象 (' + selection.length + ')',
                disabled: selection.length === 0,
              },
            ]}
            onValueChange={(value) => setScope(value === 'selection' ? 'selection' : 'whole')}
          />
          <div className="whiteboard-history-preview__formats">
            {selectionFormats.map(([format, label]) => (
              <Button
                key={format}
                label={label}
                variant="ghost"
                disabled={busy}
                onActivate={() => handleExport(format)}
              />
            ))}
            <Button
              label="导出整板 HTML"
              variant="ghost"
              disabled={busy}
              onActivate={() => handleExport('html')}
            />
          </div>
        </div>
      </AnchoredPopover>
    </>
  );
}

export function VersionPreview({
  boardId,
  canEdit,
  scene,
  service,
  lifetime,
  restore,
  historyOpen,
  renderPreview,
  onExit,
  onRequestRestore,
  download,
}: VersionPreviewProps) {
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [restoreAnchor, setRestoreAnchor] = useState<HTMLButtonElement | null>(null);
  const exitButton = useRef<ButtonHandle>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => exitButton.current?.focus(), []);

  const exporting = useVersionExport({
    boardId,
    service,
    sourceRevision: scene.revision,
    download,
  });
  const restoring = restore.pending !== undefined;
  const busy = restoring || exporting.pending;
  const confirmation = canEdit ? restore.confirmation : undefined;

  function focusRestore() {
    restoreButton.current?.focus({ preventScroll: true });
  }

  function requestRestore(scope: ScopeKind) {
    setRestoreAnchor(null);
    onRequestRestore(scene.revision, actionScope(scope, selection), focusRestore);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const isEscape = event.key === 'Escape' && !event.defaultPrevented;
    if (isEscape && !confirmation) {
      event.preventDefault();
      onExit();
    }
  }

  const loadPayloads = useCallback(
    async (ids: readonly string[], signal?: AbortSignal) => {
      const combined = signal ? AbortSignal.any([signal, lifetime]) : lifetime;
      combined.throwIfAborted();
      const result = await service.getVersionPayloads(scene.boardId, scene.revision, ids, combined);
      combined.throwIfAborted();

      return result;
    },
    [lifetime, scene.boardId, scene.revision, service],
  );

  return (
    <section
      className="whiteboard-history-preview"
      aria-label="历史版本预览"
      onKeyDown={handleKeyDown}
    >
      <header className="whiteboard-history-preview__banner">
        <p className="whiteboard-history-preview__heading">
          <Clock3 size={16} aria-hidden="true" />
          <span>正在预览版本 {scene.revision.toString()}，当前白板未改变。</span>
        </p>
        <div className="whiteboard-history-preview__controls">
          <Button ref={exitButton} label="退出预览" variant="ghost" onActivate={onExit} />
          <VersionExportControl
            selection={selection}
            busy={busy}
            onExport={exporting.handleExport}
          />
          {canEdit && (
            <>
              <button
                ref={restoreButton}
                type="button"
                className="studio-ui-button"
                data-variant="primary"
                aria-haspopup={selection.length ? 'menu' : undefined}
                aria-expanded={selection.length ? restoreAnchor !== null : undefined}
                disabled={busy || Boolean(restore.recovery)}
                onClick={(event) => {
                  if (selection.length) {
                    setRestoreAnchor(restoreAnchor ? null : event.currentTarget);
                  } else {
                    requestRestore('whole');
                  }
                }}
              >
                <RotateCcw size={14} aria-hidden="true" />
                恢复此版本
                {selection.length > 0 && <ChevronDown size={12} aria-hidden="true" />}
              </button>
              <ActionMenu
                open={restoreAnchor !== null}
                anchor={restoreAnchor}
                label="恢复范围"
                items={[
                  { id: 'whole', label: '恢复整张白板' },
                  {
                    id: 'selection',
                    label: '恢复所选对象 (' + selection.length + ')',
                    disabled: selection.length === 0,
                  },
                ]}
                returnFocus={focusRestore}
                onAction={(value) => requestRestore(value === 'selection' ? 'selection' : 'whole')}
                onRequestClose={() => setRestoreAnchor(null)}
              />
            </>
          )}
        </div>
        {exporting.pending && <StatusText message="正在导出版本…" announcement="polite" busy />}
        {exporting.notice && (
          <div className="whiteboard-history-preview__notice">
            <StatusText
              message={exporting.notice.message}
              tone={exporting.notice.tone}
              announcement="polite"
            />
            {exporting.notice.retry && (
              <Button
                label={exporting.notice.retry.label}
                variant="ghost"
                disabled={busy}
                onActivate={exporting.notice.retry.onActivate}
              />
            )}
          </div>
        )}
        {!confirmation && !historyOpen && <RestoreRecovery restore={restore} canEdit={canEdit} />}
      </header>
      <div className="whiteboard-history-preview__canvas">
        {renderPreview({ scene, loadPayloads, selection, onSelectionChange: setSelection })}
      </div>
    </section>
  );
}
