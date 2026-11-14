import { useState } from 'react';
import { Bot, ChevronDown, ChevronRight, Clock3, Loader2, RefreshCw, X } from 'lucide-react';
import type { Actor, HistoryBatch, HistoryEntry } from '../../../contracts/studio';
import { StudioDialog } from '../../products/dialog';
import { HistoryDifferencePage } from './HistoryDifferencePage';
import { historyChangeKind, historyUnitLabel, type HistoryUnitDiff } from './history-diff';
import './editor-panels.css';

export interface HistoryGroup<Entry extends HistoryEntry = HistoryEntry> { key: string; label: string; entries: Entry[] }
export interface HistoryPanelProps {
  history: HistoryBatch[];
  currentRevision: number;
  actor: Actor;
  loading?: boolean;
  busy?: boolean;
  previewId?: string;
  canRestore: boolean;
  onRefresh: () => void;
  onPreview: (entry: HistoryBatch) => void;
  onRestore: (entry: HistoryBatch, unitId?: string) => Promise<boolean>;
  onLoadChanges: (entry: HistoryBatch) => Promise<HistoryUnitDiff[]>;
  onReturnToCurrent?: () => void;
  onClose?: () => void;
}

function dayKey(date: Date): string { return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
export function groupHistoryByDate<Entry extends HistoryEntry>(history: Entry[], now = new Date()): HistoryGroup<Entry>[] {
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, HistoryGroup<Entry>>();
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

function clock(value: string): string { const stamp = new Date(value); return Number.isFinite(stamp.getTime()) ? stamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''; }
type Changes = { loading: boolean; units?: HistoryUnitDiff[]; error?: string };

export function HistoryPanel({ history, currentRevision, actor, loading = false, busy = false, previewId, canRestore, onRefresh, onPreview, onRestore, onLoadChanges, onReturnToCurrent, onClose }: HistoryPanelProps) {
  const [expandedId, setExpandedId] = useState(''), [changes, setChanges] = useState<Record<string, Changes>>({});
  const [inspection, setInspection] = useState<{ entry: HistoryBatch; change: HistoryUnitDiff } | null>(null);
  const [confirmation, setConfirmation] = useState<{ entry: HistoryBatch; unitId?: string } | null>(null), [restoring, setRestoring] = useState(false);
  async function load(entry: HistoryBatch, force = false) {
    if (!force && (changes[entry.id]?.units || changes[entry.id]?.loading)) return;
    setChanges(previous => ({ ...previous, [entry.id]: { loading: true } }));
    try { const units = await onLoadChanges(entry); setChanges(previous => ({ ...previous, [entry.id]: { loading: false, units } })); }
    catch (cause) { setChanges(previous => ({ ...previous, [entry.id]: { loading: false, error: cause instanceof Error ? cause.message : String(cause) } })); }
  }
  async function restore() {
    if (!confirmation || restoring || busy) return;
    setRestoring(true);
    try { if (await onRestore(confirmation.entry, confirmation.unitId)) { setConfirmation(null); setInspection(null); } }
    finally { setRestoring(false); }
  }
  return <div className="studio-history-panel">
    {inspection ? <HistoryDifferencePage {...inspection} canRestore={canRestore && inspection.entry.revision !== currentRevision} busy={busy || restoring} onBack={() => setInspection(null)} onClose={onClose} onRestore={() => setConfirmation({ entry: inspection.entry, unitId: inspection.change.id })} /> : <>
      <div className="studio-editor-popover-heading"><h2>版本历史</h2>{onClose && <button type="button" className="studio-icon-button" aria-label="关闭版本历史" onClick={onClose}><X size={18} /></button>}</div>
      <div className="studio-editor-panel-tools"><span>每次修改都留下记录</span><button type="button" className="studio-link-button" onClick={onRefresh} disabled={loading || busy}><RefreshCw size={13} className={loading ? 'studio-spin' : ''} />刷新</button></div>
      {previewId && onReturnToCurrent && <button type="button" className="studio-button studio-full-width studio-compact" disabled={busy} onClick={onReturnToCurrent}>返回当前版本</button>}
      {loading && !history.length && <div className="studio-editor-panel-empty" role="status"><Loader2 className="studio-spin" size={22} /><span>正在加载历史记录…</span></div>}
      {!loading && !history.length && <div className="studio-editor-panel-empty"><Clock3 size={25} /><span>还没有历史记录</span></div>}
      {groupHistoryByDate(history).map(group => <section className="studio-history-group" key={group.key} aria-label={group.label}><h3>{group.label}</h3>{group.entries.map(entry => {
        const expanded = entry.id === expandedId, current = entry.revision === currentRevision, self = entry.actor.id === actor.id && entry.actor.kind === actor.kind;
        const first = clock(entry.firstCreatedAt), last = clock(entry.createdAt), time = first && first !== last ? `${first}–${last}` : last;
        const state = changes[entry.id], revisionLabel = entry.firstRevision === entry.revision ? `版本 ${entry.revision}` : `版本 ${entry.firstRevision}–${entry.revision}`;
        return <article className={`studio-history-record${expanded ? ' is-expanded' : ''}${entry.id === previewId ? ' is-previewed' : ''}`} key={entry.id}>
          <button type="button" className="studio-history-record-heading" aria-expanded={expanded} aria-label={`展开版本 ${entry.revision}`} onClick={() => { setExpandedId(expanded ? '' : entry.id); if (!expanded) void load(entry); }}>
            <span className={`studio-editor-avatar${entry.actor.kind === 'agent' ? ' is-agent' : ''}`} aria-hidden="true">{entry.actor.kind === 'agent' ? <Bot size={17} /> : (entry.actor.name || '协').slice(0, 1)}</span>
            <span className="studio-history-record-text"><span className="studio-history-record-author"><strong>{entry.actor.name || (entry.actor.kind === 'agent' ? 'Agent' : '协作者')}{self ? '（你）' : ''}</strong><time dateTime={entry.createdAt}>{time}</time></span><span className="studio-history-summary">{entry.summary || '作品更新'}</span>{current && <span className="studio-history-current">当前版本</span>}{entry.restoredFrom && <span className="studio-history-restored">从历史版本恢复</span>}</span>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {expanded && <div className="studio-history-record-details">
            {state?.loading && <p className="studio-editor-panel-note" role="status">正在加载改动…</p>}
            {state?.error && <div className="studio-history-load-error" role="alert"><p>{state.error}</p><button type="button" className="studio-link-button" onClick={() => void load(entry, true)}>重试</button></div>}
            {state?.units?.map(change => <div className="studio-history-change" key={change.id}><span data-kind={historyChangeKind(change)}>{historyChangeKind(change)}</span><span title={historyUnitLabel(change.id)}>{historyUnitLabel(change.id)}</span><button type="button" className="studio-link-button" disabled={busy} onClick={() => setInspection({ entry, change })}>看改动</button></div>)}
            {state?.units?.length === 0 && <p className="studio-editor-panel-note">此时段没有保留的内容变化。</p>}
            <div className="studio-history-version-actions"><small>{revisionLabel}</small>{!current && <button type="button" className="studio-link-button" disabled={busy} onClick={() => onPreview(entry)}>{previewId === entry.id ? '正在预览' : '预览版本'}</button>}{canRestore && !current && <button type="button" className="studio-link-button" disabled={busy} onClick={() => setConfirmation({ entry })}>恢复为新版本</button>}</div>
          </div>}
        </article>;
      })}</section>)}
    </>}
    {confirmation && <StudioDialog title={confirmation.unitId ? '只恢复这一处？' : '恢复此版本？'} onClose={() => { if (!restoring && !busy) setConfirmation(null); }}><p>{confirmation.unitId ? `将 ${historyUnitLabel(confirmation.unitId)} 恢复到版本 ${confirmation.entry.revision}，其他内容保持不变。` : `将整个作品恢复到版本 ${confirmation.entry.revision}。`}</p><p className="studio-editor-panel-note">恢复会创建新版本，已有历史记录将保留。</p><div className="studio-modal-footer"><button type="button" className="studio-button" disabled={restoring || busy} onClick={() => setConfirmation(null)}>取消</button><button type="button" className="studio-button studio-primary" disabled={restoring || busy} onClick={() => void restore()}>{restoring ? '正在恢复…' : '确认恢复'}</button></div></StudioDialog>}
  </div>;
}
