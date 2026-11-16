import type { ElkNode, ElkExtendedEdge, ElkPort, ElkPoint } from 'elkjs/lib/elk-api.js';
import type { BoardElement, Operation } from '../../contracts/studio.js';
import type { FlowDirection, FlowLabelSize, FlowLayoutPreview } from '../../contracts/layout.js';
import { object, safeId, StudioError } from '../shared/common.js';
import { arrowGeometry } from './whiteboard-geometry.js';

type PreviewBody = Omit<FlowLayoutPreview, 'artifactId' | 'revision'>;
interface Component { ids: string[]; edges: BoardElement[]; reason?: string }
export interface PreparedFlowLayout {
  requestId: string; direction: FlowDirection; gap: number; elements: readonly BoardElement[];
  graph?: ElkNode; components: Component[]; nodes: BoardElement[]; edges: BoardElement[];
  expectedVersions: Record<string, number>; boundaryIds: string[];
  skipped: FlowLayoutPreview['skipped']; warnings: string[];
}
const sides = ['top', 'right', 'bottom', 'left'] as const;
type Side = typeof sides[number];
const elkSide: Record<Side, string> = { top: 'NORTH', right: 'EAST', bottom: 'SOUTH', left: 'WEST' };
const nodeId = (id: string) => `n:${id}`;
const edgeId = (id: string) => `e:${id}`;
const point = (value: ElkPoint | undefined): value is ElkPoint => Boolean(value && Number.isFinite(value.x) && Number.isFinite(value.y) && Math.abs(value.x) <= 10_000_000 && Math.abs(value.y) <= 10_000_000);
const name = (element: BoardElement) => element.text?.slice(0, 30) || element.id;
function bounds(elements: readonly BoardElement[]) {
  return { x: Math.min(...elements.map(item => item.x)), y: Math.min(...elements.map(item => item.y)), right: Math.max(...elements.map(item => item.x + item.w)), bottom: Math.max(...elements.map(item => item.y + item.h)) };
}
function labelSize(arrow: BoardElement, measured: Map<string, FlowLabelSize>, warnings: string[]): FlowLabelSize {
  const actual = measured.get(arrow.id); if (actual) return actual;
  const widths = String(arrow.label).split('\n').map(line => [...line].reduce((total, char) => total + (/[^\x00-\xff]/.test(char) ? 13 : 7.5), 0));
  const w = Math.max(28, Math.min(200, Math.max(...widths) + 14)), lines = widths.reduce((total, width) => total + Math.max(1, Math.ceil(width / (w - 14))), 0);
  warnings.push(`连接线“${arrow.label!.slice(0, 24)}”未提供界面测量，使用保守标签尺寸，请检查预览。`);
  const h = 6 + lines * 17;
  if (h > 2000) throw new StudioError('TOO_LARGE', '连接线标签过长，无法可靠估计尺寸，请缩短标签或提供界面测量。');
  return { w, h };
}
function port(node: BoardElement, arrow: BoardElement, end: 'from' | 'to', direction: FlowDirection): ElkPort {
  const value = arrow[end === 'from' ? 'fromSide' : 'toSide'];
  if (value !== undefined && !sides.includes(value as Side)) throw new StudioError('INVALID_ARGUMENT', '连接线端口方向无效。');
  const side = (value ?? (direction === 'right' ? end === 'from' ? 'right' : 'left' : end === 'from' ? 'bottom' : 'top')) as Side;
  return { id: `p:${arrow.id}:${end}`, x: side === 'left' ? 0 : side === 'right' ? node.w : node.w / 2, y: side === 'top' ? 0 : side === 'bottom' ? node.h : node.h / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': elkSide[side] } };
}

/** Produce a bounded, geometry-only graph. Content remains owned by the original objects. */
export function prepareFlowLayout(elements: readonly BoardElement[], args: Record<string, unknown>, orderVersion = 0): PreparedFlowLayout {
  const requestId = safeId(args.requestId, '布局请求 ID');
  if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 200) throw new StudioError('INVALID_ARGUMENT', '流程布局需要 1 至 200 个选区对象 ID。');
  const ids = new Set(args.ids.map(id => safeId(id, '对象 ID')));
  const direction = args.direction === undefined ? 'right' : args.direction;
  if (direction !== 'right' && direction !== 'down') throw new StudioError('INVALID_ARGUMENT', '流程方向只支持 right 或 down。');
  const gap = args.gap === undefined ? 64 : args.gap;
  if (typeof gap !== 'number' || !Number.isFinite(gap) || gap < 16 || gap > 500) throw new StudioError('INVALID_ARGUMENT', '流程间距须在 16 至 500 之间。');
  const measured = new Map<string, FlowLabelSize>();
  if (args.labelSizes !== undefined) {
    if (!object(args.labelSizes) || Object.keys(args.labelSizes).length > 200) throw new StudioError('INVALID_ARGUMENT', '连接线标签测量无效。');
    for (const [id, size] of Object.entries(args.labelSizes)) {
      if (!object(size) || [size.w, size.h].some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 2000)) throw new StudioError('INVALID_ARGUMENT', '连接线标签尺寸须在 1 至 2000 之间。');
      measured.set(id, { w: Number(size.w), h: Number(size.h) });
    }
  }
  const byId = new Map(elements.map(item => [item.id, item]));
  // Any existing object can become an arrow or acquire a selected endpoint without changing order.
  const expectedVersions: Record<string, number> = { $order: orderVersion, ...Object.fromEntries(elements.map(item => [item.id, item.version])) };
  for (const id of ids) if (!byId.has(id)) throw new StudioError('NOT_FOUND', '选区对象已不存在，请重新选择。', { elementId: id });
  const nodes = elements.filter(item => ids.has(item.id) && !['arrow', 'stroke'].includes(item.type));
  if (!nodes.length) return { requestId, direction, gap, elements, components: [], nodes: [], edges: [], expectedVersions, boundaryIds: [], skipped: [{ ids: [...ids], reason: '连接线和笔迹不单独排布，请选择需要排布的节点。' }], warnings: [] };
  const selectedNodes = new Set(nodes.map(item => item.id));
  const arrows = elements.filter(item => item.type === 'arrow');
  const internal = arrows.filter(item => typeof item.from === 'string' && typeof item.to === 'string' && selectedNodes.has(item.from) && selectedNodes.has(item.to));
  const boundary = arrows.filter(item => Number(typeof item.from === 'string' && selectedNodes.has(item.from)) + Number(typeof item.to === 'string' && selectedNodes.has(item.to)) === 1);
  if (nodes.length + internal.length > 200) throw new StudioError('TOO_LARGE', '本次流程布局最多涉及 200 个节点与内部连线，请缩小选区。');
  for (const arrow of boundary) for (const end of [arrow.from, arrow.to]) if (typeof end === 'string') expectedVersions[safeId(end, '端点对象 ID')] = byId.get(end)?.version ?? 0;
  const parents = new Map(nodes.map(item => [item.id, item.id]));
  const root = (id: string): string => parents.get(id) === id ? id : root(parents.get(id)!);
  for (const arrow of internal) parents.set(root(arrow.to as string), root(arrow.from as string));
  const groups = new Map<string, BoardElement[]>();
  for (const node of nodes) { const key = root(node.id); groups.set(key, [...groups.get(key) ?? [], node]); }
  const components: Component[] = [...groups.values()].map(group => {
    const keys = new Set(group.map(item => item.id)), edges = internal.filter(item => keys.has(item.from as string));
    let reason: string | undefined;
    if (group.some(item => item.locked) || [...edges, ...boundary.filter(item => keys.has(String(item.from)) || keys.has(String(item.to)))].some(item => item.locked)) reason = '包含锁定节点或锁定连接线，整个连通分量保持原位。';
    else if (group.some(item => item.groupId || item.parentId || item.type === 'container')) reason = '首版仅排布同层独立节点；分组及嵌套分区请使用几何整理。';
    else if (group.some(item => Number(item.rotation ?? 0) % 360)) reason = '旋转节点的端口暂不能完整表示，整个连通分量保持原位。';
    else if (group.some(item => ![item.x, item.y, item.w, item.h].every(Number.isFinite) || item.w <= 0 || item.h <= 0)) reason = '节点尺寸无效，整个连通分量保持原位。';
    return { ids: [...keys], edges, reason };
  });
  const skipped = components.filter(item => item.reason).map(item => ({ ids: [...item.ids, ...item.edges.map(edge => edge.id)], reason: item.reason! }));
  const active = new Set(components.filter(item => !item.reason).flatMap(item => item.ids));
  const activeNodes = nodes.filter(item => active.has(item.id)), edges = internal.filter(item => active.has(item.from as string));
  const warnings: string[] = [];
  const graph: ElkNode | undefined = activeNodes.length ? {
    id: 'flow-root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': direction === 'right' ? 'RIGHT' : 'DOWN', 'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER', 'elk.edgeRouting': 'ORTHOGONAL', 'elk.spacing.nodeNode': String(gap), 'elk.layered.spacing.nodeNodeBetweenLayers': String(gap), 'elk.spacing.edgeNode': '24', 'elk.spacing.edgeLabel': '12', 'elk.separateConnectedComponents': 'true', 'elk.padding': '[top=0,left=0,bottom=0,right=0]' },
    children: activeNodes.map(node => ({ id: nodeId(node.id), width: node.w, height: node.h, layoutOptions: { 'elk.portConstraints': 'FIXED_POS' }, ports: edges.flatMap(edge => [...(edge.from === node.id ? [port(node, edge, 'from', direction)] : []), ...(edge.to === node.id ? [port(node, edge, 'to', direction)] : [])]) })),
    edges: edges.map(arrow => ({ id: edgeId(arrow.id), sources: [`p:${arrow.id}:from`], targets: [`p:${arrow.id}:to`], ...(typeof arrow.label === 'string' && arrow.label.length ? { labels: [{ id: `l:${arrow.id}`, text: arrow.label, ...(() => { const size = labelSize(arrow, measured, warnings); return { width: size.w, height: size.h }; })(), layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } }] } : {}) })),
  } : undefined;
  return { requestId, direction, gap, elements, graph, components, nodes, edges, expectedVersions, boundaryIds: boundary.map(item => item.id), skipped, warnings };
}

function route(edge: ElkExtendedEdge | undefined): ElkPoint[] | undefined {
  if (edge?.sections?.length !== 1) return;
  const section = edge.sections[0], original = [section.startPoint, ...section.bendPoints ?? [], section.endPoint];
  if (!original.every(point)) return;
  const points: ElkPoint[] = [];
  for (const current of original) {
    if (points.length && Math.abs(points.at(-1)!.x - current.x) < .001 && Math.abs(points.at(-1)!.y - current.y) < .001) continue;
    const before = points.at(-2), previous = points.at(-1);
    if (before && previous && (Math.abs(before.x - previous.x) < .001 && Math.abs(previous.x - current.x) < .001 || Math.abs(before.y - previous.y) < .001 && Math.abs(previous.y - current.y) < .001) && (previous.x - before.x) * (current.x - previous.x) + (previous.y - before.y) * (current.y - previous.y) >= 0) points.pop();
    points.push(current);
  }
  if (points.length < 2 || points.length > 14 || points.some((item, index) => index > 0 && Math.abs(item.x - points[index - 1].x) > .001 && Math.abs(item.y - points[index - 1].y) > .001)) return;
  return points;
}

/** Convert only representable components; no truncated or replacement routes are accepted. */
export function finishFlowLayout(prepared: PreparedFlowLayout, graph?: ElkNode): PreviewBody {
  const skipped = [...prepared.skipped], warnings = [...prepared.warnings];
  const nodeMap = new Map(graph?.children?.map(item => [item.id, item]) ?? []), edgeMap = new Map(graph?.edges?.map(item => [item.id, item]) ?? []);
  const paths = new Map(prepared.edges.map(item => [item.id, route(edgeMap.get(edgeId(item.id)))]));
  const positions = prepared.elements.map(item => nodeMap.has(nodeId(item.id)) ? { ...item, x: nodeMap.get(nodeId(item.id))!.x!, y: nodeMap.get(nodeId(item.id))!.y! } : item);
  const valid = prepared.components.filter(item => {
    if (item.reason) return false;
    if (item.ids.some(id => !point(nodeMap.get(nodeId(id)) as ElkPoint | undefined)) || item.edges.some(edge => {
      const label = edgeMap.get(edgeId(edge.id))?.labels?.[0];
      return !paths.get(edge.id) || edge.label && (!point(label as ElkPoint | undefined) || !Number.isFinite(label!.width) || !Number.isFinite(label!.height));
    })) {
      skipped.push({ ids: [...item.ids, ...item.edges.map(edge => edge.id)], reason: '算法结果的节点、标签或路径无法完整表示，未应用该连通分量。' }); return false;
    }
    for (const arrow of item.edges) {
      const points = paths.get(arrow.id)!;
      const candidate = { ...arrow, bends: points.slice(1, -1).flatMap(item => [item.x, item.y]), fromSide: arrow.fromSide ?? (prepared.direction === 'right' ? 'right' : 'bottom'), toSide: arrow.toSide ?? (prepared.direction === 'right' ? 'left' : 'top'), labelOffset: undefined };
      const natural = arrowGeometry(candidate, positions);
      if (Math.hypot(natural.points[0].x - points[0].x, natural.points[0].y - points[0].y) > .01 || Math.hypot(natural.points.at(-1)!.x - points.at(-1)!.x, natural.points.at(-1)!.y - points.at(-1)!.y) > .01) {
        skipped.push({ ids: [...item.ids, ...item.edges.map(edge => edge.id)], reason: `连接线 ${name(arrow)} 的端口或路径无法完整保留，未应用该连通分量。` }); return false;
      }
    }
    return true;
  });
  const ids = new Set(valid.flatMap(item => item.ids));
  const selected = prepared.nodes.filter(item => ids.has(item.id));
  const operations: Operation[] = [];
  if (selected.length) {
    const original = bounds(selected), positions = bounds(selected.map(item => ({ ...item, x: nodeMap.get(nodeId(item.id))!.x!, y: nodeMap.get(nodeId(item.id))!.y! })));
    let dx = original.x - positions.x, dy = original.y - positions.y;
    const frozen = prepared.nodes.filter(item => !ids.has(item.id));
    const overlaps = frozen.some(item => original.x < item.x + item.w + prepared.gap && original.x + positions.right - positions.x + prepared.gap > item.x && original.y < item.y + item.h + prepared.gap && original.y + positions.bottom - positions.y + prepared.gap > item.y);
    if (overlaps) {
      if (prepared.direction === 'right') dy = Math.max(...frozen.map(item => item.y + item.h)) + prepared.gap - positions.y;
      else dx = Math.max(...frozen.map(item => item.x + item.w)) + prepared.gap - positions.x;
      warnings.push('已避开保持原位的选区分量，未移动这些对象。');
    }
    const nextNodes = selected.map(item => ({ ...item, x: nodeMap.get(nodeId(item.id))!.x! + dx, y: nodeMap.get(nodeId(item.id))!.y! + dy }));
    const live = prepared.elements.map(item => nextNodes.find(node => node.id === item.id) ?? item);
    for (const node of nextNodes) operations.push({ op: 'update', id: node.id, changes: { x: node.x, y: node.y } });
    for (const arrow of prepared.edges.filter(item => ids.has(item.from as string))) {
      const points = paths.get(arrow.id)!.map(item => ({ x: item.x + dx, y: item.y + dy }));
      const changes: Partial<BoardElement> = { bends: points.slice(1, -1).flatMap(item => [item.x, item.y]), fromSide: arrow.fromSide ?? (prepared.direction === 'right' ? 'right' : 'bottom'), toSide: arrow.toSide ?? (prepared.direction === 'right' ? 'left' : 'top') };
      const natural = arrowGeometry({ ...arrow, ...changes, labelOffset: undefined }, live);
      const label = edgeMap.get(edgeId(arrow.id))?.labels?.[0];
      if (arrow.label && label) {
        changes.labelOffset = { x: label.x! + dx + label.width! / 2 - natural.label.x, y: label.y! + dy + label.height! / 2 - natural.label.y };
        changes.labelSize = { w: label.width!, h: label.height! };
      }
      operations.push({ op: 'update', id: arrow.id, changes });
    }
  }
  const invalid = new Set<string>();
  for (const component of valid) {
    const keys = new Set([...component.ids, ...component.edges.map(item => item.id)]);
    if (operations.some(operation => keys.has(operation.id!) && [operation.changes?.x, operation.changes?.y, ...(operation.changes?.bends ?? []), ...Object.values(operation.changes?.labelOffset as Record<string, number> ?? {})].some(value => typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 10_000_000)))) {
      keys.forEach(id => invalid.add(id)); skipped.push({ ids: [...keys], reason: '布局结果超过白板坐标范围，未应用该连通分量。' });
    }
  }
  const accepted = operations.filter(item => !invalid.has(item.id!) && Object.entries(item.changes ?? {}).some(([field, value]) => JSON.stringify(prepared.elements.find(element => element.id === item.id)?.[field]) !== JSON.stringify(value)));
  return { requestId: prepared.requestId, direction: prepared.direction, gap: prepared.gap, operations: accepted, expectedVersions: prepared.expectedVersions, affectedIds: accepted.map(item => item.id!), boundaryIds: prepared.boundaryIds, skipped, warnings };
}
