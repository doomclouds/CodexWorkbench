import type {
  EmbedJson as Json,
  EmbedNavigationEvent as HtmlNavigationEvent,
  EmbedObjectProps,
  EmbedObjectValue,
  EmbedPoint,
} from './contracts.js';
import { createFrameChannel, isFrameVisible } from './frame-identity.js';
import {
  readAuthenticatedFrameMessage,
  validateHtmlAnnotationLocations,
  validateHtmlNavigationMessage,
  validateHtmlPointerMessage,
  validateHtmlScrollMessage,
  validateHtmlSelectionMessage,
  validateHtmlStateMessage,
} from './protocol.js';
import type { HtmlFrameSelection, HtmlPointerPosition, HtmlStateSave } from './protocol.js';
import { buildHtmlRegionDocument } from './runtime.js';
import { rebaseHtmlState } from './state.js';

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
export interface FrameSource {
  regionId: string;
  html: EmbedObjectValue['html'];
  sourceRevision: number;
}
export interface SaveView {
  source: FrameSource;
  processing: boolean;
  error: string | null;
  accepted?: SavedState;
}
export interface FrameSession {
  close(): void;
  postMode(): void;
  postSavedState(): void;
  postAnnotationLocations(): void;
  restoreScroll(position: { x: number; y: number }): void;
  clearInteraction(): void;
  pauseSaves(): void;
  retrySave(): void;
  adoptSharedState(): void;
}

export const permissionChanged = '当前视图的编辑权限已变更，未继续发送交互修改。';

export function frameSource(element: EmbedObjectValue): FrameSource {
  const { id: regionId, html, sourceRevision: explicitRevision, version } = element;
  return {
    regionId,
    html,
    sourceRevision: typeof explicitRevision === 'number' ? explicitRevision : version,
  };
}

export function authoritativeState(
  saved: Pick<EmbedObjectValue, 'state' | 'version'>,
  accepted?: SavedState,
): SavedState {
  if (accepted && accepted.version > saved.version) {
    return { state: accepted.state, version: accepted.version };
  }

  return { state: saved.state ?? null, version: saved.version };
}

interface FrameScroll {
  current: (EmbedPoint & { regionId: string }) | null;
}

interface EmbedFrameOptions {
  iframe: HTMLIFrameElement;
  view: Window;
  source: FrameSource;
  readProps: () => EmbedObjectProps;
  setSaveView: (view: SaveView | null) => void;
  scrollPosition: FrameScroll;
}

export function attachEmbedFrame({
  iframe,
  view,
  source,
  readProps,
  setSaveView,
  scrollPosition,
}: EmbedFrameOptions): FrameSession {
  const { regionId, sourceRevision, html } = source;
  const identity = { channel: createFrameChannel(), regionId, sourceRevision };
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
  let annotationTargets: ReadonlySet<string> = new Set();
  let locationRequest = 0;
  let requestedIds: ReadonlySet<string> = new Set();
  let revealed: number | undefined;
  let locationConsumer: EmbedObjectProps['annotationLocations'];

  if (scrollPosition.current?.regionId !== regionId) {
    scrollPosition.current = null;
  }

  const postState = (type: string, value: Record<string, unknown>) =>
    iframe.contentWindow?.postMessage({ type, ...identity, ...value }, '*');
  const authority = () => {
    const current = readProps();
    return authoritativeState(current.committedState ?? current.value, queue.accepted.at(-1));
  };
  const postMode = () => {
    const current = readProps();
    iframe.contentWindow?.postMessage(
      {
        type: 'studio-html-mode',
        ...identity,
        enabled: Boolean(current.annotation),
        writable: Boolean(current.onSaveState),
        preserveScroll: Boolean(current.preserveScroll),
        panMode: Boolean(current.panMode),
      },
      '*',
    );
  };
  const postSavedState = () => postState('studio-html-state-update', { ...authority() });
  const postAnnotationLocations = () => {
    if (!ready) {
      return;
    }

    const locations = readProps().annotationLocations;
    if (!locations && requestedIds.size === 0) {
      return;
    }

    locationConsumer = locations;
    const reveal = locations?.reveal;
    const ids = [reveal?.nodeId, ...(locations?.nodeIds ?? [])];
    requestedIds = new Set(
      ids.filter((id): id is string => Boolean(id && annotationTargets.has(id))).slice(0, 256),
    );
    const stillPending = reveal && requestedIds.has(reveal.nodeId) && reveal.sequence !== revealed;
    if (stillPending) {
      revealed = reveal.sequence;
    }
    postState('studio-html-track-annotations', {
      sequence: ++locationRequest,
      nodeIds: [...requestedIds],
      reveal: stillPending ? reveal.nodeId : undefined,
    });

    if (requestedIds.size === 0) {
      locations?.onChange(new Map());
    }
  };
  const reportPointer = (point: HtmlPointerPosition | null) => {
    readProps().onPointerPosition?.(point);
    pointerInside = Boolean(point);
  };
  const clearInteraction = () => {
    const navigate = readProps().onNavigation;
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
  const submitSave = async (
    task: HtmlStateSave,
    write: NonNullable<EmbedObjectProps['onSaveState']>,
  ) => {
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
    if (!idle || !readProps().onSaveState) {
      return;
    }

    queue.processing = true;
    publishSave();
    try {
      while (queue.active && !queue.paused && queue.pending) {
        const write = readProps().onSaveState;
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

  const applyNavigation = (navigation: HtmlNavigationEvent, current: EmbedObjectProps) => {
    const acceptsInput = current.annotation || current.interactive;
    if (!acceptsInput || !isFrameVisible(iframe)) {
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
  const initializeReadyFrame = (current: EmbedObjectProps) => {
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
    postAnnotationLocations();
  };
  const receiveFrameControl = (
    data: Record<string, unknown>,
    current: EmbedObjectProps,
  ): boolean => {
    switch (data.type) {
      case 'studio-html-tool-shortcut': {
        const key = data.key;
        if (typeof key === 'string' && /^[1-9]$/.test(key) && current.annotation) {
          if (isFrameVisible(iframe)) {
            current.onToolShortcut?.(key);
          }
        }
        return true;
      }
      case 'studio-html-escape':
        if (isFrameVisible(iframe)) {
          current.onEscape?.();
        }
        return true;
      case 'studio-html-ready':
        initializeReadyFrame(current);
        return true;
      default:
        return false;
    }
  };
  const reportSelection = (selection: HtmlFrameSelection, current: EmbedObjectProps) => {
    const { point, ...content } = selection;
    const bounds = iframe.getBoundingClientRect();
    const screenPoint = point
      ? {
          x: bounds.left + point.x * (bounds.width / (iframe.clientWidth || bounds.width || 1)),
          y: bounds.top + point.y * (bounds.height / (iframe.clientHeight || bounds.height || 1)),
        }
      : undefined;
    current.onSelection?.({ ...content, ...(screenPoint ? { screenPoint } : {}) });
  };
  const reportAnnotationLocations = (data: Record<string, unknown>, current: EmbedObjectProps) => {
    if (!ready || !locationConsumer || current.annotationLocations !== locationConsumer) {
      return;
    }

    const points = validateHtmlAnnotationLocations(data, identity, locationRequest, requestedIds);
    if (!points) {
      return;
    }

    const bounds = iframe.getBoundingClientRect();
    locationConsumer.onChange(
      new Map(
        [...points].map(([id, point]) => [
          id,
          point && {
            x: bounds.left + point.x * bounds.width,
            y: bounds.top + point.y * bounds.height,
          },
        ]),
      ),
    );
  };

  const receive = (event: MessageEvent<unknown>) => {
    const sourceWindow = iframe.contentWindow;
    if (!sourceWindow || event.source !== sourceWindow) {
      return;
    }

    const data = readAuthenticatedFrameMessage(event.data, identity);
    if (!data) {
      return;
    }

    const current = readProps();
    if (data.type === 'studio-html-annotation-locations') {
      reportAnnotationLocations(data, current);
      return;
    }
    const pointerEnabled = current.annotation || current.interactive;
    const navigation = validateHtmlNavigationMessage(data, identity);
    if (navigation) {
      applyNavigation(navigation, current);
      return;
    }
    const pointer = validateHtmlPointerMessage(data, identity);
    if (pointer) {
      if (pointerEnabled) {
        reportPointer(pointer.point);
      }
      return;
    }
    if (receiveFrameControl(data, current)) {
      return;
    }

    const scroll = validateHtmlScrollMessage(data, identity);
    if (scroll && current.preserveScroll && ready) {
      scrollPosition.current = { regionId, x: scroll.x, y: scroll.y };
      current.onReadingScroll?.({ x: scroll.x, y: scroll.y });
      return;
    }
    const state = validateHtmlStateMessage(data, identity);
    if (state && current.onSaveState && state.saveId > queue.sequence) {
      queue.sequence = state.saveId;
      queue.pending = state;
      startSave();
      return;
    }
    const selection = validateHtmlSelectionMessage(data, identity, annotationTargets);
    if (selection && current.annotation && isFrameVisible(iframe)) {
      reportSelection(selection, current);
    }
  };
  const current = readProps();
  const state = authority();
  const srcDoc = buildHtmlRegionDocument(
    html ?? '',
    {
      ...identity,
      annotation: Boolean(current.annotation),
      preserveScroll: Boolean(current.preserveScroll),
      state: state.state,
      elementVersion: state.version,
      writable: Boolean(current.onSaveState),
    },
    (ids) => {
      annotationTargets = ids;
    },
  );
  iframe.srcdoc = srcDoc;
  const session: FrameSession = {
    close() {
      queue.active = false;
      view.removeEventListener('message', receive);
      clearInteraction();
    },
    postMode,
    postSavedState,
    postAnnotationLocations,
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
      if (queue.processing || !readProps().onSaveState) {
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

      readProps().onAdoptSharedState?.();
      queue.pending = null;
      queue.paused = false;
      queue.error = null;
      publishSave();
      postState('studio-html-state-reset', { ...authority() });
    },
  };

  view.addEventListener('message', receive);
  return session;
}
