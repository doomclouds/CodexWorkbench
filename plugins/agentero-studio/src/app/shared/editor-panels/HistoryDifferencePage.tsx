import { useMemo } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import type { HistoryBatch } from '../../../contracts/studio';
import { diffHistoryText, historyUnitLabel, historyUnitText, type HistoryUnitDiff } from './history-diff';

export function HistoryDifferencePage({ entry, change, canRestore, busy, onBack, onClose, onRestore }: { entry: HistoryBatch; change: HistoryUnitDiff; canRestore: boolean; busy: boolean; onBack: () => void; onClose?: () => void; onRestore: () => void }) {
  const diff = useMemo(() => diffHistoryText(...historyUnitText(change)), [change]);
  return <div className="studio-history-difference">
    <div className="studio-history-difference-heading"><button type="button" className="studio-icon-button" aria-label="返回版本历史" onClick={onBack}><ArrowLeft size={18} /></button><h2>{historyUnitLabel(change.id)}</h2><span className="studio-history-diff-added" aria-label="新增行数">+{diff.added}</span><span className="studio-history-diff-removed" aria-label="删除行数">−{diff.removed}</span>{onClose && <button type="button" className="studio-icon-button" aria-label="关闭版本历史" onClick={onClose}><X size={18} /></button>}</div>
    <p className="studio-history-difference-meta">{entry.actor.name || '协作者'} · {new Date(entry.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
    {canRestore && <button type="button" className="studio-button studio-compact studio-history-restore-unit" disabled={busy} onClick={onRestore}>只恢复这一处</button>}
    {diff.tooLarge ? <p className="studio-editor-panel-note">内容较大，无法在这里展开逐行差异。</p> : !diff.added && !diff.removed ? <p className="studio-editor-panel-note">内容相同。</p> : <div className="studio-history-diff-lines" aria-label="逐行改动">{diff.lines.map((line, index) => line.kind === '~' ? <div className="studio-history-diff-skip" key={index}>跳过 {line.text} 行</div> : <div className="studio-history-diff-line" data-kind={line.kind} key={index}><span aria-hidden="true">{line.kind}</span><code>{line.text || ' '}</code></div>)}</div>}
    {diff.truncated && <p className="studio-editor-panel-note">差异较长，仅显示前 3000 行。</p>}
  </div>;
}
