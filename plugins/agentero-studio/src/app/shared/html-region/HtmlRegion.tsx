import './region.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HtmlRegionContent, HtmlSelection, Json } from '../../../contracts/studio.js';
import { buildHtmlRegionDocument, validateHtmlScrollMessage, validateHtmlSelectionMessage, validateHtmlStateMessage, type HtmlStateSave } from './runtime.js';
import { newClientId } from '../client-id.js';

interface Props { element: HtmlRegionContent; annotation: boolean; interactive: boolean; preserveScroll?: boolean; onAnnotate: (selection: HtmlSelection) => void; onStateChange?: (state: Json, expectedVersion: number) => Promise<{ state: Json; version: number }> }

export default function HtmlRegion({ element, annotation, interactive, preserveScroll = false, onAnnotate, onStateChange }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const channel = useMemo(() => newClientId(), [element.id, element.html]);
  const [ready, setReady] = useState(false);
  const sourceRevision = typeof element.sourceRevision === 'number' ? element.sourceRevision : element.version;
  const source = useMemo(() => buildHtmlRegionDocument(element.html ?? '', { channel, regionId: element.id, sourceRevision, annotation, preserveScroll, state: element.state ?? null, elementVersion: element.version, writable: Boolean(onStateChange) }), [element.html, element.id, sourceRevision, channel]);
  const callback = useRef(onAnnotate);
  callback.current = onAnnotate;
  const annotationRef = useRef(annotation); annotationRef.current = annotation;
  const preserveScrollRef = useRef(preserveScroll); preserveScrollRef.current = preserveScroll;
  const scrollPosition = useRef<{ regionId: string; x: number; y: number } | null>(null);
  const readyDocument = useRef<string | null>(null);
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
      if (state && stateCallback.current) { pendingSave.current = state; void saveProcessor.current(); return; }
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
    return () => window.removeEventListener('message', receive);
  }, [channel, element.id, sourceRevision]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'studio-html-mode', channel, regionId: element.id, sourceRevision, enabled: annotation, writable: Boolean(onStateChange), preserveScroll }, '*');
  }, [annotation, channel, element.id, sourceRevision, ready, Boolean(onStateChange), preserveScroll]);
  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'studio-html-state-update', channel, regionId: element.id, state: element.state ?? null, version: element.version }, '*');
  }, [element.state, element.version, element.id, channel, ready]);
  return <div className={`studio-html-region${annotation ? ' is-annotating' : ''}`}>
    <iframe ref={frame} title={element.text || 'HTML 图解'} srcDoc={source} sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'" onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'studio-html-mode', channel, regionId: element.id, sourceRevision, enabled: annotation, writable: Boolean(onStateChange), preserveScroll }, '*')} style={{ pointerEvents: annotation || interactive ? 'auto' : 'none' }} />
  </div>;
}
