import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { BoardElement } from '../../contracts/studio.js';
import { tableRows } from './canvas-model.js';
import RichText from './RichText.js';
import InlineTextEditor, {
  type InlineTextEditorHandle,
  type InlineTextFormat,
  type InlineTextFormatState,
} from './InlineTextEditor.js';
import { newClientId } from '../shared/client-id.js';
import { applyContentIntent } from './content-queue.js';
import { jsonEqual, mergeJson } from '../../core/shared/safe-merge.js';
import { parseRichText } from '../../core/shared/rich-text.js';
import { isEscapeActive } from '../shared/escape.js';
import './native-table-overview.css';

interface Cell {
  row: number;
  col: number;
}
interface Draft {
  base: BoardElement;
  rows: string[][];
  rowIds: string[];
  columnIds: string[];
  widths: number[];
  head: boolean;
  width: number;
  dirty: boolean;
}
export interface NativeTableDraft {
  base: BoardElement;
  changes: Partial<BoardElement>;
}
interface Props {
  element: BoardElement;
  selected: boolean;
  canEdit: boolean;
  detail?: 'full' | 'preview' | 'outline';
  onSave: (changes: Partial<BoardElement>, base: BoardElement) => Promise<BoardElement | false>;
  onEditingChange: (active: boolean) => void;
  onRequestLink?: (url: string) => void;
  onFormatStateChange?: (state: InlineTextFormatState) => void;
  initialDraft?: NativeTableDraft;
  onDraftChange?: (draft: NativeTableDraft | null) => void;
  bodyPaint?: { background: string; color: string };
  headerPaint?: { background: string; color: string };
  editRequest?: number;
  viewport?: { x: number; y: number; zoom: number };
}

function makeDraft(element: BoardElement): Draft {
  const source = tableRows(element);
  const columns = Math.max(1, ...source.map((row) => row.length));
  const rows = (source.length ? source : [[]]).map((row) =>
    Array.from({ length: columns }, (_, index) => row[index] ?? ''),
  );
  const stored = element.data?.columnWidths;
  const widths =
    Array.isArray(stored) &&
    stored.length === columns &&
    stored.every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0)
      ? (stored as number[])
      : Array.from({ length: columns }, () => 1);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const rowIds =
    Array.isArray(element.data?.rowIds) && element.data.rowIds.length === rows.length
      ? (element.data.rowIds as string[])
      : rows.map((_row, index) => `${element.id}:row:${index}`);
  const columnIds =
    Array.isArray(element.data?.columnIds) && element.data.columnIds.length === columns
      ? (element.data.columnIds as string[])
      : rows[0]!.map((_cell, index) => `${element.id}:col:${index}`);

  return {
    base: element,
    rows,
    rowIds,
    columnIds,
    widths: widths.map((width) => (width / total) * element.w),
    head: element.data?.head !== false,
    width: element.w,
    dirty: false,
  };
}

function changeDraft(
  draft: Draft,
  changes: Partial<Pick<Draft, 'rows' | 'rowIds' | 'columnIds' | 'widths' | 'head' | 'width'>>,
): Draft {
  const next = { ...draft, ...changes };
  const original = makeDraft(draft.base);
  return {
    ...next,
    dirty:
      next.width !== original.width ||
      next.head !== original.head ||
      !jsonEqual(next.rows, original.rows) ||
      !jsonEqual(next.widths, original.widths),
  };
}

function draftChanges(draft: Draft): Partial<BoardElement> {
  return {
    data: {
      ...draft.base.data,
      rows: draft.rows,
      rowIds: draft.rowIds,
      columnIds: draft.columnIds,
      columnWidths: draft.widths,
      head: draft.head,
    },
    ...(draft.width !== draft.base.w ? { w: draft.width } : {}),
  };
}

function restoreDraft(draft?: NativeTableDraft): Draft | null {
  return draft
    ? { ...makeDraft({ ...draft.base, ...draft.changes }), base: draft.base, dirty: true }
    : null;
}

function projectDraft(element: BoardElement, draft: Draft | null): Draft {
  if (!draft) {
    return makeDraft(element);
  }

  const intended = { ...draft.base, ...draftChanges(draft) };
  const projected = applyContentIntent(draft.base, intended, element) as BoardElement;
  return { ...makeDraft(projected), base: draft.base, dirty: draft.dirty };
}

function useTableDraft(
  element: BoardElement,
  initialDraft: NativeTableDraft | undefined,
  busy: boolean,
) {
  const [draft, setDraft] = useState<Draft | null>(() => restoreDraft(initialDraft));
  const cleanDraft = draft && !draft.dirty && !busy;
  if (cleanDraft && draft.base.version < element.version) {
    setDraft(makeDraft(element));
  }
  return { draft, setDraft, projected: projectDraft(element, draft) };
}

export default function NativeTable({
  element,
  selected,
  canEdit,
  detail = 'full',
  onSave,
  onEditingChange,
  onRequestLink,
  onFormatStateChange,
  initialDraft,
  onDraftChange,
  bodyPaint,
  headerPaint,
  editRequest,
  viewport,
}: Props) {
  const [active, setActive] = useState<Cell | null>(null);
  const [busy, setBusy] = useState(false);
  const { draft, setDraft, projected: current } = useTableDraft(element, initialDraft, busy);
  const [error, setError] = useState('');
  const [resizing, setResizing] = useState(false);
  const [menu, setMenu] = useState<{ cell: Cell; x: number; y: number } | null>(null);
  const [previouslySelected, setPreviouslySelected] = useState(selected);
  if (selected !== previouslySelected) {
    setPreviouslySelected(selected);
    if (!selected) {
      setMenu(null);
    }
  }
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<InlineTextEditorHandle>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);
  const [controlsPosition, setControlsPosition] = useState({ left: 12, top: 12 });
  const elementRef = useRef(element);
  const draftRef = useRef(draft);
  const busyRef = useRef(false);
  const activity = useRef(onEditingChange);
  const activeRef = useRef(active);
  const canEditRef = useRef(canEdit);
  const draftCallback = useRef(onDraftChange);
  useLayoutEffect(() => {
    elementRef.current = element;
    draftRef.current = draft;
    activity.current = onEditingChange;
    activeRef.current = active;
    canEditRef.current = canEdit;
    draftCallback.current = onDraftChange;
  }, [active, canEdit, draft, element, onDraftChange, onEditingChange]);

  const pending = useRef<{ next: Draft; close: boolean; nextCell: Cell | null } | null>(null);
  const savingDraft = useRef<Draft | null>(null);
  const drag = useRef<{
    col: number;
    x: number;
    scale: number;
    initial: Draft;
    next: Draft;
  } | null>(null);
  const { rows, widths, head } = current;
  const hasActiveCell = active !== null;
  const editing = hasActiveCell || Boolean(draft?.dirty || busy || resizing);
  const visibleDetail = editing || menu || error ? 'full' : detail;
  const { x: viewportX, y: viewportY, zoom = 1 } = viewport ?? {};
  const readablePreviewText = (element.fontSize ?? 17) * zoom >= 8;
  const previewRowHeight = element.h / rows.length;
  const headerStyle = headerPaint ?? { background: element.fill };
  const canResize = canEdit && !element.locked;
  useLayoutEffect(() => {
    setOverlayHost(root.current?.closest<HTMLElement>('.studio-whiteboard') ?? null);
  }, []);
  useLayoutEffect(() => {
    if (!overlayHost || !selected || !canEdit) {
      return;
    }

    const place = () => {
      if (!root.current || !controlsRef.current) {
        return;
      }

      const table = root.current.getBoundingClientRect();
      const host = overlayHost.getBoundingClientRect();
      const panel = controlsRef.current.getBoundingClientRect();
      if (!host.width || !host.height || !panel.width) {
        return;
      }

      const left = Math.max(12, Math.min(table.left - host.left, host.width - panel.width - 12));
      let top = Math.max(
        12,
        Math.min(table.bottom - host.top + 6, host.height - panel.height - 12),
      );
      const overlaps = (rect: DOMRect) =>
        left + panel.width > rect.left - host.left &&
        left < rect.right - host.left &&
        top + panel.height > rect.top - host.top &&
        top < rect.bottom - host.top;
      const dock = overlayHost.querySelector('.studio-canvas-toolbar')?.getBoundingClientRect();
      if (dock?.width && overlaps(dock) && table.top - host.top > panel.height + 18) {
        top = table.top - host.top - panel.height - 6;
      }
      for (const selector of ['.studio-canvas-toolbar', '.studio-selection-toolbar']) {
        const blocker = overlayHost.querySelector(selector)?.getBoundingClientRect();
        if (blocker?.width && overlaps(blocker)) {
          top = Math.max(12, blocker.top - host.top - panel.height - 8);
          if (
            overlaps(blocker) &&
            blocker.bottom - host.top + 8 + panel.height <= host.height - 12
          ) {
            top = blocker.bottom - host.top + 8;
          }
        }
      }
      setControlsPosition((current) =>
        current.left === left && current.top === top ? current : { left, top },
      );
    };
    place();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : undefined;
    if (root.current) {
      observer?.observe(root.current);
    }
    if (controlsRef.current) {
      observer?.observe(controlsRef.current);
    }
    observer?.observe(overlayHost);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [
    overlayHost,
    selected,
    canEdit,
    viewportX,
    viewportY,
    zoom,
    element.x,
    element.y,
    element.w,
    element.h,
    element.rotation,
    current.width,
    hasActiveCell,
    error,
  ]);
  useEffect(() => {
    activity.current(editing);
  }, [editing]);
  useEffect(() => () => activity.current(false), []);
  const activeRow = active?.row;
  const activeColumn = active?.col;
  useEffect(() => {
    if (activeRow !== undefined && activeColumn !== undefined && !busy) {
      input.current?.focus();
    }
  }, [activeRow, activeColumn, busy]);
  const stage = useCallback(
    (value: Draft | null) => {
      const saving = savingDraft.current;
      const inFlight = value && busyRef.current && saving;
      const changedDuringSave = inFlight && !jsonEqual(draftChanges(value), draftChanges(saving));
      const next = changedDuringSave ? { ...value, dirty: true } : value;
      draftRef.current = next;
      setDraft(next);
      draftCallback.current?.(
        next?.dirty ? { base: next.base, changes: draftChanges(next) } : null,
      );
    },
    [setDraft],
  );
  useEffect(() => {
    const node = root.current;
    if (!node) {
      return;
    }

    const format = (event: Event) => {
      const { format, url } = (event as CustomEvent<{ format: InlineTextFormat; url?: string }>)
        .detail;
      const canFormat = activeRef.current && canEditRef.current && !busyRef.current;
      if (!canFormat || !input.current) {
        return;
      }

      if (input.current.format(format, url)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    node.addEventListener('studio-table-format', format);
    return () => node.removeEventListener('studio-table-format', format);
  }, []);
  const menuOpen = menu !== null;
  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    root.current
      ?.querySelector<HTMLButtonElement>('.studio-table-cell-menu button')
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setMenu(null);
      }
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [menuOpen]);
  useEffect(() => {
    const current = drag.current;
    if (!current || (canEdit && !element.locked)) {
      return;
    }

    drag.current = null;
    setResizing(false);
    stage(active || current.initial.dirty ? current.initial : null);
  }, [active, canEdit, element.locked, stage]);
  const ensureDraft = () => draftRef.current ?? makeDraft(elementRef.current);
  const reportSaveFailure = (failure: unknown) => {
    setError(failure instanceof Error ? failure.message : String(failure));
  };
  const acceptSave = (
    submitted: Draft,
    saved: BoardElement,
    close: boolean,
    nextCell: Cell | null,
  ) => {
    const observed = elementRef.current;
    const latest = observed.id === saved.id && observed.version > saved.version ? observed : saved;
    const accepted = makeDraft(latest);
    const newer = draftRef.current;
    if (newer?.dirty && !jsonEqual(draftChanges(newer), draftChanges(submitted))) {
      const merged = mergeJson(
        { ...submitted.base, ...draftChanges(submitted) },
        { ...newer.base, ...draftChanges(newer) },
        latest,
        ['data.rows'],
      );

      if (merged.conflicts.length) {
        stage(newer);
        setError('同一单元格有新的共享修改，草稿已保留，请比较后选择。');
        return false;
      }
      const rebased = merged.result as BoardElement;
      stage(changeDraft({ ...makeDraft(rebased), base: latest }, {}));
      return true;
    }
    stage(close ? null : accepted);
    setActive(
      close || !nextCell
        ? null
        : {
            row: Math.min(nextCell.row, accepted.rows.length - 1),
            col: Math.min(nextCell.col, accepted.rows[0]!.length - 1),
          },
    );

    return true;
  };
  const save = async (
    next: Draft,
    close = true,
    nextCell: Cell | null = active,
  ): Promise<boolean> => {
    if (!canEditRef.current) {
      return false;
    }

    if (busyRef.current) {
      pending.current = { next, close, nextCell };
      return false;
    }
    if (!next.dirty) {
      stage(close ? null : makeDraft(elementRef.current));
      setActive(close ? null : nextCell);
      return true;
    }
    busyRef.current = true;
    savingDraft.current = next;
    setBusy(true);
    setError('');
    try {
      const saved = await onSave(draftChanges(next), next.base);
      if (!saved) {
        stage(draftRef.current ?? next);
        setError('表格未能保存，草稿已保留。');
        return false;
      }
      busyRef.current = false;
      return acceptSave(next, saved, close, nextCell);
    } catch (failure) {
      stage(draftRef.current ?? next);
      reportSaveFailure(failure);
      return false;
    } finally {
      busyRef.current = false;
      savingDraft.current = null;
      setBusy(false);
      const queued = pending.current;
      pending.current = null;
      if (queued && canEditRef.current) {
        save(draftRef.current ?? queued.next, queued.close, queued.nextCell).catch(
          reportSaveFailure,
        );
      }
    }
  };
  const saveLiveDraft = useEffectEvent(() => {
    if (draftRef.current?.dirty && !error) {
      save(draftRef.current, false).catch(reportSaveFailure);
    }
  });
  const waitStarted = useRef<number | null>(null);
  useEffect(() => {
    const hasChanges = draft?.rows && draftRef.current?.dirty;
    if (!hasChanges || !canEdit || error) {
      waitStarted.current = null;
      return;
    }
    waitStarted.current ??= Date.now();
    const timeout = setTimeout(
      () => {
        waitStarted.current = null;
        saveLiveDraft();
      },
      Math.max(0, Math.min(250, 1000 - (Date.now() - waitStarted.current))),
    );

    return () => clearTimeout(timeout);
  }, [draft?.rows, canEdit, error]);
  const start = (row: number, col: number) => {
    if (!canEdit || busyRef.current) {
      return;
    }

    stage(ensureDraft());
    setActive({ row, col });
    setMenu(null);
  };
  const openRequestedCell = useEffectEvent(() => {
    const canOpen = selected && canEdit;
    if (canOpen && root.current && isEscapeActive(root.current)) {
      start(0, 0);
    }
  });
  useEffect(() => {
    if (editRequest) {
      openRequestedCell();
    }
  }, [editRequest]);
  const navigate = async (cell: Cell, next = ensureDraft()) => {
    stage(next);
    if (!(await save(next, false, cell))) {
      setActive(cell);
    }
  };
  const insert = (axis: 'row' | 'col', at?: number) => {
    if (!canEdit || busyRef.current) {
      return;
    }

    const base = ensureDraft();
    const index = at ?? (axis === 'row' ? base.rows.length : base.rows[0]!.length);
    let next: Draft;
    if (axis === 'row') {
      next = changeDraft(base, {
        rows: [
          ...base.rows.slice(0, index),
          base.rows[0]!.map(() => ''),
          ...base.rows.slice(index),
        ],
        rowIds: [...base.rowIds.slice(0, index), newClientId('row'), ...base.rowIds.slice(index)],
      });
    } else {
      const width = base.widths.reduce((sum, value) => sum + value, 0) / base.widths.length;
      const columns = [...base.widths.slice(0, index), width, ...base.widths.slice(index)];
      next = changeDraft(base, {
        rows: base.rows.map((row) => [...row.slice(0, index), '', ...row.slice(index)]),
        columnIds: [
          ...base.columnIds.slice(0, index),
          newClientId('col'),
          ...base.columnIds.slice(index),
        ],
        widths: element.locked
          ? columns.map((value) => (value * base.width) / (base.width + width))
          : columns,
        width: element.locked ? base.width : base.width + width,
      });
    }
    setMenu(null);
    navigate(
      {
        row: axis === 'row' ? index : (active?.row ?? 0),
        col: axis === 'col' ? index : (active?.col ?? 0),
      },
      next,
    ).catch(reportSaveFailure);
  };
  const remove = (axis: 'row' | 'col', cell = active) => {
    if (!cell || !canEdit || busyRef.current) {
      return;
    }

    const base = ensureDraft();
    const axisLength = axis === 'row' ? base.rows.length : base.rows[0]!.length;
    if (axisLength < 2) {
      return;
    }

    let next: Draft;
    if (axis === 'row') {
      next = changeDraft(base, {
        rows: base.rows.filter((_row, index) => index !== cell.row),
        rowIds: base.rowIds.filter((_id, index) => index !== cell.row),
      });
    } else {
      const columns = base.widths.filter((_width, index) => index !== cell.col);
      const total = columns.reduce((sum, width) => sum + width, 0);
      next = changeDraft(base, {
        rows: base.rows.map((row) => row.filter((_text, index) => index !== cell.col)),
        columnIds: base.columnIds.filter((_id, index) => index !== cell.col),
        widths: element.locked ? columns.map((width) => (width * base.width) / total) : columns,
        width: element.locked ? base.width : total,
      });
    }
    setMenu(null);
    navigate(
      {
        row: Math.min(cell.row, next.rows.length - 1),
        col: Math.min(cell.col, next.rows[0]!.length - 1),
      },
      next,
    ).catch(reportSaveFailure);
  };
  const handleBeginColumn = (event: ReactPointerEvent<HTMLDivElement>, col: number) => {
    if (!canResize || busyRef.current || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const initial = ensureDraft();
    const measured = root.current?.getBoundingClientRect().width ?? 0;
    drag.current = {
      col,
      x: event.clientX,
      scale: measured > 0 ? measured / initial.width : 1,
      initial,
      next: initial,
    };
    stage(initial);
    setResizing(true);
  };
  const handleMoveColumn = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) {
      return;
    }

    event.stopPropagation();
    const widths = current.initial.widths.map((width, index) =>
      index === current.col
        ? Math.max(40, width + (event.clientX - current.x) / current.scale)
        : width,
    );
    current.next = changeDraft(current.initial, {
      widths,
      width: widths.reduce((sum, width) => sum + width, 0),
    });
    stage(current.next);
  };
  const handleEndColumn = (event: ReactPointerEvent<HTMLDivElement>, cancel = false) => {
    const current = drag.current;
    if (!current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    drag.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancel) {
      stage(active || current.initial.dirty ? current.initial : null);
      return;
    }
    save(current.next, active === null).catch(reportSaveFailure);
  };
  const handleControlsPress = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const handleToolbarKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
    }
  };
  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    handleToolbarKeyDown(event);
    if (event.key === 'Escape') {
      setMenu(null);
    }
  };
  const handleToggleHead = () => {
    const next = changeDraft(ensureDraft(), { head: !head });
    stage(next);
    save(next, !active).catch(reportSaveFailure);
  };
  const handleRetry = () => {
    save(ensureDraft(), !active).catch(reportSaveFailure);
  };
  const handleDiscard = () => {
    stage(null);
    setActive(null);
    setError('');
  };
  const handleTableDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (visibleDetail !== 'full' && event.button === 0) {
      start(0, 0);
    }
  };
  const handleTablePress = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (menu && !(event.target as Element).closest('.studio-table-cell-menu')) {
      setMenu(null);
    }
  };
  const handleCellPress = (
    event: ReactPointerEvent<HTMLTableCellElement>,
    cell: Cell,
    editingCell: boolean,
  ) => {
    const canNavigate = active && canEdit && !busyRef.current;
    if (event.button === 0 && canNavigate && !editingCell) {
      event.preventDefault();
      event.stopPropagation();
      navigate(cell).catch(reportSaveFailure);
    }
  };
  const handleCellDoubleClick = (event: ReactMouseEvent<HTMLTableCellElement>, cell: Cell) => {
    if (event.button === 0) {
      event.stopPropagation();
      start(cell.row, cell.col);
    }
  };
  const handleCellContextMenu = (event: ReactMouseEvent<HTMLTableCellElement>, cell: Cell) => {
    if (!canEdit) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    start(cell.row, cell.col);
    const rect = root.current!.getBoundingClientRect();
    const scale = rect.width / current.width || 1;
    setMenu({
      cell,
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    });
  };
  const handleEditorChange = (value: string, cell: Cell) => {
    const base = ensureDraft();
    const rows = base.rows.map((row, index) => {
      if (index !== cell.row) {
        return row;
      }

      return row.map((text, col) => (col === cell.col ? value : text));
    });
    stage(changeDraft(base, { rows }));
  };
  const handleEditorCommit = () => {
    if (!busyRef.current) {
      save(ensureDraft()).catch(reportSaveFailure);
    }
  };
  const handleEditorBlur = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.relatedTarget;
    const staysInTable = root.current?.contains(target) || controlsRef.current?.contains(target);
    const toolbarFocused = target instanceof Element && target.closest('.studio-selection-toolbar');
    if (busyRef.current || staysInTable || toolbarFocused) {
      event.preventDefault();
    }
  };
  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>, cell: Cell, row: string[]) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing || busyRef.current) {
      return;
    }

    if (event.key === 'Escape' && menu) {
      event.preventDefault();
      setMenu(null);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const command = event.ctrlKey || event.metaKey;
      if (!command && cell.row < rows.length - 1) {
        navigate({ row: cell.row + 1, col: cell.col }).catch(reportSaveFailure);
      } else {
        save(ensureDraft()).catch(reportSaveFailure);
      }
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }

    event.preventDefault();
    const index = cell.row * row.length + cell.col + (event.shiftKey ? -1 : 1);
    if (index < 0) {
      return;
    }

    const base = ensureDraft();
    const next =
      index >= rows.length * row.length
        ? changeDraft(base, {
            rows: [...base.rows, row.map(() => '')],
            rowIds: [...base.rowIds, newClientId('row')],
          })
        : base;
    navigate({ row: Math.floor(index / row.length), col: index % row.length }, next).catch(
      reportSaveFailure,
    );
  };

  const renderControls = () => {
    if (!selected || !canEdit) {
      return null;
    }

    const controls = (
      <div
        ref={controlsRef}
        className="studio-table-controls"
        role="toolbar"
        aria-label="表格操作"
        data-table-controls={element.id}
        style={
          overlayHost
            ? { ...controlsPosition, zIndex: 38, maxWidth: 'calc(100% - 24px)' }
            : undefined
        }
        data-native-interactive="true"
        onPointerDown={handleControlsPress}
        onKeyDown={handleToolbarKeyDown}
      >
        <button type="button" aria-label="添加表格行" onClick={() => insert('row')} disabled={busy}>
          ＋行
        </button>
        <button type="button" aria-label="添加表格列" onClick={() => insert('col')} disabled={busy}>
          ＋列
        </button>
        <button
          type="button"
          aria-label="切换表头"
          aria-pressed={head}
          onClick={handleToggleHead}
          disabled={busy}
        >
          表头
        </button>
        {active && (
          <>
            <button
              type="button"
              aria-label="删除当前行"
              onClick={() => remove('row')}
              disabled={rows.length < 2 || busy}
            >
              删除行
            </button>
            <button
              type="button"
              aria-label="删除当前列"
              onClick={() => remove('col')}
              disabled={rows[0]!.length < 2 || busy}
            >
              删除列
            </button>
          </>
        )}
        {error && (
          <>
            <span role="alert">{error}</span>
            <button type="button" aria-label="重试保存表格" onClick={handleRetry} disabled={busy}>
              重试保存
            </button>
            <button type="button" aria-label="放弃表格草稿" onClick={handleDiscard}>
              放弃草稿
            </button>
          </>
        )}
      </div>
    );

    return overlayHost ? createPortal(controls, overlayHost) : controls;
  };

  const renderCellContent = (row: string[], cell: Cell, editingCell: boolean, preview: boolean) => {
    const text = row[cell.col]!;
    if (editingCell) {
      return (
        <InlineTextEditor
          ref={input}
          className="studio-table-cell-editor"
          ariaLabel={`表格第${cell.row + 1}行第${cell.col + 1}列`}
          disabled={!canEdit}
          value={text}
          onRequestLink={onRequestLink}
          onFormatStateChange={onFormatStateChange}
          onChange={(value) => handleEditorChange(value, cell)}
          onCommit={handleEditorCommit}
          onBlur={handleEditorBlur}
          onKeyDown={(event) => handleEditorKeyDown(event, cell, row)}
        />
      );
    }
    if (!preview) {
      return <RichText text={text} />;
    }
    if (!readablePreviewText) {
      return text.trim() && <span className="studio-table-preview-bar" aria-hidden="true" />;
    }

    return (
      <span className="studio-table-preview-text">
        {parseRichText(text.split(/\r?\n/, 1)[0] ?? '')[0]
          ?.segments.map((segment) => segment.text)
          .join('')}
      </span>
    );
  };

  const renderContent = () => {
    if (visibleDetail === 'outline') {
      return (
        head && (
          <div
            className="studio-table-outline-header"
            aria-hidden="true"
            style={{
              ...headerStyle,
              height: Math.min(element.h, Math.max(previewRowHeight, 2 / zoom)),
            }}
          />
        )
      );
    }

    const preview = visibleDetail === 'preview';
    const visibleRows = preview ? rows.slice(0, head ? 3 : 2) : rows;
    return (
      <table className="studio-board-table" style={{ width: current.width, ...bodyPaint }}>
        <colgroup>
          {widths.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <tbody>
          {visibleRows.map((row, r) => (
            <tr key={r} style={preview ? { height: previewRowHeight } : undefined}>
              {row.map((_text, c) => {
                const isHeader = r === 0 && head;
                const TableCell = isHeader ? 'th' : 'td';
                const cell = { row: r, col: c };
                const editingCell = active?.row === r && active.col === c;
                return (
                  <TableCell
                    key={c}
                    data-cell={`${r}:${c}`}
                    onPointerDown={(event) => handleCellPress(event, cell, editingCell)}
                    onDoubleClick={(event) => handleCellDoubleClick(event, cell)}
                    onContextMenu={(event) => handleCellContextMenu(event, cell)}
                    style={isHeader ? headerStyle : undefined}
                  >
                    {renderCellContent(row, cell, editingCell, preview)}
                  </TableCell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const renderColumnHandles = () => {
    const controlsVisible = detail === 'full' || resizing;
    if (!selected || !canResize || !controlsVisible) {
      return null;
    }

    let edge = 0;
    return widths.map((width, col) => {
      edge += width;
      return (
        <div
          key={col}
          className="studio-table-column-handle"
          data-native-interactive="true"
          role="separator"
          aria-label={`调整第${col + 1}列宽度`}
          aria-orientation="vertical"
          style={{
            position: 'absolute',
            left: edge,
            top: 0,
            bottom: 0,
            width: 8 / zoom,
            marginLeft: -4 / zoom,
            cursor: 'col-resize',
            touchAction: 'none',
            zIndex: 4,
          }}
          onPointerDown={(event) => handleBeginColumn(event, col)}
          onPointerMove={handleMoveColumn}
          onPointerUp={(event) => handleEndColumn(event)}
          onPointerCancel={(event) => handleEndColumn(event, true)}
          onLostPointerCapture={(event) => handleEndColumn(event, true)}
        />
      );
    });
  };

  const renderCellMenu = () => {
    if (!menu) {
      return null;
    }

    return (
      <div
        className="studio-table-cell-menu"
        role="menu"
        data-native-interactive="true"
        style={{ position: 'absolute', left: menu.x, top: menu.y, zIndex: 8 }}
        onPointerDown={handleControlsPress}
        onKeyDown={handleMenuKeyDown}
      >
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => insert('row', menu.cell.row)}
        >
          在上方插入行
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => insert('row', menu.cell.row + 1)}
        >
          在下方插入行
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => insert('col', menu.cell.col)}
        >
          在左侧插入列
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={busy}
          onClick={() => insert('col', menu.cell.col + 1)}
        >
          在右侧插入列
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={busy || rows.length < 2}
          onClick={() => remove('row', menu.cell)}
        >
          删除行
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={busy || rows[0]!.length < 2}
          onClick={() => remove('col', menu.cell)}
        >
          删除列
        </button>
      </div>
    );
  };

  return (
    <div
      ref={root}
      className="studio-native-table"
      data-table-detail={visibleDetail}
      style={{ position: 'relative', width: current.width, height: '100%' }}
      onDoubleClick={handleTableDoubleClick}
      onPointerDownCapture={handleTablePress}
    >
      <div
        className="studio-table-content"
        style={visibleDetail === 'full' ? undefined : bodyPaint}
      >
        {renderContent()}
      </div>
      {renderColumnHandles()}
      {renderControls()}
      {renderCellMenu()}
    </div>
  );
}
