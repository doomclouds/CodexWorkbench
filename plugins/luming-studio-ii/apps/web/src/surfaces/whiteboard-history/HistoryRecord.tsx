import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { BoardHistoryVersion } from '../../data/whiteboard/index.js';

interface HistoryRecordProps {
  readonly entry: BoardHistoryVersion;
  readonly expanded: boolean;
  readonly previewed: boolean;
  readonly current: boolean;
  readonly controls: ReactNode;
  readonly onToggle: () => void;
}

const versionLabels = {
  baseline: '初始快照',
  geometry: '对象操作',
  content: '正文编辑',
  image: '插入图片',
  restore: '恢复版本',
};

const savedAtFormat = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' });

export function HistoryRecord({
  entry,
  expanded,
  previewed,
  current,
  controls,
  onToggle,
}: HistoryRecordProps) {
  const { revision, savedAtMillis, actorId, kind, changedObjectCount, sourceRevision } = entry;
  const boardTitle = (current || kind === 'baseline') && entry.title.trim();
  const savedAt = savedAtMillis === undefined ? undefined : new Date(savedAtMillis);
  const actor = actorId || (kind === 'baseline' ? '' : '协作者');
  const avatar = actor || boardTitle || '白板';

  return (
    <article
      className="whiteboard-history__record"
      data-expanded={expanded || undefined}
      data-previewed={previewed || undefined}
    >
      <button
        className="whiteboard-history__record-button"
        type="button"
        aria-label={'展开版本 ' + revision}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="whiteboard-history__avatar" aria-hidden="true">
          {avatar.slice(0, 1)}
        </span>
        <span className="whiteboard-history__record-body">
          <span className="whiteboard-history__record-top">
            {actor && <strong title={actor}>{actor}</strong>}
            {savedAt && (
              <time dateTime={savedAt.toISOString()}>{savedAtFormat.format(savedAt)}</time>
            )}
          </span>
          <span className="whiteboard-history__record-summary">
            {versionLabels[kind]}
            {changedObjectCount > 0 && <> · {changedObjectCount} 个对象</>}
          </span>
          {boardTitle && (
            <span className="whiteboard-history__record-title" title={boardTitle}>
              {boardTitle}
            </span>
          )}
          {current && <span className="whiteboard-history__current">当前版本</span>}
          {sourceRevision !== undefined && (
            <span className="whiteboard-history__restored">
              从版本 {sourceRevision.toString()} 恢复
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
      </button>
      {expanded && <div className="whiteboard-history__record-details">{controls}</div>}
    </article>
  );
}
