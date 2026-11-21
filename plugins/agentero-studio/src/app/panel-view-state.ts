import type { OpenAIModelContextHostState } from '@openai/mcp-extensions/app';
import type { ViewContext } from '../contracts/studio';
import { reportStudioWarning } from './transport';

type Viewport = NonNullable<ViewContext['viewport']>;
export type RestoredPanelView = Pick<
  ViewContext,
  'viewId' | 'artifactId' | 'selectedIds' | 'viewport'
>;
export interface PanelReadingView {
  artifactId: string;
  ids: string[];
  viewport: Viewport;
  returnViewport: Viewport;
  scroll?: { elementId: string; x: number; y: number };
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[-.\w]{1,120}$/.test(value);
const validIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 200 && value.every(validId);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function viewport(value: unknown): Viewport | undefined {
  if (!record(value)) {
    return;
  }

  const { x, y, zoom } = value;
  if (!finite(x) || !finite(y) || !finite(zoom)) {
    return;
  }
  if (zoom >= 0.05 && zoom <= 8) {
    return { x, y, zoom };
  }
}

function panelScroll(value: unknown, ids: string[]): PanelReadingView['scroll'] {
  if (!record(value) || !validId(value.elementId) || !ids.includes(value.elementId)) {
    return;
  }

  const { elementId, x, y } = value;
  if (finite(x) && finite(y)) {
    return { elementId, x, y };
  }
}

function parse(text: string | null | undefined): unknown {
  if (!text || text.length > 32 * 1024) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      reportStudioWarning('Studio could not decode the panel state.', error);
    }
    return undefined;
  }
}

function reportStorageFailure(error: unknown) {
  if (!(error instanceof DOMException && error.name === 'SecurityError')) {
    reportStudioWarning('Studio could not access the panel reading state.', error);
  }
}

export function restorePanelView(
  host: OpenAIModelContextHostState | undefined,
): RestoredPanelView | undefined {
  const text = host?.content?.find((block) => block.type === 'text');
  const snapshot = host?.structuredContent ?? parse(text?.text);
  if (!record(snapshot) || snapshot.appId !== 'agentero-studio' || snapshot.panelOpen !== true) {
    return;
  }

  const { artifactId, viewId, selectedIds } = snapshot;
  if (!validId(artifactId) || !validId(viewId) || !validIds(selectedIds)) {
    return;
  }

  return {
    artifactId,
    viewId,
    selectedIds: [...new Set(selectedIds)],
    viewport: viewport(snapshot.viewport),
  };
}

const keyFor = (viewId: string) => 'studio-panel-reading:' + viewId;

export function loadPanelReadingView(
  viewId: string,
  artifactId: string,
): PanelReadingView | undefined {
  if (!validId(viewId)) {
    return;
  }

  try {
    const snapshot = parse(window.sessionStorage.getItem(keyFor(viewId)));
    if (!record(snapshot) || snapshot.artifactId !== artifactId) {
      return;
    }
    if (!validIds(snapshot.ids) || !snapshot.ids.length) {
      return;
    }

    const current = viewport(snapshot.viewport);
    const back = viewport(snapshot.returnViewport);
    if (!current || !back) {
      return;
    }

    const scroll = panelScroll(snapshot.scroll, snapshot.ids);
    return {
      artifactId,
      ids: [...new Set(snapshot.ids)],
      viewport: current,
      returnViewport: back,
      ...(scroll ? { scroll } : {}),
    };
  } catch (error) {
    reportStorageFailure(error);
  }
}

export function storePanelReadingView(viewId: string, reading: PanelReadingView | null): void {
  if (!validId(viewId)) {
    return;
  }

  try {
    const key = keyFor(viewId);
    if (reading && validIds(reading.ids)) {
      window.sessionStorage.setItem(key, JSON.stringify(reading));
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch (error) {
    reportStorageFailure(error);
  }
}
