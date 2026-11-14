import { useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Clock3, Loader2, RefreshCw } from 'lucide-react';
import type { Actor, HistoryEntry } from '../../../contracts/studio';
import './editor-panels.css';

export interface HistoryGroup { key: string; label: string; entries: HistoryEntry[] }
export interface HistoryPanelProps {
  history: HistoryEntry[];
  currentRevision: number;
  actor: Actor;
  loading?: boolean;
  busy?: boolean;
  previewId?: string;
  canRestore: boolean;
  onRefresh: () => void;
  onPreview: (entry: HistoryEntry) => void;
  onRestore: (entry: HistoryEntry) => void;
  onInspectChange?: (entry: HistoryEntry, id: string) => void;
  onReturnToCurrent?: () => void;
}

function dayKey(date: Date): string { return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
export function groupHistoryByDate(history: HistoryEntry[], now = new Date()): HistoryGroup[] {
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, HistoryGroup>();
  for (const entry of [...history].sort((a, b) => b.revision - a.revision)) {
    const date = new Date(entry.createdAt), valid = Number.isFinite(date.getTime()), key = valid ? dayKey(date) : 'unknown';
    let group = groups.get(key);
    if (!group) {
      const label = !valid ? '日期未知' : key === dayKey(now) ? '今天' : key === dayKey(yesterday) ? '昨天' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      group = { key, label, entries: [] }; groups.set(key, group);
    }
    group.entries.push(entry);
  }
  return [...groups.values()];
}

export function HistoryPanel({ history, currentRevision, actor, loading = false, busy = false, previewId, canRestore, onRefresh, onPreview, onRestore, onInspectChange, onReturnToCurrent }: HistoryPanelProps) {
  const [expandedId, setExpandedId] = useState('');
  return <div className="studio-history-panel">
    <div className="studio-editor-panel-tools"><span>每次修改都留下记录</span><button type="button" className="studio-link-button" onClick={onRefresh} disabled={loading || busy}><RefreshCw size={13} className={loading ? 'studio-spin' : ''} />刷新</button></div>
    {previewId && onReturnToCurrent && <button type="button" className="studio-button studio-full-width studio-compact" disabled={busy} onClick={onReturnToCurrent}>返回当前版本</button>}
    {loading && !history.length && <div className="studio-editor-panel-empty" role="status"><Loader2 className="studio-spin" size={22} /><span>正在加载历史记录…</span></div>}
    {!loading && !history.length && <div className="studio-editor-panel-empty"><Clock3 size={25} /><span>还没有历史记录</span></div>}
    {groupHistoryByDate(history).map(group => <section className="studio-history-group" key={group.key} aria-label={group.label}>
      <h3>{group.label}</h3>
      {group.entries.map(entry => {
        const expanded = entry.id === expandedId, current = entry.revision === currentRevision, self = entry.actor.id === actor.id && entry.actor.kind === actor.kind;
        const stamp = new Date(entry.createdAt), time = Number.isFinite(stamp.getTime()) ? stamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
        return <article className={`studio-history-record${expanded ? ' is-expanded' : ''}${entry.id === previewId ? ' is-previewed' : ''}`} key={entry.id}>
          <button type="button" className="studio-history-record-heading" aria-expanded={expanded} aria-label={`展开版本 ${entry.revision}`} onClick={() => setExpandedId(expanded ? '' : entry.id)}>
            <span className={`studio-editor-avatar${entry.actor.kind === 'agent' ? ' is-agent' : ''}`} aria-hidden="true">{entry.actor.kind === 'agent' ? <Bot size={17} /> : (entry.actor.name || '协').slice(0, 1)}</span>
            <span className="studio-history-record-text"><span className="studio-history-record-author"><strong>{entry.actor.name || (entry.actor.kind === 'agent' ? 'Agent' : '协作者')}{self ? '（你）' : ''}</strong><time dateTime={entry.createdAt}>{time}</time></span><span className="studio-history-summary">{entry.summary || '作品更新'}</span>{current && <span className="studio-history-current">当前版本</span>}{entry.restoredFrom && <span className="studio-history-restored">从历史版本恢复</span>}</span>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {expanded && <div className="studio-history-record-details">
            {[...new Set(entry.changedIds)].map(id => <div className="studio-history-change" key={id}><span>变更</span><span title={id}>元素 · {id}</span>{onInspectChange && <button type="button" className="studio-link-button" disabled={busy} onClick={() => onInspectChange(entry, id)}>看改动</button>}</div>)}
            {!entry.changedIds.length && <p className="studio-editor-panel-note">此版本没有对象级变更记录。</p>}
            <div className="studio-history-version-actions"><small>版本 {entry.revision}</small>{!current && <button type="button" className="studio-link-button" disabled={busy} onClick={() => onPreview(entry)}>{previewId === entry.id ? '正在预览' : '预览版本'}</button>}{canRestore && !current && <button type="button" className="studio-link-button" disabled={busy} onClick={() => onRestore(entry)}>恢复为新版本</button>}</div>
          </div>}
        </article>;
      })}
    </section>)}
  </div>;
}
