import { useEffect, useRef, useState } from 'react';
import { Minus, Pause, Play, Plus, RotateCcw, Timer } from 'lucide-react';
import type { RoomTimer } from '../../../contracts/studio';
import { EditorPopover } from './EditorPopover';
import './editor-panels.css';

export type TimerAction = 'start' | 'pause' | 'resume' | 'reset';
export interface TimerControlProps { timer: RoomTimer | null; canEdit: boolean; busy: boolean; onAction: (action: TimerAction, durationSeconds?: number) => void }
export function timerRemainingSeconds(timer: RoomTimer, now: number): number {
  return Math.ceil(Math.max(0, timer.paused || timer.deadline === null ? timer.remainingMs : timer.deadline - now) / 1000);
}
function timerLabel(seconds: number): string { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function duration(value: number): number { return Math.max(1, Math.min(86400, Math.round(value))); }

export function TimerControl({ timer, canEdit, busy, onAction }: TimerControlProps) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(300), [now, setNow] = useState(Date.now);
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let interval: number | undefined;
    const update = () => { const stamp = Date.now(); setNow(stamp); if (timer?.deadline !== null && timer?.deadline !== undefined && timer.deadline <= stamp) { window.clearInterval(interval); interval = undefined; } };
    const visibility = () => { window.clearInterval(interval); interval = undefined; if (document.visibilityState === 'hidden') return; update(); if (timer && !timer.paused && timer.deadline !== null && timer.deadline > Date.now()) interval = window.setInterval(update, 1000); };
    visibility(); document.addEventListener('visibilitychange', visibility);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visibility); };
  }, [timer?.deadline, timer?.paused, timer?.remainingMs]);
  const seconds = timer ? timerRemainingSeconds(timer, now) : draft, label = timerLabel(seconds);
  const action: TimerAction = timer ? timer.paused ? 'resume' : 'pause' : 'start';
  const actionLabel = timer ? timer.paused ? '继续' : '暂停' : '开始';
  return <div className="studio-editor-popover-anchor studio-timer-control">
    <button ref={anchor} type="button" className={`studio-icon-button studio-timer-trigger${open ? ' is-active' : ''}`} aria-label="共享计时器" aria-haspopup="dialog" aria-expanded={open} title={timer ? `共享计时器 ${label}` : '共享计时器'} onClick={() => setOpen(previous => !previous)}><Timer size={19} />{timer && <span className="studio-timer-trigger-label">{label}</span>}</button>
    {open && <EditorPopover title="共享计时器" className="studio-timer-popover" anchorRef={anchor} onClose={() => setOpen(false)}>
      <div className="studio-timer-layout">{canEdit && <button type="button" className="studio-timer-play" aria-label={actionLabel} disabled={busy || (!!timer && seconds === 0)} onClick={() => onAction(action, timer ? undefined : draft)}>{action === 'pause' ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>}
        {timer || !canEdit ? <output className="studio-timer-display" aria-label="剩余时间">{label}</output> : <div className="studio-timer-duration" aria-label="计时时长"><input type="number" min={0} max={1440} aria-label="计时分钟" value={Math.floor(draft / 60)} onChange={event => setDraft(duration((Number(event.target.value) || 0) * 60 + draft % 60))} /><span>:</span><input type="number" min={0} max={59} aria-label="计时秒数" value={String(draft % 60).padStart(2, '0')} onChange={event => setDraft(duration(Math.floor(draft / 60) * 60 + Math.max(0, Math.min(59, Number(event.target.value) || 0))))} /></div>}
        {canEdit && <div className="studio-timer-adjust"><button type="button" className="studio-icon-button" aria-label="增加一分钟" title={timer ? '重置后可调整时长' : '增加一分钟'} disabled={busy || !!timer || draft >= 86400} onClick={() => setDraft(previous => duration(previous + 60))}><Plus size={19} /></button><button type="button" className="studio-icon-button" aria-label="减少一分钟" title={timer ? '重置后可调整时长' : '减少一分钟'} disabled={busy || !!timer || draft <= 1} onClick={() => setDraft(previous => duration(previous - 60))}><Minus size={19} /></button></div>}
      </div>
      <div className="studio-timer-footer"><span>{timer ? `${timer.source.name || '协作者'} · ${seconds === 0 ? '已结束' : timer.paused ? '已暂停' : '计时中'}` : canEdit ? '为所有协作者设置倒计时' : '等待协作者开始计时'}</span>{canEdit && timer && <button type="button" className="studio-link-button" disabled={busy} onClick={() => onAction('reset')}><RotateCcw size={13} />重置</button>}</div>
    </EditorPopover>}
  </div>;
}
