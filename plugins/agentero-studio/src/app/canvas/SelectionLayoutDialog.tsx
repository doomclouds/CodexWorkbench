import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, Loader2 } from 'lucide-react';
import type { Artifact, Board, BoardElement, Operation, StudioClient } from '../../contracts/studio.js';
import type { FlowDirection, FlowLabelSize, FlowLayoutPreview } from '../../contracts/layout.js';
import { StudioDialog } from '../products/dialog.js';
import { newClientId } from '../shared/client-id.js';
import { arrowGeometry, arrowHeads, boundsOf } from './canvas-model.js';
import { geometryBounds } from './native-geometry.js';
import { arrangeSelection, type SelectionArrangement } from './selection-layout.js';
import './selection-layout.css';

interface Props {
  board: Board; ids: string[]; client: StudioClient; initialMode: 'geometry' | 'flow';
  labelSizes: () => Record<string, FlowLabelSize>; canEdit: boolean;
  onApply: (operations: Operation[], summary: string, source: Board, versions: Record<string, number>, operationId: string) => Promise<void>;
  onViewLayout?: (preview: FlowLayoutPreview) => void;
  onDiscardPreview: (requestId: string) => void; onClose: () => void; onError: (message: string) => void;
}
const geometricCommands: [SelectionArrangement, string][] = [
  ['distribute-horizontal', '水平等距'], ['distribute-vertical', '垂直等距'],
  ['same-width', '同宽'], ['same-height', '同高'], ['same-size', '同尺寸'],
  ['row', '成行'], ['column', '成列'], ['grid', '网格整理'],
];
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
export function layoutPreviewStale(board: Board, result: FlowLayoutPreview): boolean {
  return board.artifact.id !== result.artifactId || Object.entries(result.expectedVersions).some(([id, version]) => (id === '$order' ? board.orderVersion ?? 0 : board.elements.find(item => item.id === id)?.version ?? 0) !== version);
}

export function FlowLayoutDrawing({ source, preview, contextIds = [] }: { source: Board; preview: FlowLayoutPreview; contextIds?: readonly string[] }) {
  const updates = new Map(preview.operations.flatMap(operation => operation.id ? [[operation.id, operation.changes ?? {}] as const] : []));
  const elements = source.elements.map(element => ({ ...element, ...updates.get(element.id) }));
  const shown = new Set([...contextIds, ...preview.affectedIds, ...preview.boundaryIds]);
  for (const edge of elements) if (edge.type === 'arrow' && typeof edge.from === 'string' && typeof edge.to === 'string' && shown.has(edge.from) && shown.has(edge.to)) shown.add(edge.id);
  // Include the fixed outside endpoints so a crossing connection's actual effect is visible.
  for (const arrow of elements.filter(element => shown.has(element.id) && element.type === 'arrow')) for (const endpoint of [arrow.from, arrow.to]) if (typeof endpoint === 'string') shown.add(endpoint);
  const nodes = elements.filter(element => shown.has(element.id) && !['arrow', 'stroke'].includes(element.type));
  const edges = elements.filter(element => shown.has(element.id) && element.type === 'arrow');
  const bounds = boundsOf([...nodes.map(element => geometryBounds(element, elements)), ...edges.flatMap(element => {
    const route = arrowGeometry(element, elements), points = route.points;
    const left = Math.min(...points.map(point => point.x)), top = Math.min(...points.map(point => point.y));
    return [{ x: left, y: top, w: Math.max(...points.map(point => point.x)) - left, h: Math.max(...points.map(point => point.y)) - top }, ...(element.label ? [{ x: route.label.x - (element.labelSize?.w ?? 200) / 2, y: route.label.y - (element.labelSize?.h ?? 54) / 2, w: element.labelSize?.w ?? 200, h: element.labelSize?.h ?? 54 }] : [])];
  })]);
  if (!bounds) return null;
  return <svg className="studio-layout-drawing" role="img" aria-label="流程排布预览" viewBox={`${bounds.x - 32} ${bounds.y - 32} ${Math.max(1, bounds.w) + 64} ${Math.max(1, bounds.h) + 64}`}>
    <defs><marker id="studio-layout-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1 1L8 5L1 9" fill="none" stroke="currentColor" /></marker></defs>
    {edges.map(edge => { const route = arrowGeometry(edge, elements), boundary = preview.boundaryIds.includes(edge.id), heads = arrowHeads(edge); return <g key={edge.id} className={boundary ? 'is-boundary' : preview.affectedIds.includes(edge.id) || JSON.stringify(arrowGeometry(source.elements.find(item => item.id === edge.id)!, source.elements).points) !== JSON.stringify(route.points) ? 'is-affected' : 'is-fixed'}><path d={route.path} fill="none" stroke="currentColor" strokeWidth="1.8" markerStart={heads[0] === 'arrow' ? 'url(#studio-layout-head)' : undefined} markerEnd={heads[1] === 'arrow' ? 'url(#studio-layout-head)' : undefined} />{heads.map((head, index) => head === 'circle' && <circle key={index} cx={(index ? route.points.at(-1)! : route.points[0]).x} cy={(index ? route.points.at(-1)! : route.points[0]).y} r="4" fill="var(--studio-bg)" stroke="currentColor" />)}{edge.label && <foreignObject x={route.label.x - (edge.labelSize?.w ?? 200) / 2} y={route.label.y - (edge.labelSize?.h ?? 54) / 2} width={edge.labelSize?.w ?? 200} height={edge.labelSize?.h ?? 54} overflow="visible"><div className="studio-layout-edge-label">{edge.label}</div></foreignObject>}</g>; })}
    {nodes.map(node => <g key={node.id} className={preview.affectedIds.includes(node.id) ? 'is-affected' : 'is-fixed'}><rect x={node.x} y={node.y} width={node.w} height={node.h} rx="6" /><foreignObject x={node.x + 8} y={node.y + 6} width={Math.max(1, node.w - 16)} height={Math.max(1, node.h - 12)}><div className="studio-layout-node-label">{(node.text || node.type).slice(0, 200)}</div></foreignObject></g>)}
  </svg>;
}

export default function SelectionLayoutDialog({ board, ids, client, initialMode, labelSizes, canEdit, onApply, onViewLayout, onDiscardPreview, onClose, onError }: Props) {
  const [mode, setMode] = useState(initialMode), [gap, setGap] = useState(24), [flowGap, setFlowGap] = useState(64);
  const [direction, setDirection] = useState<FlowDirection>('right');
  const [running, setRunning] = useState(false), [applying, setApplying] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{ result: FlowLayoutPreview; source: Board } | null>(null);
  const request = useRef<string | null>(null), generation = useRef(0), alive = useRef(true);
  const callbacks = useRef({ onDiscardPreview, onError }); callbacks.current = { onDiscardPreview, onError };
  const cancel = () => {
    generation.current++; const requestId = request.current; request.current = null;
    if (!requestId) return;
    callbacks.current.onDiscardPreview(requestId);
    void client.call('artifact_read', { artifactId: board.artifact.id, mode: 'layout-cancel', requestId }).catch(cause => callbacks.current.onError(`未能确认停止布局计算：${message(cause)}`));
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancel(); }; }, []);
  const reset = () => { cancel(); setPreview(null); setRunning(false); setError(''); setNotice(''); };
  const close = () => { if (applying) return; reset(); onClose(); };
  async function calculate() {
    reset(); const requestId = newClientId('layout'), ticket = generation.current;
    request.current = requestId; setRunning(true);
    let source = structuredClone(board);
    try {
      const result = await client.call<FlowLayoutPreview>('artifact_read', { artifactId: board.artifact.id, mode: 'layout-preview', requestId, ids, direction, gap: flowGap, labelSizes: labelSizes() });
      if (!alive.current || generation.current !== ticket) return;
      if (layoutPreviewStale(source, result)) {
        const basisIds = Object.keys(result.expectedVersions).filter(id => !id.startsWith('$'));
        const exact = new Map<string, BoardElement>(); let artifact: Artifact | undefined;
        for (let offset = 0; offset < basisIds.length; offset += 200) {
          const batch = await client.call<{ artifact: Artifact; units: { id: string; after: BoardElement | null }[] }>('artifact_read', { artifactId: result.artifactId, mode: 'units', atRevision: result.revision, ids: basisIds.slice(offset, offset + 200) });
          artifact = batch.artifact;
          for (const unit of batch.units) { if (!unit.after && result.expectedVersions[unit.id] === 0) continue; if (!unit.after || unit.after.version !== result.expectedVersions[unit.id]) throw new Error('布局依据版本已不可用，请重新预览。'); exact.set(unit.id, unit.after); }
        }
        source = { ...source, artifact: artifact || source.artifact, orderVersion: result.expectedVersions.$order ?? source.orderVersion, elements: [...source.elements.filter(element => !basisIds.includes(element.id)), ...exact.values()] };
      }
      if (!alive.current || generation.current !== ticket) return;
      setPreview({ result, source });
    } catch (cause) { if (alive.current && generation.current === ticket) setError(message(cause)); }
    finally { if (alive.current && generation.current === ticket) setRunning(false); }
  }
  async function applyGeometry(kind: SelectionArrangement, label: string) {
    setError(''); setNotice(''); setApplying(true);
    try {
      const result = arrangeSelection(board.elements, ids, kind, gap);
      if (result.operations.length) {
        const versions = { ...Object.fromEntries(board.elements.filter(element => result.basisIds.includes(element.id)).map(element => [element.id, element.version])), $order: board.orderVersion ?? 0 };
        await onApply(result.operations, label, board, versions, newClientId('arrange'));
        if (alive.current) setNotice([`${label}已应用。`, ...result.warnings].join(' '));
      } else setNotice(result.warnings.join(' ') || '选区已满足这个排列，无需调整。');
    } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setApplying(false); }
  }
  async function applyFlow() {
    if (!preview || layoutPreviewStale(board, preview.result)) return;
    setApplying(true); setError('');
    try {
      await onApply(preview.result.operations, direction === 'right' ? '从左到右流程排布' : '从上到下流程排布', preview.source, preview.result.expectedVersions, preview.result.requestId);
      onViewLayout?.(preview.result);
      request.current = null; onClose();
    } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setApplying(false); }
  }
  const stale = preview && layoutPreviewStale(board, preview.result);
  return <StudioDialog title="整理选区" wide onClose={close}>
    <div className="studio-layout-tabs" role="tablist" aria-label="整理方式"><button type="button" role="tab" aria-selected={mode === 'geometry'} disabled={applying} onClick={() => { reset(); setMode('geometry'); }}>几何整理</button><button type="button" role="tab" aria-selected={mode === 'flow'} disabled={applying} onClick={() => { reset(); setMode('flow'); }}>按流程排布</button></div>
    {mode === 'geometry' ? <div className="studio-layout-geometry"><p>等距固定最外侧对象；同尺寸以最大外框为准，不改正文或字号。组合与分区按整体处理。</p><label className="studio-layout-gap">排列间距 <input aria-label="排列间距" type="number" min="0" max="1000" value={gap} disabled={applying} onChange={event => setGap(Number(event.target.value))} /> px</label><div className="studio-layout-commands">{geometricCommands.map(([kind, label]) => <button type="button" className="studio-button" key={kind} disabled={!canEdit || applying} onClick={() => void applyGeometry(kind, label)}>{label}</button>)}</div></div> : <>
      <p className="studio-layout-description">按选中节点与内部连接安排流程。预览不保存；实线标出调整内容，橙色虚线是跨选区连接，灰色虚线内容保持原位。回路会参考对象顺序安排，应用前可在预览中核对。</p>
      <div className="studio-layout-options"><div className="studio-layout-direction" role="group" aria-label="流程方向"><button type="button" className="studio-button" aria-pressed={direction === 'right'} disabled={applying} onClick={() => { reset(); setDirection('right'); }}><ArrowRight size={16} />从左到右</button><button type="button" className="studio-button" aria-pressed={direction === 'down'} disabled={applying} onClick={() => { reset(); setDirection('down'); }}><ArrowDown size={16} />从上到下</button></div><label className="studio-layout-gap">流程间距 <input aria-label="流程间距" type="number" min="16" max="500" value={flowGap} disabled={applying} onChange={event => { reset(); setFlowGap(Number(event.target.value)); }} /> px</label><button type="button" className="studio-button" disabled={!canEdit || applying || running} onClick={() => void calculate()}>{running && <Loader2 size={15} className="studio-spin" />}{running ? '正在计算…' : preview ? '重新预览' : '生成预览'}</button></div>
      {preview && <><FlowLayoutDrawing source={preview.source} preview={preview.result} contextIds={ids} /><p className="studio-layout-summary">本次调整 {preview.result.affectedIds.length} 个对象；{preview.result.boundaryIds.length} 条跨选区连接保留绑定。一次应用可整体撤销。</p>{preview.result.skipped.length > 0 && <div className="studio-layout-skipped"><strong>以下内容保留原位</strong><ul>{preview.result.skipped.map((item, index) => <li key={index}>{item.ids.join('、')}：{item.reason}</li>)}</ul></div>}{preview.result.warnings.map((warning, index) => <p className="studio-layout-warning" key={index}>{warning}</p>)}{!preview.result.operations.length && <p className="studio-layout-warning">没有可应用的调整，请查看保留原因或更改选区。</p>}{stale && <p className="studio-layout-warning" role="status">布局依据已更新，请重新预览后再应用。</p>}</>}
    </>}
    {notice && <p role="status" className="studio-layout-notice">{notice}</p>}{error && <p role="alert" className="studio-layout-error">{error}</p>}
    <div className="studio-modal-footer"><button type="button" className="studio-button" disabled={applying} onClick={close}>{running ? '取消计算' : '关闭'}</button>{mode === 'flow' && <button type="button" className="studio-button studio-primary" disabled={!canEdit || applying || running || !preview?.result.operations.length || !!stale} onClick={() => void applyFlow()}>{applying ? '正在应用…' : '应用排布'}</button>}</div>
  </StudioDialog>;
}
