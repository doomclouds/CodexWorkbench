import './region.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { HtmlRegionContent, HtmlSelection, Json } from '../../../contracts/studio.js';
import {
  buildHtmlRegionDocument,
  rebaseHtmlState,
  validateHtmlNavigationMessage,
  validateHtmlPointerMessage,
  validateHtmlScrollMessage,
  validateHtmlSelectionMessage,
  validateHtmlStateMessage,
  type HtmlFrameSelection,
  type HtmlNavigationEvent,
  type HtmlPointerPosition,
  type HtmlStateSave,
} from './runtime.js';
import { newClientId } from '../client-id.js';
import { dismissEscapeLayer, isEscapeActive } from '../escape.js';
import OperationNotice from '../OperationNotice.js';

interface Props {
  element: HtmlRegionContent;
  committedState?: Pick<HtmlRegionContent, 'state' | 'version'>;
  annotation: boolean;
  interactive: boolean;
  zoom?: number;
  preserveScroll?: boolean;
  initialScroll?: { x: number; y: number };
  onReadingScroll?: (point: { x: number; y: number }) => void;
  panMode?: boolean;
  onAnnotate: (selection: HtmlSelection) => void;
  onToolShortcut?: (key: string) => void;
  onPointerPosition?: (point: HtmlPointerPosition | null) => void;
  onNavigation?: (event: HtmlNavigationEvent) => void;
  onStateChange?: (
    state: Json,
    expectedVersion: number,
  ) => Promise<{ state: Json; version: number }>;
  onUseSharedState?: () => void;
}
interface SavedState {
  state: Json;
  version: number;
}
interface AcceptedSave extends SavedState {
  baseVersion: number;
  submitted: Json;
}
interface SaveQueue {
  active: boolean;
  processing: boolean;
  paused: boolean;
  sequence: number;
  pending: HtmlStateSave | null;
  accepted: AcceptedSave[];
  error: string | null;
}
interface FrameSource {
  regionId: string;
  html: HtmlRegionContent['html'];
  sourceRevision: number;
}
interface SaveView {
  source: FrameSource;
  processing: boolean;
  error: string | null;
  accepted?: SavedState;
}
interface FrameSession {
  postMode(): void;
  postSavedState(): void;
  restoreScroll(position: { x: number; y: number }): void;
  clearInteraction(): void;
  pauseSaves(): void;
  retrySave(): void;
  adoptSharedState(): void;
}

const permissionChanged = '当前视图的编辑权限已变更，未继续发送交互修改。';

function frameSource(element: HtmlRegionContent): FrameSource {
  const { id: regionId, html, sourceRevision: explicitRevision, version } = element;
  return {
    regionId,
    html,
    sourceRevision: typeof explicitRevision === 'number' ? explicitRevision : version,
  };
}

function authoritativeState(
  saved: Pick<HtmlRegionContent, 'state' | 'version'>,
  accepted?: SavedState,
): SavedState {
  if (accepted && accepted.version > saved.version) {
    return { state: accepted.state, version: accepted.version };
  }

  return { state: saved.state ?? null, version: saved.version };
}

function useFrameSaveView(element: HtmlRegionContent, writable: boolean) {
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

export default function HtmlRegion(props: Props) {
  const {
    element,
    committedState,
    annotation,
    interactive,
    zoom = 1,
    preserveScroll = false,
    initialScroll,
    panMode = false,
    onStateChange,
  } = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const session = useRef<FrameSession | null>(null);
  const committedProps = useRef(props);
  const scrollPosition = useRef<{ regionId: string; x: number; y: number } | null>(null);
  const writable = Boolean(onStateChange);
  const { source, activeSave, setSaveView } = useFrameSaveView(element, writable);
  const saved = committedState ?? element;

  useLayoutEffect(() => {
    committedProps.current = props;
  }, [props]);
  useLayoutEffect(() => {
    const iframe = frame.current;
    if (!iframe) {
      return;
    }

    const { regionId, sourceRevision, html } = source;
    const identity = { channel: newClientId(), regionId, sourceRevision };
    const queue: SaveQueue = {
      active: true,
      processing: false,
      paused: false,
      sequence: 0,
      pending: null,
      accepted: [],
      error: null,
    };
    let ready = false;
    let pointerInside = false;
    let navigationPan: Extract<HtmlNavigationEvent, { kind: 'pan' }> | null = null;
    let navigationSpace = false;

    if (scrollPosition.current?.regionId !== regionId) {
      scrollPosition.current = null;
    }

    const postState = (type: string, value: Record<string, unknown>) =>
      iframe.contentWindow?.postMessage(
        { type, channel: identity.channel, regionId, ...value },
        '*',
      );
    const authority = () => {
      const current = committedProps.current;
      return authoritativeState(current.committedState ?? current.element, queue.accepted.at(-1));
    };
    const postMode = () => {
      const current = committedProps.current;
      iframe.contentWindow?.postMessage(
        {
          type: 'studio-html-mode',
          ...identity,
          enabled: current.annotation,
          writable: Boolean(current.onStateChange),
          preserveScroll: Boolean(current.preserveScroll),
          panMode: Boolean(current.panMode),
        },
        '*',
      );
    };
    const postSavedState = () => postState('studio-html-state-update', { ...authority() });
    const reportPointer = (point: HtmlPointerPosition | null) => {
      committedProps.current.onPointerPosition?.(point);
      pointerInside = Boolean(point);
    };
    const clearInteraction = () => {
      const navigate = committedProps.current.onNavigation;
      if (navigationPan) {
        navigate?.({ ...navigationPan, phase: 'cancel' });
      }
      if (navigationSpace) {
        navigate?.({ kind: 'space', held: false });
      }
      navigationPan = null;
      navigationSpace = false;
      if (pointerInside) {
        reportPointer(null);
      }
    };

    const publishSave = () => {
      setSaveView(
        queue.processing || queue.error !== null
          ? {
              source,
              processing: queue.processing,
              error: queue.error,
              accepted: queue.accepted.at(-1),
            }
          : null,
      );
    };
    const advanceAccepted = (task: HtmlStateSave): HtmlStateSave => {
      for (const accepted of queue.accepted) {
        if (accepted.baseVersion === task.baseVersion) {
          const rebased = rebaseHtmlState(accepted.submitted, task.state, accepted.state);
          if (rebased.conflicted) {
            return task;
          }

          task = { ...task, state: rebased.state, baseVersion: accepted.version };
        }
      }
      return task;
    };
    const keepFailedSave = (error: unknown) => {
      queue.paused = true;
      queue.error = error instanceof Error ? error.message : '嵌入状态未能保存。';
    };
    const submitSave = async (task: HtmlStateSave, write: NonNullable<Props['onStateChange']>) => {
      try {
        const result = await write(task.state, task.baseVersion);
        if (!queue.active) {
          return;
        }

        queue.accepted.push({
          baseVersion: task.baseVersion,
          submitted: task.state,
          ...result,
        });

        if (queue.accepted.length > 100) {
          queue.accepted.shift();
        }
        if (!queue.paused) {
          queue.error = null;
        }
        postState('studio-html-state-update', { ...result, saveId: task.saveId });
      } catch (error) {
        if (!queue.active) {
          return;
        }

        queue.pending ??= task;
        keepFailedSave(error);
        postState('studio-html-state-error', {
          ...authority(),
          saveId: task.saveId,
          message: queue.error,
        });
      }
    };
    const processSave = async () => {
      const idle = queue.active && !queue.processing && !queue.paused;
      if (!idle || !committedProps.current.onStateChange) {
        return;
      }

      queue.processing = true;
      publishSave();
      try {
        while (queue.active && !queue.paused && queue.pending) {
          const write = committedProps.current.onStateChange;
          if (!write) {
            return;
          }

          const task = advanceAccepted(queue.pending);
          queue.pending = null;
          await submitSave(task, write);
        }
      } finally {
        queue.processing = false;
        if (queue.active) {
          publishSave();
        }
      }
    };
    const startSave = () => {
      processSave().catch((error: unknown) => {
        if (queue.active) {
          queue.processing = false;
          keepFailedSave(error);
          publishSave();
        }
      });
    };

    const applyNavigation = (navigation: HtmlNavigationEvent, current: Props) => {
      const acceptsInput = current.annotation || current.interactive;
      if (!acceptsInput || !isEscapeActive(iframe)) {
        return;
      }

      if (navigation.kind === 'pan') {
        navigationPan = ['end', 'cancel'].includes(navigation.phase) ? null : navigation;
      }
      if (navigation.kind === 'space') {
        navigationSpace = navigation.held;
      }
      current.onNavigation?.(navigation);
    };
    const initializeReadyFrame = (current: Props) => {
      if (ready) {
        return;
      }

      ready = true;
      const position = scrollPosition.current;
      if (current.preserveScroll && position?.regionId === regionId) {
        postState('studio-html-scroll-restore', { sourceRevision, x: position.x, y: position.y });
      }
      postMode();
      postSavedState();
    };
    const receiveFrameControl = (data: Record<string, unknown>, current: Props): boolean => {
      if (data.regionId !== regionId || data.sourceRevision !== sourceRevision) {
        return false;
      }

      switch (data.type) {
        case 'studio-html-tool-shortcut': {
          const key = data.key;
          if (typeof key === 'string' && /^[1-9]$/.test(key) && current.annotation) {
            if (isEscapeActive(iframe)) {
              current.onToolShortcut?.(key);
            }
          }
          return true;
        }
        case 'studio-html-escape':
          if (isEscapeActive(iframe)) {
            dismissEscapeLayer(window, iframe);
          }
          return true;
        case 'studio-html-ready':
          initializeReadyFrame(current);
          return true;
        default:
          return false;
      }
    };
    const reportSelection = (selection: HtmlFrameSelection, current: Props) => {
      const { point, ...content } = selection;
      const bounds = iframe.getBoundingClientRect();
      const screenPoint = point
        ? {
            x: bounds.left + point.x * (bounds.width / (iframe.clientWidth || bounds.width || 1)),
            y: bounds.top + point.y * (bounds.height / (iframe.clientHeight || bounds.height || 1)),
          }
        : undefined;
      current.onAnnotate({ ...content, ...(screenPoint ? { screenPoint } : {}) });
    };

    const receive = (event: MessageEvent) => {
      if (
        event.source !== iframe.contentWindow ||
        !event.data ||
        event.data.channel !== identity.channel
      ) {
        return;
      }

      const current = committedProps.current;
      const pointerEnabled = current.annotation || current.interactive;
      const navigation = validateHtmlNavigationMessage(event.data, identity);
      if (navigation) {
        applyNavigation(navigation, current);
        return;
      }
      const pointer = validateHtmlPointerMessage(event.data, identity);
      if (pointer) {
        if (pointerEnabled) {
          reportPointer(pointer.point);
        }
        return;
      }
      if (receiveFrameControl(event.data, current)) {
        return;
      }

      const scroll = validateHtmlScrollMessage(event.data, identity);
      if (scroll && current.preserveScroll && ready) {
        scrollPosition.current = { regionId, x: scroll.x, y: scroll.y };
        current.onReadingScroll?.({ x: scroll.x, y: scroll.y });
        return;
      }
      const state = validateHtmlStateMessage(event.data, identity);
      if (state && current.onStateChange && state.saveId > queue.sequence) {
        queue.sequence = state.saveId;
        queue.pending = state;
        startSave();
        return;
      }
      const selection = validateHtmlSelectionMessage(event.data, identity);
      if (selection && current.annotation) {
        reportSelection(selection, current);
      }
    };
    const current = committedProps.current;
    const state = authority();
    const srcDoc = buildHtmlRegionDocument(html ?? '', {
      ...identity,
      annotation: current.annotation,
      preserveScroll: Boolean(current.preserveScroll),
      state: state.state,
      elementVersion: state.version,
      writable: Boolean(current.onStateChange),
    });
    iframe.srcdoc = srcDoc;
    session.current = {
      postMode,
      postSavedState,
      restoreScroll(position) {
        scrollPosition.current = { regionId, ...position };
        if (ready) {
          postState('studio-html-scroll-restore', { sourceRevision, ...position });
        }
      },
      clearInteraction,
      pauseSaves() {
        if (!queue.pending && !queue.processing) {
          return;
        }

        queue.paused = true;
        queue.error = permissionChanged;
      },
      retrySave() {
        if (queue.processing || !committedProps.current.onStateChange) {
          return;
        }

        queue.paused = false;
        queue.error = null;
        startSave();
      },
      adoptSharedState() {
        if (queue.processing) {
          return;
        }

        committedProps.current.onUseSharedState?.();
        queue.pending = null;
        queue.paused = false;
        queue.error = null;
        publishSave();
        postState('studio-html-state-reset', { ...authority() });
      },
    };

    window.addEventListener('message', receive);
    return () => {
      queue.active = false;
      session.current = null;
      window.removeEventListener('message', receive);
      clearInteraction();
    };
  }, [source, setSaveView]);

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
    session.current?.postSavedState();
  }, [saved.state, saved.version, source]);

  const displayRaster = zoom >= 0.5;
  const rasterZoom = displayRaster ? zoom : 1;
  const receivesInput = annotation || interactive;
  return (
    <div className={`studio-html-region${annotation ? ' is-annotating' : ''}`}>
      <iframe
        ref={frame}
        title={element.text || 'HTML 图解'}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
        tabIndex={receivesInput ? 0 : -1}
        onLoad={() => session.current?.postMode()}
        style={{
          width: `${rasterZoom * 100}%`,
          height: `${rasterZoom * 100}%`,
          zoom: rasterZoom,
          transform: displayRaster ? `scale(${1 / zoom})` : undefined,
          transformOrigin: '0 0',
          pointerEvents: receivesInput ? 'auto' : 'none',
        }}
      />
      {activeSave && activeSave.error !== null && (
        <OperationNotice
          source={element.text ? `HTML 图解 · ${element.text}` : 'HTML 图解'}
          message={activeSave.error + ' 本地交互修改已保留。'}
          closeLabel="关闭 HTML 保存通知"
          fallbackClass="studio-html-state-error"
          actions={
            <>
              <button
                type="button"
                disabled={!writable || activeSave.processing}
                onClick={() => session.current?.retrySave()}
              >
                重试保存
              </button>
              <button
                type="button"
                disabled={activeSave.processing}
                onClick={() => session.current?.adoptSharedState()}
              >
                使用共享状态
              </button>
              <details>
                <summary>查看共享状态</summary>
                <pre>
                  {JSON.stringify(authoritativeState(saved, activeSave.accepted).state, null, 2)}
                </pre>
              </details>
            </>
          }
        />
      )}
    </div>
  );
}
