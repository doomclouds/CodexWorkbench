import './region.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HtmlRegionContent, HtmlSelection, Json } from '../../../contracts/studio.js';
import { buildHtmlRegionDocument, rebaseHtmlState, validateHtmlScrollMessage, validateHtmlSelectionMessage, validateHtmlStateMessage, type HtmlStateSave } from './runtime.js';
import { newClientId } from '../client-id.js';

interface Props { element: HtmlRegionContent; annotation: boolean; interactive: boolean; preserveScroll?: boolean; onAnnotate: (selection: HtmlSelection) => void; onStateChange?: (state: Json, expectedVersion: number) => Promise<{ state: Json; version: number }> }
interface SaveQueue {
  active: boolean; processing: boolean; paused: boolean; sequence: number; pending: HtmlStateSave | null;
  accepted: { baseVersion: number; submitted: Json; state: Json; version: number }[];
}

export default function HtmlRegion({ element, annotation, interactive, preserveScroll = false, onAnnotate, onStateChange }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const sourceRevision = useMemo(() => typeof element.sourceRevision === 'number' ? element.sourceRevision : element.version, [element.id, element.html, element.sourceRevision]);
  const channel = useMemo(() => newClientId(), [element.id, element.html, sourceRevision]);
  const [ready, setReady] = useState(false);
  const source = useMemo(() => buildHtmlRegionDocument(element.html ?? '', { channel, regionId: element.id, sourceRevision, annotation, preserveScroll, state: element.state ?? null, elementVersion: element.version, writable: Boolean(onStateChange) }), [element.html, element.id, sourceRevision, channel]);
  const callback = useRef(onAnnotate);
  callback.current = onAnnotate;
  const annotationRef = useRef(annotation); annotationRef.current = annotation;
  const preserveScrollRef = useRef(preserveScroll); preserveScrollRef.current = preserveScroll;
  const scrollPosition = useRef<{ regionId: string; x: number; y: number } | null>(null);
  const readyDocument = useRef<string | null>(null);
  const stateCallback = useRef(onStateChange); stateCallback.current = onStateChange;
  const currentElement = useRef(element); currentElement.current = element;
  const queue = useMemo<SaveQueue>(() => ({ active: true, processing: false, paused: false, sequence: 0, pending: null, accepted: [] }), [channel]);
  const [saveError, setSaveError] = useState<{ channel: string; message: string } | null>(null);
  const [processingChannel, setProcessingChannel] = useState<string | null>(null);
  const postState = (type: string, value: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ type, channel, regionId: element.id, ...value }, '*');
  const authority = () => {
    const accepted = queue.accepted.at(-1), current = currentElement.current;
    return accepted && accepted.version > current.version ? { state: accepted.state, version: accepted.version } : { state: current.state ?? null, version: current.version };
  };
  const advanceAccepted = (task: HtmlStateSave): HtmlStateSave => {
    for (const accepted of queue.accepted) if (accepted.baseVersion === task.baseVersion) {
      const rebased = rebaseHtmlState(accepted.submitted, task.state, accepted.state);
      if (rebased.conflicted) return task;
      task = { ...task, state: rebased.state, baseVersion: accepted.version };
    }
    return task;
  };
  const processSave = async () => {
    if (!queue.active || queue.processing || queue.paused || !stateCallback.current) return;
    queue.processing = true; setProcessingChannel(channel);
    try {
      while (queue.active && !queue.paused && queue.pending && stateCallback.current) {
        const task = advanceAccepted(queue.pending); queue.pending = null;
        try {
          const result = await stateCallback.current(task.state, task.baseVersion);
          if (!queue.active) return;
          queue.accepted.push({ baseVersion: task.baseVersion, submitted: task.state, ...result });
          if (queue.accepted.length > 100) queue.accepted.shift();
          if (!queue.paused) setSaveError(null);
          postState('studio-html-state-update', { ...result, saveId: task.saveId });
        } catch (error) {
          if (!queue.active) return;
          queue.pending ??= task; queue.paused = true;
          const message = error instanceof Error ? error.message : '嵌入状态未能保存。';
          setSaveError({ channel, message });
          postState('studio-html-state-error', { ...authority(), saveId: task.saveId, message });
          return;
        }
      }
    } finally { queue.processing = false; if (queue.active) setProcessingChannel(null); }
  };
  const saveProcessor = useRef(processSave); saveProcessor.current = processSave;
  useEffect(() => {
    if (!onStateChange && (queue.pending || queue.processing)) {
      queue.paused = true;
      setSaveError({ channel, message: '当前视图的编辑权限已变更，未继续发送交互修改。' });
    }
  }, [Boolean(onStateChange), channel, queue]);
  useLayoutEffect(() => {
    queue.active = true; setReady(false);
    readyDocument.current = null;
    if (scrollPosition.current?.regionId !== element.id) scrollPosition.current = null;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || event.data.channel !== channel) return;
      if (event.data.type === 'studio-html-ready' && event.data.regionId === element.id && event.data.sourceRevision === sourceRevision) {
        if (readyDocument.current !== channel) {
          readyDocument.current = channel;
          const position = scrollPosition.current;
          if (preserveScrollRef.current && position?.regionId === element.id) frame.current?.contentWindow?.postMessage({ type: 'studio-html-scroll-restore', channel, regionId: element.id, sourceRevision, x: position.x, y: position.y }, '*');
        }
        setReady(true); return;
      }
      const scroll = validateHtmlScrollMessage(event.data, { channel, regionId: element.id, sourceRevision });
      if (scroll && preserveScrollRef.current && readyDocument.current === channel) { scrollPosition.current = { regionId: element.id, x: scroll.x, y: scroll.y }; return; }
      const state = validateHtmlStateMessage(event.data, { channel, regionId: element.id, sourceRevision });
      if (state && stateCallback.current && state.saveId > queue.sequence) { queue.sequence = state.saveId; queue.pending = state; void saveProcessor.current(); return; }
      const selection = validateHtmlSelectionMessage(event.data, { channel, regionId: element.id, sourceRevision });
      if (selection && annotationRef.current) {
        const { point, ...content } = selection;
        const iframe = frame.current;
        const bounds = iframe?.getBoundingClientRect();
        const screenPoint = point && iframe && bounds ? { x: bounds.left + point.x * (bounds.width / (iframe.clientWidth || bounds.width || 1)), y: bounds.top + point.y * (bounds.height / (iframe.clientHeight || bounds.height || 1)) } : undefined;
        callback.current({ ...content, ...(screenPoint ? { screenPoint } : {}) });
      }
    };
    window.addEventListener('message', receive);
    return () => { queue.active = false; window.removeEventListener('message', receive); };
  }, [channel, element.id, sourceRevision, queue]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'studio-html-mode', channel, regionId: element.id, sourceRevision, enabled: annotation, writable: Boolean(onStateChange), preserveScroll }, '*');
  }, [annotation, channel, element.id, sourceRevision, ready, Boolean(onStateChange), preserveScroll]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'studio-html-state-update', channel, regionId: element.id, state: element.state ?? null, version: element.version }, '*');
  }, [element.state, element.version, element.id, channel, ready]);
  return <div className={`studio-html-region${annotation ? ' is-annotating' : ''}`}>
    <iframe ref={frame} title={element.text || 'HTML 图解'} srcDoc={source} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'studio-html-mode', channel, regionId: element.id, sourceRevision, enabled: annotation, writable: Boolean(onStateChange), preserveScroll }, '*')} style={{ pointerEvents: annotation || interactive ? 'auto' : 'none' }} />
    {saveError?.channel === channel && <div className="studio-html-state-error" data-native-interactive="true" role="alert">
      <span>{saveError.message} 本地交互修改已保留。</span>
      <button type="button" disabled={!onStateChange || processingChannel === channel} onClick={() => { queue.paused = false; setSaveError(null); void saveProcessor.current(); }}>重试保存</button>
      <button type="button" disabled={processingChannel === channel} onClick={() => { if (queue.processing) return; queue.pending = null; queue.paused = false; setSaveError(null); postState('studio-html-state-reset', authority()); }}>使用共享状态</button>
      <details><summary>查看共享状态</summary><pre>{JSON.stringify(authority().state, null, 2)}</pre></details>
    </div>}
  </div>;
}
