import './region.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HtmlRegionContent, HtmlSelection, Json } from '../../../contracts/studio.js';
import { buildHtmlRegionDocument, validateHtmlSelectionMessage, validateHtmlStateMessage, type HtmlAnnotationMode, type HtmlStateSave } from './runtime.js';

interface Props { element: HtmlRegionContent; annotation: boolean; interactive: boolean; onAnnotate: (selection: HtmlSelection) => void; onStateChange?: (state: Json, expectedVersion: number) => Promise<{ state: Json; version: number }> }

export default function HtmlRegion({ element, annotation, interactive, onAnnotate, onStateChange }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const channel = useMemo(() => crypto.randomUUID(), [element.id, element.html]);
  const [mode, setMode] = useState<HtmlAnnotationMode>('element');
  const [ready, setReady] = useState(false);
  const [documentUrl, setDocumentUrl] = useState<string>();
  const sourceRevision = typeof element.sourceRevision === 'number' ? element.sourceRevision : element.version;
  const source = useMemo(() => buildHtmlRegionDocument(element.html ?? '', { channel, regionId: element.id, sourceRevision, annotation, mode, state: element.state ?? null, elementVersion: element.version, writable: Boolean(onStateChange) }), [element.html, element.id, sourceRevision, channel]);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([source], { type: 'text/html' }));
    setDocumentUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);
  const callback = useRef(onAnnotate);
  callback.current = onAnnotate;
  const annotationRef = useRef(annotation); annotationRef.current = annotation;
  const stateCallback = useRef(onStateChange); stateCallback.current = onStateChange;
  const currentElement = useRef(element); currentElement.current = element;
  const pendingSave = useRef<HtmlStateSave | null>(null);
  const processingSave = useRef(false);
  const acceptedVersions = useRef(new Set<number>());
  const latestAcceptedVersion = useRef<number | null>(null);
  const processSave = async () => {
    if (processingSave.current || !stateCallback.current) return;
    processingSave.current = true;
    try {
      while (pendingSave.current && stateCallback.current) {
        const task = pendingSave.current; pendingSave.current = null;
        let expectedVersion = task.baseVersion;
        const currentVersion = currentElement.current.version;
        if (latestAcceptedVersion.current !== null && acceptedVersions.current.has(task.baseVersion) && (currentVersion <= latestAcceptedVersion.current && acceptedVersions.current.has(currentVersion))) expectedVersion = latestAcceptedVersion.current;
        try {
          const result = await stateCallback.current(task.state, expectedVersion);
          acceptedVersions.current.add(task.baseVersion); acceptedVersions.current.add(result.version);
          latestAcceptedVersion.current = result.version;
          if (acceptedVersions.current.size > 100) acceptedVersions.current = new Set([task.baseVersion, result.version]);
          frame.current?.contentWindow?.postMessage({ type: 'studio-html-state-update', channel, regionId: element.id, state: result.state, version: result.version, saveId: task.saveId }, '*');
        } catch (error) {
          pendingSave.current = null;
          frame.current?.contentWindow?.postMessage({ type: 'studio-html-state-error', channel, regionId: element.id, state: currentElement.current.state ?? null, version: currentElement.current.version, message: error instanceof Error ? error.message : '嵌入状态未能保存。' }, '*');
        }
      }
    } finally { processingSave.current = false; }
  };
  const saveProcessor = useRef(processSave); saveProcessor.current = processSave;
  useEffect(() => { setReady(false); pendingSave.current = null; acceptedVersions.current.clear(); latestAcceptedVersion.current = null; }, [channel]);
  useLayoutEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || event.data.channel !== channel) return;
      if (event.data.type === 'studio-html-ready' && event.data.regionId === element.id) { setReady(true); return; }
      const state = validateHtmlStateMessage(event.data, { channel, regionId: element.id, sourceRevision });
      if (state && stateCallback.current) { pendingSave.current = state; void saveProcessor.current(); return; }
      const selection = validateHtmlSelectionMessage(event.data, { channel, regionId: element.id, sourceRevision });
      if (selection && annotationRef.current) callback.current(selection);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [channel, element.id, sourceRevision]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'studio-html-mode', channel, enabled: annotation, writable: Boolean(onStateChange), mode }, '*');
  }, [annotation, mode, channel, ready, Boolean(onStateChange)]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'studio-html-state-update', channel, regionId: element.id, state: element.state ?? null, version: element.version }, '*');
  }, [element.state, element.version, element.id, channel, ready]);
  return <div className={`studio-html-region${annotation ? ' is-annotating' : ''}`}>
    <iframe ref={frame} title={element.text || 'HTML 图解'} src={documentUrl} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'studio-html-mode', channel, enabled: annotation, writable: Boolean(onStateChange), mode }, '*')} style={{ pointerEvents: annotation || interactive ? 'auto' : 'none' }} />
    {annotation && <div className="studio-html-modes" data-native-interactive="true" onPointerDown={(event) => event.stopPropagation()}>
      {(['element', 'text', 'area'] as const).map((choice) => <button type="button" key={choice} className={choice === mode ? 'is-active' : ''} onClick={() => setMode(choice)}>{choice === 'element' ? '对象' : choice === 'text' ? '文字' : '框选'}</button>)}
      <span>{ready ? '选择内容后添加批注' : '正在加载图解…'}</span>
    </div>}
  </div>;
}
