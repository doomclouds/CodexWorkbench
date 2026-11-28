import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Disclosure, OperationNotice } from '../../../base/index.js';
import type { EmbedJson as Json, EmbedObjectProps, EmbedObjectValue } from './contracts.js';
import {
  attachEmbedFrame,
  authoritativeState,
  frameSource,
  permissionChanged,
} from './frame-session.js';
import type { FrameSession, SaveView } from './frame-session.js';
import { EmbedSourceEditor } from './EmbedSourceEditor.js';
import { embedOverviewPreview } from './overview-preview.js';
import './EmbedObject.css';

function useFrameSaveView(element: EmbedObjectValue, writable: boolean) {
  const [trackedSource, setTrackedSource] = useState(() => ({
    source: frameSource(element),
    explicitRevision: element.sourceRevision,
  }));
  const { source, explicitRevision } = trackedSource;
  const [saveView, setSaveView] = useState<SaveView | null>(null);
  const [previousWritable, setPreviousWritable] = useState(writable);
  const activeSave = saveView?.source === source ? saveView : null;
  const contentChanged = source.regionId !== element.id || source.html !== element.html;
  const sourceInputsChanged =
    contentChanged || !Object.is(explicitRevision, element.sourceRevision);
  const nextSource = sourceInputsChanged ? frameSource(element) : source;
  const sourceChanged =
    contentChanged || !Object.is(source.sourceRevision, nextSource.sourceRevision);

  if (sourceInputsChanged) {
    setTrackedSource({
      source: sourceChanged ? nextSource : source,
      explicitRevision: element.sourceRevision,
    });

    if (sourceChanged) {
      setSaveView(null);
    }
  }
  if (previousWritable !== writable) {
    setPreviousWritable(writable);
    if (!writable && !sourceChanged && activeSave) {
      setSaveView({ ...activeSave, error: permissionChanged });
    }
  }
  return { source, activeSave, setSaveView };
}

export function EmbedObject(props: EmbedObjectProps) {
  const { kind, value } = props;
  if (kind !== 'html' && typeof value.html !== 'string') {
    return <div className="studio-ui-embed__label">{value.title || defaultTitle[kind]}</div>;
  }

  return <EmbedHtmlBody {...props} />;
}

function EmbedHtmlBody(props: EmbedObjectProps) {
  const {
    value: element,
    committedState,
    annotation = false,
    interactive,
    zoom = 1,
    preserveScroll = false,
    initialScroll,
    panMode = false,
    onSaveState,
    annotationLocations,
  } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const session = useRef<FrameSession | null>(null);
  const committedProps = useRef(props);
  const scrollPosition = useRef<{ regionId: string; x: number; y: number } | null>(null);
  const [editingRegion, setEditingRegion] = useState<string>();
  const [scrolledRegion, setScrolledRegion] = useState<string>();
  const writable = Boolean(onSaveState);
  const { source, activeSave, setSaveView } = useFrameSaveView(element, writable);
  const saved = committedState ?? element;
  const shouldRetain = activeSave !== null || editingRegion === element.id;
  const receivesInput = annotation || interactive;
  const needsFrame = receivesInput || shouldRetain || props.editRequest !== undefined;
  const { image, failImage } = useOverviewImage(props, needsFrame, scrolledRegion === element.id);
  const observeRetention = useEffectEvent((retain: boolean) => props.onRetentionChange?.(retain));

  function handleSourceEditing(editing: boolean) {
    props.onSourceEditingChange?.(editing);
    const id = element.id;
    setEditingRegion((current) => {
      if (editing) {
        return id;
      }

      return current === id ? undefined : current;
    });
  }

  useLayoutEffect(() => {
    if (shouldRetain) {
      observeRetention(true);

      return () => observeRetention(false);
    }
  }, [shouldRetain]);

  useLayoutEffect(() => {
    committedProps.current = props;
  }, [props]);
  useLayoutEffect(() => {
    const iframe = frame.current;
    const view = iframe?.ownerDocument.defaultView;
    if (!iframe || !view) {
      return;
    }

    const frameSession = attachEmbedFrame({
      iframe,
      view,
      source,
      readProps: () => committedProps.current,
      setSaveView,
      scrollPosition,
      onScrollActivity: (scrolled) => setScrolledRegion(scrolled ? source.regionId : undefined),
    });
    session.current = frameSession;

    return () => {
      session.current = null;
      frameSession.close();
    };
  }, [source, setSaveView, image]);

  useLayoutEffect(() => {
    if (!writable) {
      session.current?.pauseSaves();
    }
  }, [source, writable]);
  useEffect(() => {
    if (initialScroll && preserveScroll) {
      session.current?.restoreScroll(initialScroll);
    }
  }, [element.id, initialScroll, preserveScroll]);
  useEffect(() => {
    if (!annotation && !interactive) {
      session.current?.clearInteraction();
    }
  }, [annotation, interactive]);
  useEffect(() => {
    session.current?.postMode();
  }, [annotation, source, writable, preserveScroll, panMode]);
  useEffect(() => {
    session.current?.postAnnotationLocations();
  }, [source, annotationLocations]);
  useEffect(() => {
    session.current?.postSavedState();
  }, [saved.state, saved.version, source]);

  const displayRaster = zoom >= 0.5;
  const rasterZoom = displayRaster ? zoom : 1;

  return (
    <div
      className="studio-ui-embed"
      data-kind={props.kind}
      data-annotating={annotation || undefined}
    >
      {image ? (
        <img
          className="studio-ui-embed__preview"
          src={image}
          alt={element.title || defaultTitle[props.kind]}
          draggable={false}
          onError={failImage}
        />
      ) : (
        <iframe
          ref={frame}
          title={element.title || defaultTitle[props.kind]}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
          tabIndex={receivesInput ? 0 : -1}
          onLoad={() => session.current?.postMode()}
          style={{
            width: String(rasterZoom * 100) + '%',
            height: String(rasterZoom * 100) + '%',
            zoom: rasterZoom,
            transform: displayRaster ? 'scale(' + 1 / zoom + ')' : undefined,
            transformOrigin: '0 0',
            pointerEvents: receivesInput ? 'auto' : 'none',
          }}
        />
      )}
      {activeSave && activeSave.error !== null && (
        <EmbedSaveNotice
          message={activeSave.error}
          state={authoritativeState(saved, activeSave.accepted).state}
          saving={activeSave.processing}
          writable={writable}
          onRetry={() => session.current?.retrySave()}
          onAdopt={() => session.current?.adoptSharedState()}
        />
      )}
      <EmbedSourceEditor
        key={element.id}
        value={element}
        interactive={interactive}
        editRequest={props.editRequest}
        useCanvasTools={props.useCanvasTools}
        readHtmlSource={props.readHtmlSource}
        onSave={props.onSaveSource}
        onEditingChange={handleSourceEditing}
      />
    </div>
  );
}

function useOverviewImage(props: EmbedObjectProps, needsFrame: boolean, scrolled: boolean) {
  const { width, height } = props.overviewSize ?? {};
  const source = props.value.html;
  const eligible = (props.zoom ?? 1) < 0.25 && !needsFrame && !scrolled;
  const [failedImage, setFailedImage] = useState<string>();
  const preview = useMemo(() => {
    if (!eligible || width === undefined || height === undefined) {
      return undefined;
    }

    return embedOverviewPreview(source, { width, height });
  }, [eligible, height, source, width]);
  const image = preview === failedImage ? undefined : preview;

  return { image, failImage: () => setFailedImage(preview) };
}

const defaultTitle = {
  html: 'HTML 图解',
  diagram: '图解',
  chart: '图表',
};

interface EmbedSaveNoticeProps {
  message: string;
  state: Json;
  saving: boolean;
  writable: boolean;
  onRetry: () => void;
  onAdopt: () => void;
}

function EmbedSaveNotice({
  message,
  state,
  saving,
  writable,
  onRetry,
  onAdopt,
}: EmbedSaveNoticeProps) {
  const id = useId();
  const [details, setDetails] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) {
    return null;
  }

  return (
    <div className="studio-ui-embed__notice">
      <OperationNotice
        id={id}
        level="error"
        message={message + ' 本地交互修改已保留。'}
        dismissible
        dismissLabel="关闭 HTML 保存通知"
        onDismiss={() => setDismissed(true)}
        actions={[
          { id: 'retry', label: '重试保存', disabled: !writable || saving, onActivate: onRetry },
          { id: 'adopt', label: '使用共享状态', disabled: saving, onActivate: onAdopt },
        ]}
      />
      <Disclosure label="查看共享状态" open={details} onOpenChange={setDetails}>
        <pre>{JSON.stringify(state, null, 2)}</pre>
      </Disclosure>
    </div>
  );
}
