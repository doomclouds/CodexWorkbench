import { Clock3, Download, RotateCcw } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ExportBoardScope, WhiteboardScene } from '../../data/whiteboard/index.js';
import { Button, Select, StatusText, type ButtonHandle } from '../../ui/base/index.js';
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
  const [scope, setScope] = useState<ScopeKind>('whole');
  const exitButton = useRef<ButtonHandle>(null);
  const restoreButton = useRef<ButtonHandle>(null);

  useLayoutEffect(() => exitButton.current?.focus(), []);

  const exporting = useVersionExport({
    boardId,
    service,
    sourceRevision: scene.revision,
    download,
  });
  const restoring = restore.pending !== undefined;
  const busy = restoring || exporting.pending;
  const emptySelection = scope === 'selection' && selection.length === 0;
  const unavailable = busy || emptySelection;
  const confirmation = canEdit ? restore.confirmation : undefined;

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
          <Button ref={exitButton} label="退出预览" onActivate={onExit} />
          {canEdit && (
            <Button
              ref={restoreButton}
              label="恢复此版本"
              icon={<RotateCcw size={14} />}
              variant="primary"
              disabled={unavailable || Boolean(restore.recovery)}
              onActivate={() =>
                onRequestRestore(scene.revision, actionScope(scope, selection), () =>
                  restoreButton.current?.focus(),
                )
              }
            />
          )}
          <Select
            label="操作范围"
            value={scope}
            disabled={busy}
            options={[
              { id: 'whole', label: '整张白板' },
              {
                id: 'selection',
                label: '所选对象 (' + selection.length + ')',
                disabled: !selection.length,
              },
            ]}
            onValueChange={(value) => setScope(value === 'selection' ? 'selection' : 'whole')}
          />
          <Button
            label="导出 JSON"
            icon={<Download size={14} />}
            disabled={unavailable}
            onActivate={() => exporting.handleExport('json', actionScope(scope, selection))}
          />
          <Button
            label="导出 SVG"
            disabled={unavailable}
            onActivate={() => exporting.handleExport('svg', actionScope(scope, selection))}
          />
          <Button
            label="导出 PNG"
            disabled={unavailable}
            onActivate={() => exporting.handleExport('png', actionScope(scope, selection))}
          />
          <Button
            label="导出整板 HTML"
            disabled={busy}
            onActivate={() => exporting.handleExport('html', { kind: 'whole' })}
          />
        </div>
        {exporting.pending && <StatusText message="正在导出版本…" announcement="polite" busy />}
        {exporting.notice && (
          <StatusText
            message={exporting.notice.message}
            tone={exporting.notice.tone}
            announcement="polite"
          />
        )}
        {!confirmation && !historyOpen && <RestoreRecovery restore={restore} canEdit={canEdit} />}
      </header>
      <div className="whiteboard-history-preview__canvas">
        {renderPreview({ scene, loadPayloads, selection, onSelectionChange: setSelection })}
      </div>
    </section>
  );
}
