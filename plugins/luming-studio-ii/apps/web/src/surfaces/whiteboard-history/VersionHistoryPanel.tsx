import { ChevronDown, Clock3, Loader2, RefreshCw, X } from 'lucide-react';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import type {
  BoardHistoryPage,
  BoardHistoryService,
  BoardHistoryVersion,
  ExportBoardScope,
  WhiteboardScene,
} from '../../data/whiteboard/index.js';
import { AnchoredPopover, Button, StatusText } from '../../ui/base/index.js';
import { HistoryDifferencePage } from './HistoryDifferencePage.js';
import { HistoryRecord } from './HistoryRecord.js';
import {
  changeKind,
  changeLabel,
  groupHistoryByDate,
  historyChanges,
  isBoardCreation,
  type HistoryChange,
} from './history-records.js';

interface VersionHistoryPanelProps {
  readonly anchor: HTMLElement;
  readonly boardId: string;
  readonly revision: bigint;
  readonly previewRevision?: bigint;
  readonly service: BoardHistoryService;
  readonly recovery?: ReactNode;
  readonly canRestore: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onPreview: (scene: WhiteboardScene, trigger: HTMLButtonElement) => void;
  readonly onReturnToCurrent: () => void;
  readonly onRequestRestore: (
    revision: bigint,
    scope: ExportBoardScope,
    restoreFocus: () => void,
  ) => void;
}

interface RetainedChanges {
  readonly previousRevision: bigint;
  readonly changes: readonly HistoryChange[];
}

type ChangesState =
  | { readonly kind: 'creation' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'error'; readonly message: string }
  | ({ readonly kind: 'ready' } & RetainedChanges);

type VersionListState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'loading'; readonly before?: bigint }
  | { readonly kind: 'error'; readonly before?: bigint; readonly message: string };

interface Inspection {
  readonly entry: BoardHistoryVersion;
  readonly previousRevision: bigint;
  readonly change: HistoryChange;
}

const changePageSize = 30;
const noVersions: readonly BoardHistoryVersion[] = [];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function refreshVersions(
  service: BoardHistoryService,
  boardId: string,
  before: bigint | undefined,
  oldestLoaded: bigint | undefined,
  signal: AbortSignal,
): Promise<BoardHistoryPage> {
  const first = await service.listVersions(boardId, before, signal);
  if (
    before !== undefined &&
    first.nextBeforeRevision !== undefined &&
    first.nextBeforeRevision >= before
  ) {
    throw new Error('版本历史未能继续加载。');
  }
  if (before !== undefined || oldestLoaded === undefined) {
    return first;
  }

  const versions = [...first.versions];
  let cursor = first.nextBeforeRevision;
  while (cursor !== undefined && cursor > oldestLoaded) {
    signal.throwIfAborted();
    const next = await service.listVersions(boardId, cursor, signal);
    if (next.nextBeforeRevision !== undefined && next.nextBeforeRevision >= cursor) {
      throw new Error('版本历史未能继续加载。');
    }

    versions.push(...next.versions);
    cursor = next.nextBeforeRevision;
  }

  return { ...first, versions, nextBeforeRevision: cursor };
}

async function retainedChanges(
  { service, boardId }: Pick<VersionHistoryPanelProps, 'service' | 'boardId'>,
  page: BoardHistoryPage,
  entry: BoardHistoryVersion,
  signal: AbortSignal,
): Promise<RetainedChanges | undefined> {
  const index = page.versions.indexOf(entry);
  const preceding = page.versions[index + 1]?.revision;
  const earlier =
    preceding === undefined && page.nextBeforeRevision !== undefined
      ? (await service.listVersions(boardId, entry.revision, signal)).versions[0]?.revision
      : preceding;
  signal.throwIfAborted();
  if (earlier === undefined) {
    return;
  }

  const [before, after] = await Promise.all([
    service.getVersionScene(boardId, earlier, signal),
    service.getVersionScene(boardId, entry.revision, signal),
  ]);
  signal.throwIfAborted();

  return before && after
    ? { previousRevision: earlier, changes: historyChanges(before, after) }
    : undefined;
}

function ChangeRows({
  retained,
  visible,
  onMore,
  onInspect,
}: {
  readonly retained: RetainedChanges;
  readonly visible: number;
  readonly onMore: () => void;
  readonly onInspect: (change: HistoryChange, previousRevision: bigint) => void;
}) {
  const { changes, previousRevision } = retained;
  if (!changes.length) {
    return <p className="whiteboard-history__note">此版没有保留的对象变化。</p>;
  }

  return (
    <>
      {changes.slice(0, visible).map((change) => (
        <div className="whiteboard-history__change" key={change.id}>
          <span data-kind={changeKind(change)}>{changeKind(change)}</span>
          <span title={changeLabel(change)}>{changeLabel(change)}</span>
          <button
            type="button"
            data-history-change={change.id}
            className="whiteboard-history__link"
            onClick={() => onInspect(change, previousRevision)}
          >
            看改动
          </button>
        </div>
      ))}
      {visible < changes.length && (
        <button type="button" className="whiteboard-history__link" onClick={onMore}>
          显示更多改动
        </button>
      )}
    </>
  );
}

function RecordChanges({
  state,
  visible,
  onMore,
  onRetry,
  onInspect,
}: {
  readonly state?: ChangesState;
  readonly visible: number;
  readonly onMore: () => void;
  readonly onRetry: () => void;
  readonly onInspect: (change: HistoryChange, previousRevision: bigint) => void;
}) {
  switch (state?.kind) {
    case 'creation':
      return <p className="whiteboard-history__note">此时段没有保留的内容变化。</p>;
    case 'loading':
      return <StatusText message="正在加载改动…" announcement="polite" busy />;
    case 'error':
      return (
        <div className="whiteboard-history__load-error">
          <StatusText message={state.message} tone="error" announcement="polite" />
          <button type="button" className="whiteboard-history__link" onClick={onRetry}>
            重试
          </button>
        </div>
      );
    case 'unavailable':
      return <p className="whiteboard-history__note">此前版次不可用，无法查看相邻改动。</p>;
    case 'ready':
      return (
        <ChangeRows retained={state} visible={visible} onMore={onMore} onInspect={onInspect} />
      );
    case undefined:
      return null;
  }
}

function HistoryPanelHeading({
  closeRef,
  loading,
  busy,
  previewing,
  onClose,
  onRefresh,
  onReturnToCurrent,
}: {
  readonly closeRef: Ref<HTMLButtonElement>;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly previewing: boolean;
  readonly onClose: () => void;
  readonly onRefresh: () => void;
  readonly onReturnToCurrent: () => void;
}) {
  return (
    <>
      <header className="whiteboard-history__heading">
        <h2>版本历史</h2>
        <button
          type="button"
          ref={closeRef}
          className="whiteboard-history__icon"
          aria-label="关闭版本历史"
          title="关闭版本历史"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="whiteboard-history__tools">
        <span>每次修改都留下记录</span>
        <button
          type="button"
          className="whiteboard-history__link"
          disabled={loading || busy}
          onClick={onRefresh}
        >
          <RefreshCw size={13} className={loading ? 'whiteboard-history__spin' : undefined} />
          刷新
        </button>
      </div>
      {previewing && (
        <div className="whiteboard-history__return">
          <Button label="返回当前版本" onActivate={onReturnToCurrent} />
        </div>
      )}
    </>
  );
}

function VersionListStatus({
  state,
  empty,
  previewError,
  loadingRevision,
}: {
  readonly state: VersionListState;
  readonly empty: boolean;
  readonly previewError?: string;
  readonly loadingRevision?: bigint;
}) {
  return (
    <>
      {state.kind === 'error' && state.before === undefined && (
        <StatusText message={state.message} tone="error" announcement="polite" />
      )}
      {previewError && <StatusText message={previewError} tone="error" announcement="polite" />}
      {loadingRevision !== undefined && (
        <StatusText message={'正在打开版本 ' + loadingRevision + '…'} announcement="polite" busy />
      )}
      {empty && state.kind === 'loading' && (
        <div className="whiteboard-history__empty" role="status">
          <Loader2 size={22} className="whiteboard-history__spin" />
          <span>正在加载历史记录…</span>
        </div>
      )}
      {empty && state.kind === 'ready' && (
        <div className="whiteboard-history__empty">
          <Clock3 size={25} />
          <span>还没有历史记录</span>
        </div>
      )}
    </>
  );
}

function OlderVersionsFooter({
  state,
  cursor,
  busy,
  buttonRef,
  onLoad,
}: {
  readonly state: VersionListState;
  readonly cursor?: bigint;
  readonly busy: boolean;
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly onLoad: (before: bigint) => void;
}) {
  if (cursor === undefined) {
    return null;
  }

  const unavailable = busy || state.kind === 'loading';
  const loadingOlder = state.kind === 'loading' && state.before !== undefined;
  const error = state.kind === 'error' && state.before !== undefined ? state.message : undefined;
  const action = error ? '重试加载更早版本' : '加载更早版本';

  function handleLoad() {
    if (!unavailable && cursor !== undefined) {
      onLoad(cursor);
    }
  }

  return (
    <footer className="whiteboard-history__footer">
      {error && <StatusText message={error} tone="error" announcement="polite" />}
      <button
        type="button"
        ref={buttonRef}
        className="whiteboard-history__older"
        aria-busy={loadingOlder || undefined}
        aria-disabled={unavailable || undefined}
        onClick={handleLoad}
      >
        {loadingOlder ? (
          <Loader2 size={14} className="whiteboard-history__spin" aria-hidden="true" />
        ) : (
          <ChevronDown size={14} aria-hidden="true" />
        )}
        {loadingOlder ? '正在加载更早版本…' : action}
      </button>
    </footer>
  );
}

export function VersionHistoryPanel({
  anchor,
  boardId,
  revision,
  previewRevision,
  service,
  recovery,
  canRestore,
  busy,
  onClose,
  onPreview,
  onReturnToCurrent,
  onRequestRestore,
}: VersionHistoryPanelProps) {
  const [page, setPage] = useState<BoardHistoryPage>();
  const [versionList, setVersionList] = useState<VersionListState>({ kind: 'loading' });
  const [loadingRevision, setLoadingRevision] = useState<bigint>();
  const [previewError, setPreviewError] = useState<string>();
  const [expanded, setExpanded] = useState<bigint>();
  const [changes, setChanges] = useState<ChangesState>();
  const [inspection, setInspection] = useState<Inspection>();
  const [visibleChanges, setVisibleChanges] = useState(changePageSize);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const olderButton = useRef<HTMLButtonElement>(null);
  const focusOlderRevision = useRef<bigint>(undefined);
  const returningChange = useRef<string>(undefined);
  const recordsScroll = useRef(0);
  const pendingList = useRef<AbortController>(undefined);
  const pendingSelection = useRef<AbortController>(undefined);
  const pendingChanges = useRef<AbortController>(undefined);

  const loadInitialPage = useEffectEvent(() => handleLoadPage());
  useEffect(() => loadInitialPage(), [revision]);
  useEffect(
    () => () => {
      pendingList.current?.abort();
      pendingSelection.current?.abort();
      pendingChanges.current?.abort();
    },
    [],
  );

  function handleLoadPage(before?: bigint) {
    if (before !== undefined && pendingList.current) {
      return;
    }

    pendingList.current?.abort();
    const controller = new AbortController();
    const { signal } = controller;
    pendingList.current = controller;
    setVersionList({ kind: 'loading', before });
    const oldestLoaded = page?.versions.at(-1)?.revision;

    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return refreshVersions(service, boardId, before, oldestLoaded, signal);
      })
      .then((result) => {
        signal.throwIfAborted();
        const footer = olderButton.current;
        if (
          before !== undefined &&
          result.nextBeforeRevision === undefined &&
          footer?.ownerDocument.activeElement === footer
        ) {
          focusOlderRevision.current = result.versions[0]?.revision;
        }
        setPage((prior) =>
          before !== undefined && prior
            ? { ...result, versions: [...prior.versions, ...result.versions] }
            : result,
        );
        setVersionList({ kind: 'ready' });
      })
      .catch((cause: unknown) => {
        if (!signal.aborted) {
          setVersionList({
            kind: 'error',
            before,
            message: errorMessage(cause, '版本历史未能加载。'),
          });
        }
      })
      .finally(() => {
        if (pendingList.current === controller && !signal.aborted) {
          pendingList.current = undefined;
        }
      });
  }

  function loadChanges(entry: BoardHistoryVersion) {
    pendingChanges.current?.abort();
    if (isBoardCreation(entry)) {
      setChanges({ kind: 'creation' });
      return;
    }
    if (!page) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    pendingChanges.current = controller;
    setChanges({ kind: 'loading' });
    retainedChanges({ service, boardId }, page, entry, signal)
      .then((result) => {
        signal.throwIfAborted();
        setChanges(result ? { kind: 'ready', ...result } : { kind: 'unavailable' });
      })
      .catch((cause: unknown) => {
        if (!signal.aborted) {
          setChanges({ kind: 'error', message: errorMessage(cause, '版本改动未能加载。') });
        }
      });
  }

  function handleToggleRecord(entry: BoardHistoryVersion) {
    if (entry.revision === expanded) {
      pendingChanges.current?.abort();
      setExpanded(undefined);
    } else {
      setExpanded(entry.revision);
      setVisibleChanges(changePageSize);
      loadChanges(entry);
    }
  }

  function handlePreview(revisionToOpen: bigint, trigger: HTMLButtonElement) {
    pendingSelection.current?.abort();
    const controller = new AbortController();
    const { signal } = controller;
    pendingSelection.current = controller;
    setLoadingRevision(revisionToOpen);
    setPreviewError(undefined);

    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return service.getVersionScene(boardId, revisionToOpen, signal);
      })
      .then((scene) => {
        signal.throwIfAborted();
        if (!scene) {
          throw new Error('所选版本已无法预览，请刷新版本历史。');
        }

        onPreview(scene, trigger);
      })
      .catch((cause: unknown) => {
        if (!signal.aborted) {
          setPreviewError(errorMessage(cause, '历史版本未能打开。'));
        }
      })
      .finally(() => {
        if (pendingSelection.current === controller && !signal.aborted) {
          pendingSelection.current = undefined;
          setLoadingRevision(undefined);
        }
      });
  }

  function handleClose() {
    pendingSelection.current?.abort();
    pendingList.current?.abort();
    pendingChanges.current?.abort();
    onClose();
  }

  function handleReturnToCurrent() {
    pendingSelection.current?.abort();
    pendingSelection.current = undefined;
    setLoadingRevision(undefined);
    onReturnToCurrent();
  }

  function handleReturnFromInspection() {
    returningChange.current = inspection?.change.id;
    setInspection(undefined);
  }

  useLayoutEffect(() => {
    const section = panel.current;
    if (!section) {
      return;
    }

    if (inspection) {
      section.scrollTop = 0;
      return;
    }

    if (returningChange.current === undefined) {
      return;
    }

    section.scrollTop = recordsScroll.current;
    const candidates = section.querySelectorAll<HTMLButtonElement>('[data-history-change]');
    const trigger = Array.from(candidates).find(
      (button) => button.dataset.historyChange === returningChange.current,
    );
    returningChange.current = undefined;
    (trigger ?? closeButton.current)?.focus({ preventScroll: true });
  }, [inspection]);

  useLayoutEffect(() => {
    const targetRevision = focusOlderRevision.current;
    if (targetRevision !== undefined) {
      focusOlderRevision.current = undefined;
      panel.current
        ?.querySelector<HTMLButtonElement>(`[aria-label="展开版本 ${targetRevision}"]`)
        ?.focus({ preventScroll: true });
    }
  }, [page]);

  function focusOnTrigger(trigger: HTMLElement) {
    const canFocusButton = trigger.isConnected && !trigger.matches(':disabled');
    (canFocusButton ? trigger : anchor).focus({ preventScroll: true });
  }

  const current = page && page.currentRevision > revision ? page.currentRevision : revision;
  const cursor = page?.nextBeforeRevision;
  const versions = page?.versions ?? noVersions;

  function renderRecord(entry: BoardHistoryVersion) {
    const isCurrent = entry.revision === current;
    const previewed = entry.revision === previewRevision;

    return (
      <HistoryRecord
        key={entry.revision.toString()}
        entry={entry}
        expanded={entry.revision === expanded}
        current={isCurrent}
        previewed={previewed}
        onToggle={() => handleToggleRecord(entry)}
        controls={
          <>
            <RecordChanges
              state={changes}
              visible={visibleChanges}
              onMore={() => setVisibleChanges((count) => count + changePageSize)}
              onRetry={() => loadChanges(entry)}
              onInspect={(change, previousRevision) => {
                recordsScroll.current = panel.current?.scrollTop ?? 0;
                setInspection({ entry, previousRevision, change });
              }}
            />
            <div className="whiteboard-history__version-actions">
              <small>版本 {entry.revision.toString()}</small>
              {!isCurrent && (
                <button
                  type="button"
                  className="whiteboard-history__link"
                  disabled={previewed || busy || loadingRevision === entry.revision}
                  onClick={(event) => handlePreview(entry.revision, event.currentTarget)}
                >
                  {previewed ? '正在预览' : '预览版本'}
                </button>
              )}
              {canRestore && !isCurrent && (
                <button
                  type="button"
                  className="whiteboard-history__link"
                  disabled={busy}
                  onClick={(event) => {
                    const trigger = event.currentTarget;
                    onRequestRestore(entry.revision, { kind: 'whole' }, () =>
                      focusOnTrigger(trigger),
                    );
                  }}
                >
                  恢复为新版本
                </button>
              )}
            </div>
          </>
        }
      />
    );
  }

  return (
    <AnchoredPopover
      open
      anchor={anchor}
      label="版本历史面板"
      placement="bottom"
      align="end"
      initialFocus={() => closeButton.current?.focus({ preventScroll: true })}
      restoreFocus={() => anchor.focus({ preventScroll: true })}
      onRequestClose={(reason) => {
        if (reason === 'escape' && previewRevision !== undefined) {
          handleReturnToCurrent();
        } else {
          handleClose();
        }
      }}
    >
      <section className="whiteboard-history" ref={panel}>
        {inspection ? (
          <>
            <HistoryDifferencePage
              key={inspection.entry.revision.toString() + ':' + inspection.change.id}
              version={inspection.entry}
              previousRevision={inspection.previousRevision}
              change={inspection.change}
              boardId={boardId}
              service={service}
              canRestore={canRestore && inspection.entry.revision !== current}
              busy={busy}
              onBack={handleReturnFromInspection}
              onClose={handleClose}
              onRestore={(trigger) =>
                onRequestRestore(
                  inspection.entry.revision,
                  { kind: 'selection', objectIds: [inspection.change.id] },
                  () => focusOnTrigger(trigger),
                )
              }
            />
            {recovery}
          </>
        ) : (
          <>
            <HistoryPanelHeading
              closeRef={closeButton}
              loading={versionList.kind === 'loading'}
              busy={busy}
              previewing={previewRevision !== undefined}
              onClose={handleClose}
              onRefresh={() => handleLoadPage()}
              onReturnToCurrent={handleReturnToCurrent}
            />
            {recovery}
            <VersionListStatus
              state={versionList}
              empty={versions.length === 0}
              previewError={previewError}
              loadingRevision={loadingRevision}
            />
            {groupHistoryByDate(versions).map(({ key, label, entries }) => (
              <section className="whiteboard-history__group" key={key} aria-label={label}>
                <h3>{label}</h3>
                {entries.map(renderRecord)}
              </section>
            ))}
            <OlderVersionsFooter
              state={versionList}
              cursor={cursor}
              busy={busy}
              buttonRef={olderButton}
              onLoad={handleLoadPage}
            />
          </>
        )}
      </section>
    </AnchoredPopover>
  );
}
