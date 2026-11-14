import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { FileCode2, Loader2, Share2 } from 'lucide-react';
import type { Artifact, Board, HtmlSelection, Operation, StudioClient } from '../../contracts/studio';
import type { ProductActivity, ProductAnnotation, ProductDescriptor, ProductDifferenceProps, ProductEditorProps, ProductPreviewProps, ProductToolbarProps } from '../products';
import WhiteboardCanvas from '../canvas/WhiteboardCanvas';
import { StudioDialog } from './dialog';
import { downloadStudioBlob, downloadStudioFile, studioRequest } from '../transport';
import { newClientId } from '../shared/client-id.js';

function downloadableUrl(client: StudioClient, path: string): string {
  const url = new URL(path, client.baseUrl || window.location.href);
  if (client.token && client.baseUrl && url.origin === new URL(client.baseUrl).origin) url.searchParams.set('token', client.token);
  return url.href;
}
function thumbnailUrl(client: StudioClient, thumbnail: string): string | undefined {
  if (/^data:image\/(png|jpeg|webp|svg\+xml)[;,]/i.test(thumbnail)) return thumbnail;
  try {
    const url = new URL(thumbnail, client.baseUrl || window.location.href);
    const origin = new URL(client.baseUrl || window.location.href).origin;
    return url.origin === origin ? client.assetUrl ? client.assetUrl(thumbnail) : downloadableUrl(client, thumbnail) : undefined;
  } catch { return undefined; }
}
function WhiteboardPreview({ artifact, cached, client }: { artifact: Artifact; cached?: Board; client: StudioClient }) {
  const image = artifact.thumbnail ? thumbnailUrl(client, artifact.thumbnail) : undefined;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [image]);
  if (image && !failed) return <div className="studio-artifact-preview"><img src={image} alt="" loading="lazy" onError={() => setFailed(true)} /></div>;
  const elements = cached?.elements.filter(element => element.type !== 'arrow' && element.type !== 'stroke') || [];
  if (!elements.length) return <div className="studio-artifact-preview studio-blank-preview"><div className="studio-preview-paper"><span /><span /><span /></div><span>{failed ? '预览暂不可用' : cached ? '空白白板' : '打开作品查看内容'}</span></div>;
  const left = Math.min(...elements.map(element => element.x)) - 32;
  const top = Math.min(...elements.map(element => element.y)) - 32;
  const width = Math.max(480, ...elements.map(element => element.x + element.w - left)) + 32;
  const height = Math.max(300, ...elements.map(element => element.y + element.h - top)) + 32;
  return <div className="studio-artifact-preview"><svg aria-hidden="true" viewBox={`${left} ${top} ${width} ${height}`} style={{ background: cached?.style.paper }}>
    {elements.map(element => <g key={element.id}>
      <rect x={element.x} y={element.y} width={element.w} height={element.h} rx={element.type === 'container' ? 3 : 7} fill={element.fill || (element.type === 'html' ? '#fff' : '#e9edf2')} stroke={element.stroke || '#a8b0bd'} strokeWidth={1.2} />
      <text x={element.x + 10} y={element.y + 22} fontSize={13} fill="#303c4c">{String(element.text || (element.type === 'html' ? 'HTML 图解' : '')).slice(0, 28)}</text>
    </g>)}
  </svg></div>;
}

function WhiteboardDifference({ current: currentDocument, previous: previousDocument, diff }: ProductDifferenceProps) {
  const current = currentDocument as Board; const previous = previousDocument as Board;
  const now = new Map(current.elements.map(element => [element.id, element]));
  const then = new Map(previous.elements.map(element => [element.id, element]));
  const ids = [...new Set([...now.keys(), ...then.keys()])];
  const changes = ids.filter(id => JSON.stringify(now.get(id)) !== JSON.stringify(then.get(id))).map(id => ({ id, kind: !then.has(id) ? '新增' : !now.has(id) ? '移除' : '修改', name: String((now.get(id) || then.get(id))?.text || id).slice(0, 50) }));
  return <div className="studio-version-diff" aria-label="与当前白板的差异">
    <h4>从此版本到当前白板</h4>
    <p>{changes.length ? `${changes.length} 个对象有变化` : '对象内容相同'}{current.artifact.title !== previous.artifact.title ? ' · 标题有变化' : ''}</p>
    {changes.slice(0, 30).map(change => <div className="studio-diff-row" key={change.id}><span data-kind={change.kind}>{change.kind}</span><span>{change.name}</span></div>)}
    {changes.length > 30 && <p>另有 {changes.length - 30} 项</p>}
    {diff && !changes.length && Array.isArray(diff.changes) && diff.changes.length > 0 && <p>此版本另有样式或元数据变更。</p>}
  </div>;
}


function whiteboardAnnotation(board: Board, selection: HtmlSelection): ProductAnnotation {
  const region = board.elements.find(element => element.id === selection.regionId);
  return { label: 'HTML 内部选区', sourceLabel: `选区来源版本 ${selection.sourceRevision} · 保存时冻结上下文`, screenPoint: selection.screenPoint, anchor: { coordinateSpace: 'html', regionId: selection.regionId, targetIds: selection.targetIds, sourceRevision: selection.sourceRevision, quote: selection.quote, excerpt: selection.excerpt, selector: selection.selector, ...selection.rect }, versions: region ? { [region.id]: region.version } : undefined };
}
function WhiteboardEditor(props: ProductEditorProps) {
  const { document, onChanged, onAnnotate, onOpenHtml, onActivityChange, onError, onNotice, ...rest } = props;
  const board = document as Board;
  const [sourceRequest, setSourceRequest] = useState<{ id: string; regionId?: string } | null>(null);
  const activities = useRef<Record<'canvas' | 'source', ProductActivity>>({ canvas: { editingIds: [], movingIds: [], dirty: false }, source: { editingIds: [], movingIds: [], dirty: false } });
  const report = useCallback((origin: 'canvas' | 'source', activity: ProductActivity) => {
    activities.current[origin] = activity;
    const values = Object.values(activities.current);
    onActivityChange?.({ editingIds: [...new Set(values.flatMap(value => value.editingIds))], movingIds: [...new Set(values.flatMap(value => value.movingIds))], dirty: values.some(value => value.dirty), issues: values.flatMap(value => value.issues || []) });
  }, [onActivityChange]);
  const canvasActivity = useCallback((activity: ProductActivity) => report('canvas', activity), [report]);
  const sourceActivity = useCallback((activity: ProductActivity) => report('source', activity), [report]);
  return <><WhiteboardCanvas {...rest} board={board} onChanged={onChanged} onActivityChange={canvasActivity} onAnnotate={selection => onAnnotate(whiteboardAnnotation(board, selection))} onAnnotateNative={onAnnotate} onOpenHtml={element => onOpenHtml?.(element.id)} onEditHtml={element => setSourceRequest({ id: newClientId('source'), regionId: element?.id })} />
    <WhiteboardToolbar document={board} client={props.client} actor={props.actor} selectedIds={[]} disabled={!!props.readOnly} onChanged={onChanged} onError={error => onError?.(error)} onNotice={message => onNotice?.(message)} onActivityChange={sourceActivity} request={sourceRequest} />
  </>;
}
interface SourceDraft { regionId?: string; version?: number; title: string; html: string }
function WhiteboardToolbar({ document: opaqueDocument, client, selectedIds, disabled, onChanged, onError, onNotice, onActivityChange, request }: ProductToolbarProps & { request?: { id: string; regionId?: string } | null }) {
  const board = opaqueDocument as Board;
  const [source, setSource] = useState<SourceDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const boardRef = useRef(board); boardRef.current = board;
  const mounted = useRef(true);
  const pendingSave = useRef<{ fingerprint: string; args: Record<string, unknown> } | null>(null);
  const sourceBaseline = useRef('');
  const [sourceError, setSourceError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setSource(null); pendingSave.current = null; }, [board.artifact.id]);
  useEffect(() => {
    onActivityChange?.({ editingIds: source?.regionId ? [source.regionId] : [], movingIds: [], dirty: !!source && JSON.stringify(source) !== sourceBaseline.current, issues: source && sourceError ? [{ type: 'source-save', message: sourceError, ids: source?.regionId ? [source.regionId] : [] }] : [] });
  }, [source, sourceError, onActivityChange]);
  useEffect(() => () => onActivityChange?.({ editingIds: [], movingIds: [], dirty: false, issues: [] }), [onActivityChange]);
  function openSource(draft: SourceDraft) { sourceBaseline.current = JSON.stringify(draft); setSourceError(''); setSource(draft); }
  const selectedRegion = board.elements.find(element => selectedIds.includes(element.id) && element.type === 'html');
  async function editSource(regionId = selectedRegion?.id) {
    if (disabled || busy) return;
    pendingSave.current = null;
    const region = boardRef.current.elements.find(element => element.id === regionId && element.type === 'html');
    if (!region) { openSource({ title: 'HTML 图解', html: '' }); return; }
    const id = board.artifact.id; setBusy(true);
    try {
      const result = await client.call<{ html: string }>('artifact_read', { artifactId: id, mode: 'source', regionId: region.id });
      if (mounted.current && boardRef.current.artifact.id === id) openSource({ regionId: region.id, version: region.version, title: region.text || 'HTML 图解', html: result.html });
    } catch (error) { onError(error); } finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => { if (request) void editSource(request.regionId); }, [request?.id]);
  async function importFile(file: File) {
    if (busy) return;
    const artifactId = boardRef.current.artifact.id;
    setBusy(true);
    try { const html = await file.text(); if (mounted.current && boardRef.current.artifact.id === artifactId) { setSourceError(''); setSource(previous => ({ ...previous, title: previous?.regionId ? previous.title : file.name.replace(/\.html?$/i, ''), html })); } }
    catch (error) { onError(error); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function saveSource(event: FormEvent) {
    event.preventDefault(); if (!source || !source.html.trim() || busy || disabled) return;
    const current = boardRef.current; setBusy(true);
    try {
      const fingerprint = JSON.stringify(source);
      if (pendingSave.current?.fingerprint !== fingerprint) {
        const operation: Operation = source.regionId ? { op: 'update', id: source.regionId, changes: { html: source.html, text: source.title } } : { op: 'add', element: { id: newClientId('html'), type: 'html', x: current.elements.length ? Math.max(...current.elements.map(element => element.x + element.w)) + 80 : 80, y: 80, w: 1440, h: 1120, text: source.title || 'HTML 图解', html: source.html } };
        pendingSave.current = { fingerprint, args: { artifactId: current.artifact.id, operationId: newClientId('op'), expectedRevision: current.artifact.revision, expectedVersions: source.regionId && source.version !== undefined ? { [source.regionId]: source.version } : undefined, operations: [operation] } };
      }
      const result = await client.call<{ board: Board }>('artifact_apply', pendingSave.current.args);
      if (mounted.current && boardRef.current.artifact.id === current.artifact.id) { onChanged(result.board); pendingSave.current = null; setSource(null); onNotice(source.regionId ? 'HTML 源码已保存。' : 'HTML 图解已加入白板。'); }
    } catch (error) { if (mounted.current && boardRef.current.artifact.id === current.artifact.id) setSourceError(error instanceof Error ? error.message : String(error)); onError(error); } finally { if (mounted.current) setBusy(false); }
  }
  return <>{source && <StudioDialog title={source.regionId ? '编辑 HTML 源码' : '导入 HTML 图解'} onClose={() => { if (!busy) setSource(null); }} wide><form onSubmit={event => void saveSource(event)}><div className="studio-source-heading"><label className="studio-field-label">区域名称<input className="studio-text-field" aria-label="HTML 区域名称" disabled={busy} value={source.title} onChange={event => setSource(previous => previous ? { ...previous, title: event.target.value } : null)} /></label><button type="button" className="studio-button" disabled={busy} onClick={() => fileInput.current?.click()}><FileCode2 size={16} />选择 HTML 文件</button><input ref={fileInput} type="file" accept=".html,.htm,text/html" aria-label="选择 HTML 文件" disabled={busy} hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} /></div><label className="studio-field-label" htmlFor="studio-html-source">HTML 源码</label><textarea id="studio-html-source" className="studio-source-editor" spellCheck={false} disabled={busy} value={source.html} onChange={event => setSource(previous => previous ? { ...previous, html: event.target.value } : null)} placeholder="粘贴完整 HTML 或选择文件…" /><p className="studio-small-note">HTML 会作为独立区域显示在白板上，保留自己的样式。可以标注区域内部的文字与图形，并附加到对话。</p>{sourceError && <p role="alert" className="studio-danger-text">{sourceError}</p>}<div className="studio-modal-footer"><button type="button" className="studio-button" disabled={busy} onClick={() => setSource(null)}>取消</button><button type="submit" className="studio-button studio-primary" disabled={!source.html.trim() || busy || disabled}>{busy && <Loader2 className="studio-spin" size={15} />}{source.regionId ? '保存源码' : '添加到白板'}</button></div></form></StudioDialog>}</>;
}
async function exportWhiteboard(document: unknown, format: 'png' | 'svg' | 'html' | 'json', client: StudioClient) {
  const board = document as Board;
  try {
    if (format === 'png') { const { downloadBoard } = await import('../export'); await downloadBoard(board, format, { baseUrl: client.baseUrl, token: client.token, request: (url: string | URL) => studioRequest(client, url) }, (blob, filename) => downloadStudioBlob(client, blob, filename)); return; }
    const result = await client.call<{ filename: string; downloadPath: string }>('artifact_export', { artifactId: board.artifact.id, format });
    await downloadStudioFile(client, result.downloadPath, result.filename);
  } catch (error) {
    if (!((error as { code?: string })?.code === 'EXPORT_BROWSER_REQUIRED' || error instanceof Error && error.message.includes('EXPORT_BROWSER_REQUIRED'))) throw error;
    const { downloadBoard } = await import('../export'); await downloadBoard(board, format, { baseUrl: client.baseUrl, token: client.token, request: (url: string | URL) => studioRequest(client, url) }, (blob, filename) => downloadStudioBlob(client, blob, filename));
  }
}
export const whiteboardProduct: ProductDescriptor = {
  id: 'whiteboard', label: '白板', defaultTitle: '未命名白板', Icon: Share2,
  Editor: WhiteboardEditor,
  Preview: (props: ProductPreviewProps) => <WhiteboardPreview {...props} cached={props.cached as Board | undefined} />,
  Difference: WhiteboardDifference,
  selectionContext(document, selectedIds) { const board = document as Board; return { label: selectedIds.length ? `关于选中的 ${selectedIds.length} 个对象` : '关于整块白板', anchor: { elementIds: selectedIds }, versions: Object.fromEntries(board.elements.filter(element => selectedIds.includes(element.id)).map(element => [element.id, element.version])) }; },
  locateAnchor(document, anchor) {
    const board = document as Board;
    const ids = anchor.regionId ? [anchor.regionId] : anchor.elementIds || [];
    const elements = board.elements.filter(element => ids.includes(element.id));
    if (elements.length) {
      const x = Math.min(...elements.map(element => element.x)), y = Math.min(...elements.map(element => element.y));
      return { ids: elements.map(element => element.id), bounds: { x, y, w: Math.max(...elements.map(element => element.x + element.w)) - x, h: Math.max(...elements.map(element => element.y + element.h)) - y } };
    }
    if (anchor.coordinateSpace === 'board' && typeof anchor.x === 'number' && typeof anchor.y === 'number') return { ids: [], bounds: { x: anchor.x, y: anchor.y, w: anchor.w || 200, h: anchor.h || 120 } };
    return undefined;
  },
  exportFormats: [{ format: 'png', label: 'PNG 图片' }, { format: 'svg', label: 'SVG 图片' }, { format: 'html', label: '交互页面 (.html)' }, { format: 'json', label: '白板文件 (.json)' }],
  exportDocument: exportWhiteboard,
};
