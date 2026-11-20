import type { OpenAIModelContextHostState } from '@openai/mcp-extensions/app';
import type { ViewContext } from '../contracts/studio';

type Viewport = NonNullable<ViewContext['viewport']>;
export type RestoredPanelView = Pick<ViewContext, 'viewId' | 'artifactId' | 'selectedIds' | 'viewport'>;
export interface PanelReadingView {
  artifactId: string;
  ids: string[];
  viewport: Viewport;
  returnViewport: Viewport;
  scroll?: { elementId: string; x: number; y: number };
}

const validId = (value: unknown): value is string => typeof value === 'string' && /^[-.\w]{1,120}$/.test(value);
const validIds = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 200 && value.every(validId);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function viewport(value: unknown): Viewport | undefined {
  if (record(value) && finite(value.x) && finite(value.y) && finite(value.zoom) && value.zoom >= .05 && value.zoom <= 8) {
    return { x: value.x, y: value.y, zoom: value.zoom };
  }
}

function parse(text: string | null | undefined): unknown {
  if (!text || text.length > 32 * 1024) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

export function restorePanelView(host: OpenAIModelContextHostState | undefined): RestoredPanelView | undefined {
  const text = host?.content?.find(block => block.type === 'text');
  const snapshot = host?.structuredContent ?? parse(text?.text);
  if (!record(snapshot) || snapshot.appId !== 'agentero-studio' || snapshot.panelOpen !== true ||
    !validId(snapshot.artifactId) || !validId(snapshot.viewId) || !validIds(snapshot.selectedIds)) return;
  return { artifactId: snapshot.artifactId, viewId: snapshot.viewId, selectedIds: [...new Set(snapshot.selectedIds)], viewport: viewport(snapshot.viewport) };
}

const keyFor = (viewId: string) => 'studio-panel-reading:' + viewId;
export function loadPanelReadingView(viewId: string, artifactId: string): PanelReadingView | undefined {
  if (!validId(viewId)) return;
  try {
    const snapshot = parse(window.sessionStorage.getItem(keyFor(viewId)));
    if (!record(snapshot) || snapshot.artifactId !== artifactId || !validIds(snapshot.ids) || !snapshot.ids.length) return;
    const current = viewport(snapshot.viewport), back = viewport(snapshot.returnViewport);
    if (!current || !back) return;
    const scroll = snapshot.scroll;
    return {
      artifactId, ids: [...new Set(snapshot.ids)], viewport: current, returnViewport: back,
      ...(record(scroll) && validId(scroll.elementId) && snapshot.ids.includes(scroll.elementId) && finite(scroll.x) && finite(scroll.y)
        ? { scroll: { elementId: scroll.elementId, x: scroll.x, y: scroll.y } } : {}),
    };
  } catch { /* The host may disallow local view storage. */ }
}

export function storePanelReadingView(viewId: string, reading: PanelReadingView | null): void {
  if (!validId(viewId)) return;
  try {
    const key = keyFor(viewId);
    if (reading && validIds(reading.ids)) window.sessionStorage.setItem(key, JSON.stringify(reading));
    else window.sessionStorage.removeItem(key);
  } catch { /* Reading state stays in the current view when storage is unavailable. */ }
}
