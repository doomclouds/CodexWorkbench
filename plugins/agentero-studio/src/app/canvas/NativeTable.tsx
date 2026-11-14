import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { BoardElement } from '../../contracts/studio.js';
import { tableRows } from './canvas-model.js';
import RichText from './RichText.js';
import InlineTextEditor, { type InlineTextEditorHandle, type InlineTextFormat, type InlineTextFormatState } from './InlineTextEditor.js';

interface Cell { row: number; col: number }
interface Draft { base: BoardElement; rows: string[][]; widths: number[]; head: boolean; width: number; dirty: boolean }
interface Props {
  element: BoardElement; selected: boolean; canEdit: boolean;
  onSave: (changes: Partial<BoardElement>, base: BoardElement) => Promise<BoardElement | false>;
  onEditingChange: (active: boolean) => void;
  onRequestLink?: (url: string) => void;
  onFormatStateChange?: (state: InlineTextFormatState) => void;
}
function makeDraft(element: BoardElement): Draft {
  const source = tableRows(element), columns = Math.max(1, ...source.map(row => row.length));
  const rows = (source.length ? source : [[]]).map(row => Array.from({ length: columns }, (_, index) => row[index] ?? ''));
  const stored = element.data?.columnWidths;
  const widths = Array.isArray(stored) && stored.length === columns && stored.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0) ? stored as number[] : Array.from({ length: columns }, () => 1);
  const total = widths.reduce((sum, width) => sum + width, 0);
  return { base: element, rows, widths: widths.map(width => width / total * element.w), head: element.data?.head !== false, width: element.w, dirty: false };
}
function changeDraft(draft: Draft, changes: Partial<Pick<Draft, 'rows' | 'widths' | 'head' | 'width'>>): Draft {
  const next = { ...draft, ...changes }, original = makeDraft(draft.base);
  return { ...next, dirty: next.width !== original.width || next.head !== original.head || JSON.stringify(next.rows) !== JSON.stringify(original.rows) || JSON.stringify(next.widths) !== JSON.stringify(original.widths) };
}

export default function NativeTable({ element, selected, canEdit, onSave, onEditingChange, onRequestLink, onFormatStateChange }: Props) {
  const [active, setActive] = useState<Cell | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [resizing, setResizing] = useState(false);
  const [menu, setMenu] = useState<{ cell: Cell; x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null), input = useRef<InlineTextEditorHandle>(null);
  const elementRef = useRef(element); elementRef.current = element;
  const draftRef = useRef(draft); draftRef.current = draft;
  const busyRef = useRef(false), activity = useRef(onEditingChange); activity.current = onEditingChange;
  const activeRef = useRef(active); activeRef.current = active;
  const canEditRef = useRef(canEdit); canEditRef.current = canEdit;
  const drag = useRef<{ col: number; x: number; scale: number; initial: Draft; next: Draft } | null>(null);
  const current = draft ?? makeDraft(element), { rows, widths, head } = current;
  const editing = Boolean(active || draft?.dirty || busy || resizing);
  useEffect(() => { activity.current(editing); }, [editing]);
  useEffect(() => () => activity.current(false), []);
  useEffect(() => { if (active && !busy) input.current?.focus(); }, [active?.row, active?.col, busy]);
  const stage = (next: Draft | null) => { draftRef.current = next; setDraft(next); };
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const format = (event: Event) => {
      const { format, url } = (event as CustomEvent<{ format: InlineTextFormat; url?: string }>).detail;
      if (!activeRef.current || !canEditRef.current || busyRef.current || !input.current) return;
      if (input.current.format(format, url)) { event.preventDefault(); event.stopPropagation(); }
    };
    node.addEventListener('studio-table-format', format);
    return () => node.removeEventListener('studio-table-format', format);
  }, []);
  useEffect(() => {
    if (!selected) setMenu(null);
  }, [selected]);
  useEffect(() => {
    if (!menu) return;
    root.current?.querySelector<HTMLButtonElement>('.studio-table-cell-menu button')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setMenu(null); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [Boolean(menu)]);
  useEffect(() => {
    const current = drag.current;
    if (!current || canEdit && !element.locked) return;
    drag.current = null; setResizing(false); stage(active || current.initial.dirty ? current.initial : null);
  }, [canEdit, element.locked]);
  const ensureDraft = () => draftRef.current ?? makeDraft(elementRef.current);
  const save = async (next: Draft, close = true, nextCell: Cell | null = active): Promise<boolean> => {
    if (busyRef.current || !canEdit) return false;
    if (!next.dirty) { stage(close ? null : makeDraft(elementRef.current)); setActive(close ? null : nextCell); return true; }
    busyRef.current = true; setBusy(true); setError('');
    try {
      const saved = await onSave({ data: { ...next.base.data, rows: next.rows, columnWidths: next.widths, head: next.head }, ...(next.width !== next.base.w ? { w: next.width } : {}) }, next.base);
      if (!saved) { stage(next); setError('表格未能保存，草稿已保留。'); return false; }
      const latest = elementRef.current.id === saved.id && elementRef.current.version > saved.version ? elementRef.current : saved;
      const accepted = makeDraft(latest);
      stage(close ? null : accepted);
      setActive(close || !nextCell ? null : { row: Math.min(nextCell.row, accepted.rows.length - 1), col: Math.min(nextCell.col, accepted.rows[0]!.length - 1) });
      return true;
    } catch (failure) { stage(next); setError(failure instanceof Error ? failure.message : String(failure)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const start = (row: number, col: number) => { if (!canEdit || busyRef.current) return; stage(ensureDraft()); setActive({ row, col }); setMenu(null); };
  const navigate = async (cell: Cell, next = ensureDraft()) => { stage(next); if (!await save(next, false, cell)) setActive(cell); };
  const insert = (axis: 'row' | 'col', at?: number) => {
    if (!canEdit || busyRef.current) return;
    const base = ensureDraft(), index = at ?? (axis === 'row' ? base.rows.length : base.rows[0]!.length);
    let next: Draft;
    if (axis === 'row') next = changeDraft(base, { rows: [...base.rows.slice(0, index), base.rows[0]!.map(() => ''), ...base.rows.slice(index)] });
    else {
      const width = base.widths.reduce((sum, value) => sum + value, 0) / base.widths.length;
      const columns = [...base.widths.slice(0, index), width, ...base.widths.slice(index)];
      next = changeDraft(base, { rows: base.rows.map(row => [...row.slice(0, index), '', ...row.slice(index)]), widths: element.locked ? columns.map(value => value * base.width / (base.width + width)) : columns, width: element.locked ? base.width : base.width + width });
    }
    setMenu(null); void navigate({ row: axis === 'row' ? index : active?.row ?? 0, col: axis === 'col' ? index : active?.col ?? 0 }, next);
  };
  const remove = (axis: 'row' | 'col', cell = active) => {
    if (!cell || !canEdit || busyRef.current) return;
    const base = ensureDraft();
    if (axis === 'row' && base.rows.length < 2 || axis === 'col' && base.rows[0]!.length < 2) return;
    let next: Draft;
    if (axis === 'row') next = changeDraft(base, { rows: base.rows.filter((_row, index) => index !== cell.row) });
    else {
      const columns = base.widths.filter((_width, index) => index !== cell.col), total = columns.reduce((sum, width) => sum + width, 0);
      next = changeDraft(base, { rows: base.rows.map(row => row.filter((_text, index) => index !== cell.col)), widths: element.locked ? columns.map(width => width * base.width / total) : columns, width: element.locked ? base.width : total });
    }
    setMenu(null); void navigate({ row: Math.min(cell.row, next.rows.length - 1), col: Math.min(cell.col, next.rows[0]!.length - 1) }, next);
  };
  const beginColumn = (event: ReactPointerEvent<HTMLDivElement>, col: number) => {
    if (!canEdit || element.locked || busyRef.current || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const initial = ensureDraft(), measured = root.current?.getBoundingClientRect().width ?? 0;
    drag.current = { col, x: event.clientX, scale: measured > 0 ? measured / initial.width : 1, initial, next: initial };
    stage(initial); setResizing(true);
  };
  const moveColumn = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current; if (!current) return;
    event.stopPropagation();
    const widths = current.initial.widths.map((width, index) => index === current.col ? Math.max(40, width + (event.clientX - current.x) / current.scale) : width);
    current.next = changeDraft(current.initial, { widths, width: widths.reduce((sum, width) => sum + width, 0) }); stage(current.next);
  };
  const endColumn = (event: ReactPointerEvent<HTMLDivElement>, cancel = false) => {
    const current = drag.current; if (!current) return;
    event.preventDefault(); event.stopPropagation(); drag.current = null; setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancel) { stage(active || current.initial.dirty ? current.initial : null); return; }
    void save(current.next, active === null);
  };
  let edge = 0;
  return <div ref={root} className="studio-native-table" style={{ position: 'relative', width: current.width, height: '100%' }} onDoubleClick={event => event.stopPropagation()} onPointerDownCapture={event => { if (menu && !(event.target as Element).closest('.studio-table-cell-menu')) setMenu(null); }}>
    <table className="studio-board-table" style={{ width: current.width }}><colgroup>{widths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup><tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => {
      const Cell = r === 0 && head ? 'th' : 'td', editing = active?.row === r && active.col === c;
      return <Cell key={c} data-cell={`${r}:${c}`} onPointerDown={event => { if (active && !editing && canEdit && !busyRef.current) { event.preventDefault(); event.stopPropagation(); void navigate({ row: r, col: c }); } }} onDoubleClick={event => { event.stopPropagation(); start(r, c); }} onContextMenu={event => {
        if (!canEdit) return;
        event.preventDefault(); event.stopPropagation(); start(r, c);
        const rect = root.current!.getBoundingClientRect(), scale = rect.width / current.width || 1;
        setMenu({ cell: { row: r, col: c }, x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale });
      }} style={r === 0 && head ? { background: element.fill } : undefined}>{editing ? <InlineTextEditor ref={input} className="studio-table-cell-editor" ariaLabel={`表格第${r + 1}行第${c + 1}列`} disabled={busy || !canEdit} value={cell} onRequestLink={onRequestLink} onFormatStateChange={onFormatStateChange} onChange={value => {
        const base = ensureDraft(); stage(changeDraft(base, { rows: base.rows.map((line, index) => index === r ? line.map((text, col) => col === c ? value : text) : line) }));
      }} onCommit={() => { if (!busyRef.current) void save(ensureDraft()); }} onBlur={event => {
        const target = event.relatedTarget as HTMLElement | null;
        if (busyRef.current || root.current?.contains(target) || target?.closest('.studio-selection-toolbar')) event.preventDefault();
      }} onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || busyRef.current) return;
        if (event.key === 'Escape' && menu) { event.preventDefault(); setMenu(null); return; }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (!event.ctrlKey && !event.metaKey && r < rows.length - 1) void navigate({ row: r + 1, col: c });
          else void save(ensureDraft());
        } else if (event.key === 'Tab') {
          event.preventDefault(); const index = r * row.length + c + (event.shiftKey ? -1 : 1); if (index < 0) return;
          const base = ensureDraft(), next = index >= rows.length * row.length ? changeDraft(base, { rows: [...base.rows, row.map(() => '')] }) : base;
          void navigate({ row: Math.floor(index / row.length), col: index % row.length }, next);
        }
      }} /> : <RichText text={cell} />}</Cell>;
    })}</tr>)}</tbody></table>
    {selected && canEdit && !element.locked && widths.map((width, col) => {
      edge += width;
      return <div key={col} className="studio-table-column-handle" data-native-interactive="true" role="separator" aria-label={`调整第${col + 1}列宽度`} aria-orientation="vertical" style={{ position: 'absolute', left: edge, top: 0, bottom: 0, width: 8, marginLeft: -4, cursor: 'col-resize', touchAction: 'none', zIndex: 4 }} onPointerDown={event => beginColumn(event, col)} onPointerMove={moveColumn} onPointerUp={event => endColumn(event)} onPointerCancel={event => endColumn(event, true)} onLostPointerCapture={event => endColumn(event, true)} />;
    })}
    {selected && canEdit && <div className="studio-table-controls" data-native-interactive="true" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => event.stopPropagation()}>
      <button type="button" aria-label="添加表格行" onClick={() => insert('row')} disabled={busy}>＋行</button><button type="button" aria-label="添加表格列" onClick={() => insert('col')} disabled={busy}>＋列</button><button type="button" aria-label="切换表头" aria-pressed={head} onClick={() => { const next = changeDraft(ensureDraft(), { head: !head }); stage(next); void save(next, !active); }} disabled={busy}>表头</button>
      {active && <><button type="button" aria-label="删除当前行" onClick={() => remove('row')} disabled={rows.length < 2 || busy}>删除行</button><button type="button" aria-label="删除当前列" onClick={() => remove('col')} disabled={rows[0]!.length < 2 || busy}>删除列</button></>}
      {error && <><span role="alert">{error}</span><button type="button" aria-label="重试保存表格" onClick={() => void save(ensureDraft(), !active)} disabled={busy}>重试保存</button><button type="button" aria-label="放弃表格草稿" onClick={() => { stage(null); setActive(null); setError(''); }}>放弃草稿</button></>}
    </div>}
    {menu && <div className="studio-table-cell-menu" role="menu" data-native-interactive="true" style={{ position: 'absolute', left: menu.x, top: menu.y, zIndex: 8 }} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') setMenu(null); }}>
      <button type="button" role="menuitem" disabled={busy} onClick={() => insert('row', menu.cell.row)}>在上方插入行</button><button type="button" role="menuitem" disabled={busy} onClick={() => insert('row', menu.cell.row + 1)}>在下方插入行</button><button type="button" role="menuitem" disabled={busy} onClick={() => insert('col', menu.cell.col)}>在左侧插入列</button><button type="button" role="menuitem" disabled={busy} onClick={() => insert('col', menu.cell.col + 1)}>在右侧插入列</button><button type="button" role="menuitem" disabled={busy || rows.length < 2} onClick={() => remove('row', menu.cell)}>删除行</button><button type="button" role="menuitem" disabled={busy || rows[0]!.length < 2} onClick={() => remove('col', menu.cell)}>删除列</button>
    </div>}
  </div>;
}
