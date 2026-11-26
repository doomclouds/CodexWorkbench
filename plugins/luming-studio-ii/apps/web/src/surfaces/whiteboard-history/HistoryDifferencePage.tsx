import { ArrowLeft, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  BoardHistoryService,
  BoardHistoryVersion,
  WhiteboardPayload,
} from '../../data/whiteboard/index.js';
import { StatusText } from '../../ui/base/index.js';
import { diffHistoryText, historyTexts } from './history-difference.js';
import { changeLabel, type HistoryChange } from './history-records.js';

interface HistoryDifferencePageProps {
  readonly version: BoardHistoryVersion;
  readonly previousRevision: bigint;
  readonly change: HistoryChange;
  readonly boardId: string;
  readonly service: BoardHistoryService;
  readonly canRestore: boolean;
  readonly busy: boolean;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onRestore: (trigger: HTMLElement) => void;
}

interface DifferenceBodies {
  readonly before?: WhiteboardPayload;
  readonly after?: WhiteboardPayload;
  readonly error?: string;
}

const recordDateFormat = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function getPayload(
  service: BoardHistoryService,
  boardId: string,
  revision: bigint,
  objectId: string,
  signal: AbortSignal,
) {
  return service.getVersionPayloads(boardId, revision, [objectId], signal).then(([result]) => {
    if (result?.kind !== 'loaded') {
      throw new Error('此版的对象正文已不可用。');
    }

    return result.payload;
  });
}

function useDifferenceBodies({
  service,
  boardId,
  previousRevision,
  version: { revision },
  change,
}: HistoryDifferencePageProps) {
  const [bodies, setBodies] = useState<DifferenceBodies>();
  const beforePayload = change.before?.payloadVersion;
  const afterPayload = change.after?.payloadVersion;
  const changed = beforePayload !== afterPayload;
  useEffect(() => {
    if (!changed) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    const read = (sourceRevision: bigint, payloadVersion?: bigint) =>
      payloadVersion === undefined
        ? undefined
        : getPayload(service, boardId, sourceRevision, change.id, signal);
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return Promise.all([read(previousRevision, beforePayload), read(revision, afterPayload)]);
      })
      .then(([before, after]) => {
        signal.throwIfAborted();
        setBodies({ before, after });
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          const detail = error instanceof Error ? ' ' + error.message : '';
          setBodies({ error: '部分正文无法读取，仅显示可用的对象属性。' + detail });
        }
      });

    return () => controller.abort();
  }, [
    changed,
    beforePayload,
    afterPayload,
    service,
    boardId,
    previousRevision,
    revision,
    change.id,
  ]);

  return { bodies, loading: changed && !bodies };
}

export function HistoryDifferencePage(props: HistoryDifferencePageProps) {
  const { version, change, canRestore, busy, onBack, onClose, onRestore } = props;
  const backButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => backButton.current?.focus({ preventScroll: true }), []);
  const { bodies, loading } = useDifferenceBodies(props);
  const diff = useMemo(
    () => diffHistoryText(...historyTexts(change, bodies?.before, bodies?.after)),
    [change, bodies?.before, bodies?.after],
  );
  const unchanged = diff.added === 0 && diff.removed === 0;
  const summary = diff.large ? '内容较大，无法在这里展开逐行差异。' : undefined;
  const savedAt =
    version.savedAtMillis === undefined
      ? undefined
      : recordDateFormat.format(version.savedAtMillis);

  return (
    <section className="whiteboard-history__difference">
      <header className="whiteboard-history__difference-heading">
        <button
          type="button"
          ref={backButton}
          className="whiteboard-history__icon"
          aria-label="返回版本历史"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <h2 title={changeLabel(change)}>{changeLabel(change)}</h2>
        <span className="whiteboard-history__diff-added" aria-label="新增行数">
          +{diff.added}
        </span>
        <span className="whiteboard-history__diff-removed" aria-label="删除行数">
          −{diff.removed}
        </span>
        <button
          type="button"
          className="whiteboard-history__icon"
          aria-label="关闭版本历史"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <p className="whiteboard-history__difference-meta">
        {version.actorId || '协作者'}
        {savedAt && ' · ' + savedAt}
      </p>
      {canRestore && (
        <button
          type="button"
          className="studio-ui-button whiteboard-history__restore-unit"
          disabled={busy}
          onClick={(event) => onRestore(event.currentTarget)}
        >
          只恢复这一处
        </button>
      )}
      {loading ? (
        <StatusText message="正在加载改动…" announcement="polite" busy />
      ) : (
        <>
          {bodies?.error && (
            <StatusText message={bodies.error} announcement="polite" tone="error" />
          )}
          {summary && <p className="whiteboard-history__note">{summary}</p>}
          {!summary && unchanged && !bodies?.error && (
            <p className="whiteboard-history__note">保留的内容相同。</p>
          )}
          {!summary && !unchanged && (
            <div className="whiteboard-history__diff-lines" aria-label="逐行改动">
              {diff.lines.map((line, index) =>
                line.kind === 'skip' ? (
                  <div className="whiteboard-history__diff-skip" key={index}>
                    跳过 {line.text} 行
                  </div>
                ) : (
                  <div className="whiteboard-history__diff-line" data-kind={line.kind} key={index}>
                    <span aria-hidden="true">{line.kind}</span>
                    <code>{line.text || ' '}</code>
                  </div>
                ),
              )}
            </div>
          )}
          {diff.truncated && (
            <p className="whiteboard-history__note">差异较长，仅显示前 3000 行。</p>
          )}
        </>
      )}
    </section>
  );
}
