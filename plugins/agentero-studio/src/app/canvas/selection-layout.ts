import type { BoardElement, Operation } from '../../contracts/studio.js';
import { boundsOf, moveOperations, type Rect } from './canvas-model.js';
import { geometryBounds, resizeSelection } from './native-geometry.js';

export type SelectionArrangement = 'distribute-horizontal' | 'distribute-vertical' | 'same-width' | 'same-height' | 'same-size' | 'row' | 'column' | 'grid';
interface Unit { ids: string[]; bounds: Rect; frame: Rect }
export interface SelectionArrangementResult { operations: Operation[]; basisIds: string[]; skippedIds: string[]; warnings: string[] }

/** A selected group or frame is one unit, including unselected and locked descendants. */
function unitsFor(elements: readonly BoardElement[], selected: readonly string[]): Unit[] {
  const units: Set<string>[] = [];
  for (const element of elements.filter(item => selected.includes(item.id) && !['arrow', 'stroke'].includes(item.type))) {
    const ids = new Set([element.id]);
    let changed = true;
    while (changed) {
      changed = false;
      const members = elements.filter(item => ids.has(item.id)), groups = new Set(members.flatMap(item => item.groupId ? [item.groupId] : []));
      const frames = members.filter(item => item.type === 'container');
      for (const item of elements) {
        if (ids.has(item.id)) continue;
        const box = frames.length ? geometryBounds(item, elements) : undefined;
        const contained = box && frames.some(frame => box.x >= frame.x && box.y >= frame.y && box.x + box.w <= frame.x + frame.w && box.y + box.h <= frame.y + frame.h);
        if (item.groupId && groups.has(item.groupId) || item.parentId && ids.has(item.parentId) || contained || item.type === 'arrow' && typeof item.from === 'string' && typeof item.to === 'string' && ids.has(item.from) && ids.has(item.to)) { ids.add(item.id); changed = true; }
        if (ids.size > 200) throw new Error('一次最多整理 200 个对象（含组内内容），请缩小选区。');
      }
    }
    const overlaps = units.filter(unit => [...ids].some(id => unit.has(id)));
    for (const unit of overlaps) { for (const id of unit) ids.add(id); units.splice(units.indexOf(unit), 1); }
    units.push(ids);
  }
  return units.map(ids => {
    const members = elements.filter(item => ids.has(item.id));
    const bounds = boundsOf(members.map(item => geometryBounds(item, elements)))!;
    return { ids: [...ids], bounds, frame: members.length === 1 ? { x: members[0].x, y: members[0].y, w: members[0].w, h: members[0].h } : bounds };
  });
}

export function arrangeSelection(elements: readonly BoardElement[], selected: readonly string[], arrangement: SelectionArrangement, gap = 24): SelectionArrangementResult {
  if (selected.length > 200) throw new Error('一次最多整理 200 个对象，请缩小选区。');
  if (!Number.isFinite(gap) || gap < 0 || gap > 1000) throw new Error('间距须为 0 到 1000 像素。');
  const allUnits = unitsFor(elements, selected), skippedIds: string[] = [], warnings: string[] = [];
  if (new Set(allUnits.flatMap(unit => unit.ids)).size > 200) throw new Error('一次最多整理 200 个对象（含组内内容），请缩小选区。');
  const members = new Set(allUnits.flatMap(unit => unit.ids)), basis = new Set(elements.map(element => element.id));
  for (const item of elements) if (item.type === 'arrow' && (typeof item.from === 'string' && members.has(item.from) || typeof item.to === 'string' && members.has(item.to))) {
    basis.add(item.id); if (typeof item.from === 'string') basis.add(item.from); if (typeof item.to === 'string') basis.add(item.to);
  }
  const basisIds = [...basis];
  let lockedUnits = 0, externallyBoundUnits = 0;
  const units = allUnits.filter(unit => {
    const locked = elements.some(item => item.locked && (unit.ids.includes(item.id) || item.type === 'arrow' && (typeof item.from === 'string' && unit.ids.includes(item.from) || typeof item.to === 'string' && unit.ids.includes(item.to))));
    const externallyBound = elements.some(item => unit.ids.includes(item.id) && item.type === 'arrow' && [item.from, item.to].some(endpoint => typeof endpoint === 'string' && !unit.ids.includes(endpoint)));
    if (locked || externallyBound) { skippedIds.push(...unit.ids); if (locked) lockedUnits++; else externallyBoundUnits++; return false; }
    return true;
  }).sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  if (lockedUnits) warnings.push(`已跳过 ${lockedUnits} 组含锁定对象或连接的内容。`);
  if (externallyBoundUnits) warnings.push(`已跳过 ${externallyBoundUnits} 组含外部绑定连接的内容，无法整体平移；外部对象保持原位。`);
  if (units.length < 2) return { operations: [], basisIds, skippedIds, warnings: [...warnings, '请选择至少两个可整理的独立对象或组。'] };
  const operations: Operation[] = [];
  if (arrangement.startsWith('distribute-')) {
    if (units.length < 3) return { operations, basisIds, skippedIds, warnings: [...warnings, '等距分布需要至少三个独立对象或组。'] };
    const axis = arrangement === 'distribute-horizontal' ? 'x' : 'y', extent = axis === 'x' ? 'w' : 'h';
    units.sort((a, b) => a.bounds[axis] - b.bounds[axis]);
    const first = units[0].bounds[axis], last = units.at(-1)!.bounds;
    if (last[axis] + last[extent] < Math.max(...units.map(unit => unit.bounds[axis] + unit.bounds[extent]))) return { operations, basisIds, skippedIds, warnings: [...warnings, '对象交叠使外侧顺序不明确，请先拉开对象再等距分布。'] };
    const interval = (last[axis] + last[extent] - first - units.reduce((sum, unit) => sum + unit.bounds[extent], 0)) / (units.length - 1);
    if (interval < 0) return { operations, basisIds, skippedIds, warnings: [...warnings, '最外侧对象之间空间不足，请先拉开两端再等距分布。'] };
    let at = first;
    units.forEach((unit, index) => {
      if (index > 0 && index < units.length - 1) operations.push(...moveOperations(elements, unit.ids, { x: axis === 'x' ? at - unit.bounds.x : 0, y: axis === 'y' ? at - unit.bounds.y : 0 }));
      at += unit.bounds[extent] + interval;
    });
  } else if (arrangement.startsWith('same-')) {
    const width = Math.max(...units.map(unit => unit.frame.w)), height = Math.max(...units.map(unit => unit.frame.h));
    for (const unit of units) {
      const next = { ...unit.frame, w: arrangement === 'same-height' ? unit.frame.w : width, h: arrangement === 'same-width' ? unit.frame.h : height };
      if (next.w !== unit.frame.w || next.h !== unit.frame.h) {
        if (unit.ids.length === 1) operations.push({ op: 'update', id: unit.ids[0], changes: { x: next.x, y: next.y, w: next.w, h: next.h } });
        else operations.push(...resizeSelection(elements, unit.ids, unit.frame, next));
      }
    }
  } else {
    const bounds = boundsOf(units.map(unit => unit.bounds))!;
    const columns = arrangement === 'column' ? 1 : arrangement === 'row' ? units.length : Math.ceil(Math.sqrt(units.length));
    const widths = Array.from({ length: columns }, (_, column) => Math.max(...units.filter((_, index) => index % columns === column).map(unit => unit.bounds.w)));
    const rows = Math.ceil(units.length / columns);
    const heights = Array.from({ length: rows }, (_, row) => Math.max(...units.slice(row * columns, (row + 1) * columns).map(unit => unit.bounds.h)));
    units.forEach((unit, index) => {
      const column = index % columns, row = Math.floor(index / columns);
      const x = bounds.x + widths.slice(0, column).reduce((sum, value) => sum + value + gap, 0);
      const y = bounds.y + heights.slice(0, row).reduce((sum, value) => sum + value + gap, 0);
      operations.push(...moveOperations(elements, unit.ids, { x: x - unit.bounds.x, y: y - unit.bounds.y }));
    });
  }
  return { operations: operations.filter(operation => {
    const original = elements.find(item => item.id === operation.id)!;
    return Object.entries(operation.changes ?? {}).some(([key, value]) => JSON.stringify(original[key]) !== JSON.stringify(value));
  }), basisIds, skippedIds, warnings };
}
