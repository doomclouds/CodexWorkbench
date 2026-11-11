import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Contrast, Expand, Languages, List, LoaderCircle, MessageSquare, NotebookPen, PanelRight, RotateCcw, Search, X, ZoomIn, ZoomOut } from 'lucide-react';
import './reader-tools.css';

export interface ReaderToolState {
  ready: boolean; hasPaper: boolean; page: number; total: number; pageInput: string; scale: number; fit: boolean; tone: 'white' | 'dark';
  outlineOpen: boolean; searchOpen: boolean; marksOpen: boolean; notesOpen: boolean; notesDirty: boolean;
  translationOpen: boolean; translating: boolean; cards: boolean; targetLanguage: string;
}
export interface ReaderToolActions {
  toggleOutline(): void; toggleSearch(): void; toggleMarks(): void; toggleNotes(): void; toggleTranslation(): void; toggleCards(): void;
  pageInput(value: string): void; goToPage(): void; previous(): void; next(): void;
  zoom(value: number): void; fit(): void; rotate(): void; tone(): void; targetLanguage(value: string): void;
}
interface Props { state: ReaderToolState; actions: ReaderToolActions; collapsed?: boolean }

export function ReaderTools({ state, actions, collapsed = false }: Props) {
  const tools = [
    { label: '目录', Icon: List, open: state.outlineOpen, action: actions.toggleOutline },
    { label: '查找', Icon: Search, open: state.searchOpen, action: actions.toggleSearch },
    { label: '批注', Icon: MessageSquare, open: state.marksOpen, action: actions.toggleMarks },
    { label: '论文笔记', Icon: NotebookPen, open: state.notesOpen, action: actions.toggleNotes, dirty: state.notesDirty },
    { label: '翻译', Icon: state.translating ? LoaderCircle : Languages, open: state.translationOpen, action: actions.toggleTranslation, spinning: state.translating },
  ];
  return <div className={`reader-tools ${collapsed ? 'is-collapsed' : ''}`} data-reader-tools="true">
    <div className="reader-tools__separator" role="separator" />
    <div className="reader-tools__items" role="toolbar" aria-label="阅读工具">{tools.map(({ label, Icon, open, action, dirty, spinning }) => <button key={label} className={`reader-tools__item ${open ? 'is-active' : ''}`} aria-label={label} title={dirty ? `${label} · 有未保存草稿` : label} aria-pressed={open} disabled={label === '论文笔记' ? !state.hasPaper : !state.ready} onClick={action}><Icon size={17} className={spinning ? 'spin' : undefined} aria-hidden="true" />{!collapsed && <span>{label}</span>}{dirty && <span className="reader-tools__dirty" role="status" aria-label="有未保存笔记">{!collapsed && '未保存'}</span>}</button>)}</div>
    {!collapsed && state.translationOpen && <div className="reader-tools__language"><TranslationLanguage value={state.targetLanguage} onChange={actions.targetLanguage} /></div>}
    <div className="reader-tools__separator" role="separator" />
    <button className={`reader-tools__item reader-tools__cards ${state.cards ? 'is-active' : ''}`} role="switch" aria-label="页边备注" aria-checked={state.cards} title="页边备注 · 空间不足时自动隐藏，偏好保留" disabled={!state.ready} onClick={actions.toggleCards}><PanelRight size={17} aria-hidden="true" />{!collapsed && <><span>页边备注</span><span className="reader-tools__switch" aria-hidden="true" /></>}</button>
    {!collapsed && <div className="reader-tools__navigation"><ReaderPager state={state} actions={actions} /><ReaderZoom state={state} actions={actions} /><button className={`reader-tools__fit ${state.fit ? 'is-active' : ''}`} disabled={!state.ready} aria-pressed={state.fit} onClick={actions.fit}><Expand size={15} aria-hidden="true" />适合宽度</button><ReaderModifiers state={state} actions={actions} /></div>}
  </div>;
}

export function ReaderPager({ state, actions }: Pick<Props, 'state' | 'actions'>) {
  return <div className="reader-control-group reader-pager"><button aria-label="上一页" title="上一页" disabled={!state.ready || state.page <= 1} onClick={actions.previous}><ChevronLeft size={15} /></button><form onSubmit={event => { event.preventDefault(); actions.goToPage(); }}><input aria-label="PDF 物理页码" title="PDF 物理页码" inputMode="numeric" value={state.pageInput} onChange={event => actions.pageInput(event.target.value.replace(/\D/g, ''))} disabled={!state.ready} /><span>/ {state.total || '—'}</span></form><button aria-label="下一页" title="下一页" disabled={!state.ready || state.page >= state.total} onClick={actions.next}><ChevronRight size={15} /></button></div>;
}
export function ReaderZoom({ state, actions, compact = false }: Pick<Props, 'state' | 'actions'> & { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return <div className={`reader-zoom ${compact ? 'is-hud' : ''}`}><div className="reader-control-group"><button aria-label="缩小" title="缩小" disabled={!state.ready || state.scale <= .35} onClick={() => actions.zoom(state.scale - .15)}><ZoomOut size={14} /></button><button className="reader-zoom__value" aria-label="设置缩放" title="设置缩放" aria-expanded={open} disabled={!state.ready} onClick={() => setOpen(value => !value)}>{Math.round(state.scale * 100)}%</button><button aria-label="放大" title="放大" disabled={!state.ready || state.scale >= 3} onClick={() => actions.zoom(state.scale + .15)}><ZoomIn size={14} /></button></div>{open && <div className="reader-zoom__detail"><div><strong>缩放</strong><button className="icon-button" aria-label="关闭缩放设置" onClick={() => setOpen(false)}><X size={12} /></button></div><input type="range" aria-label="PDF 缩放" min={35} max={300} step={1} value={Math.round(state.scale * 100)} onChange={event => actions.zoom(Number(event.target.value) / 100)} /><div className="reader-zoom__presets">{[50, 75, 100, 150, 200, 300].map(percent => <button key={percent} onClick={() => actions.zoom(percent / 100)}>{percent}%</button>)}</div></div>}</div>;
}
export function ReaderModifiers({ state, actions }: Pick<Props, 'state' | 'actions'>) {
  return <div className="reader-tools__modifiers"><button aria-label="旋转 PDF" title="旋转 PDF" disabled={!state.ready} onClick={actions.rotate}><RotateCcw size={16} /></button><button aria-label="切换黑白纸色" title={state.tone === 'white' ? '切换黑色纸张' : '切换白色纸张'} disabled={!state.ready} onClick={actions.tone}><Contrast size={16} /></button></div>;
}
export function ReaderHud({ state, actions }: Pick<Props, 'state' | 'actions'>) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hud = element.current; const stage = hud?.closest<HTMLElement>('.reader-stage'); if (!hud || !stage) return;
    let frame = 0; let previous = 0;
    const measure = () => { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; const height = Math.ceil(hud.getBoundingClientRect().height); if (height > 0 && height !== previous) { previous = height; stage.style.setProperty('--reader-hud-height', height + 'px'); } }); };
    const observer = new ResizeObserver(measure); observer.observe(hud); measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); stage.style.removeProperty('--reader-hud-height'); };
  }, []);
  return <div ref={element} className="reader-float-hud" role="toolbar" aria-label="阅读快捷控制"><ReaderPager state={state} actions={actions} /><span className="reader-hud-divider" aria-hidden="true" /><ReaderZoom state={state} actions={actions} compact /><span className="reader-hud-divider" aria-hidden="true" /><button className={state.fit ? 'is-active' : ''} disabled={!state.ready} aria-pressed={state.fit} onClick={actions.fit}><Expand size={15} />适合宽度</button><span className="reader-hud-divider" aria-hidden="true" /><ReaderModifiers state={state} actions={actions} /></div>;
}
export function TranslationLanguage({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <select aria-label="翻译目标语言" value={value} onChange={event => onChange(event.target.value)}><option value="">按插件设置</option><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="de">Deutsch</option><option value="fr">Français</option></select>;
}
export function ReaderLanguageSetting({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <label className="reader-menu-language"><span>翻译目标语言</span><TranslationLanguage value={value} onChange={onChange} /></label>;
}
