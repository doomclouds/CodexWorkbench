import type { HtmlSelection, Json } from '../../../contracts/studio.js';

export type HtmlAnnotationMode = 'element' | 'text' | 'area';
export interface HtmlRuntimeOptions {
  channel: string;
  regionId: string;
  sourceRevision: number;
  annotation: boolean;
  mode: HtmlAnnotationMode;
  state?: Json;
  elementVersion?: number;
  writable?: boolean;
}

/** Only the generated rendering copy contains this bridge; region.html stays canonical. */
function selectionRuntime(config: HtmlRuntimeOptions): void {
  let enabled = config.annotation;
  let mode = config.mode;
  let areaStart: { x: number; y: number } | null = null;
  let outline: HTMLDivElement | null = null;
  let area: HTMLDivElement | null = null;
  let lastSentAt = 0;
  let embedState: Json = config.state ?? null;
  let elementVersion = config.elementVersion ?? 0;
  let saveSequence = 0;
  const stateListeners = new Set<(state: Json) => void>();
  const cloneState = (value: Json): Json => JSON.parse(JSON.stringify(value)) as Json;
  const showStateError = (message: string) => window.dispatchEvent(new CustomEvent('studio-embed-error', { detail: { message } }));
  const receiveState = (value: Json, version: number) => {
    if (version < elementVersion) return;
    const changed = JSON.stringify(value) !== JSON.stringify(embedState);
    embedState = cloneState(value); elementVersion = version;
    if (changed) for (const listener of stateListeners) { try { listener(cloneState(embedState)); } catch { /* An embed listener cannot break synchronization. */ } }
  };
  Object.defineProperty(window, 'studioEmbed', { configurable: false, writable: false, value: Object.freeze({
    load: () => cloneState(embedState),
    save: (value: unknown) => {
      if (!config.writable) { showStateError('当前视图没有保存嵌入状态的权限。'); return; }
      let encoded: string;
      try { encoded = JSON.stringify(value); } catch { showStateError('嵌入状态必须是可序列化的 JSON 对象。'); return; }
      if (!value || typeof value !== 'object' || Array.isArray(value) || !encoded || new TextEncoder().encode(encoded).byteLength > 65536) { showStateError('嵌入状态必须是 64 KB 以内的 JSON 对象。'); return; }
      embedState = JSON.parse(encoded) as Json;
      window.parent.postMessage({ type: 'studio-html-state', channel: config.channel, regionId: config.regionId, sourceRevision: config.sourceRevision, baseVersion: elementVersion, saveId: ++saveSequence, state: cloneState(embedState) }, '*');
    },
    onLoad: (listener: (state: Json) => void) => { if (typeof listener !== 'function') throw new TypeError('onLoad 需要一个函数。'); stateListeners.add(listener); return () => stateListeners.delete(listener); },
  }) });
  const limit = (text: string, length: number) => text.slice(0, length);
  const escape = (value: string) => CSS.escape(value);
  const toElement = (node: EventTarget | Node | null): Element | null => node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  const semantic = (element: Element | null): Element | null => element?.closest('[data-studio-id]') ?? element?.closest('text, path, rect, circle, ellipse, polygon, polyline, line, h1, h2, h3, p, li, td, th, figure, section, article') ?? element;
  const selector = (element: Element): string => {
    const id = element.getAttribute('data-studio-id');
    if (id) return `[data-studio-id="${escape(id)}"]`;
    if (element.id) return `#${escape(element.id)}`;
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.documentElement && parts.length < 10) {
      const tag = current.localName;
      const siblings: Element[] = current.parentElement ? [...current.parentElement.children].filter((child) => child.localName === tag) : [current];
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const excerpt = (element: Element): string => {
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('[data-studio-runtime],script').forEach((child) => child.remove());
    return limit(copy.outerHTML, 15000);
  };
  const rectOf = (rect: DOMRect) => ({ x: rect.x + window.scrollX, y: rect.y + window.scrollY, w: rect.width, h: rect.height });
  const send = (elements: Element[], quote: string, rect: { x: number; y: number; w: number; h: number }) => {
    const now = Date.now();
    if (now - lastSentAt < 120) return;
    lastSentAt = now;
    const selected = elements.filter((element) => !element.closest('[data-studio-runtime]')).slice(0, 80);
    const targetIds = [...new Set(selected.map((element) => element.getAttribute('data-studio-id')).filter((id): id is string => Boolean(id)))];
    const first = selected[0];
    window.parent.postMessage({ type: 'studio-html-selection', channel: config.channel, regionId: config.regionId, sourceRevision: config.sourceRevision,
      targetIds, quote: limit(quote, 4000), excerpt: limit(selected.map(excerpt).join('\n'), 15000), selector: first ? selector(first) : undefined, rect,
    }, '*');
  };
  const overlay = (name: string) => {
    const element = document.createElement('div');
    element.setAttribute('data-studio-runtime', name);
    Object.assign(element.style, { position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', border: '2px solid #eb6c36', background: 'rgba(235,108,54,.08)', borderRadius: '3px', boxSizing: 'border-box', display: 'none' });
    document.body.append(element);
    return element;
  };
  const show = (element: HTMLDivElement, box: { x: number; y: number; width: number; height: number }) => Object.assign(element.style, { display: 'block', left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
  const setMode = () => {
    document.documentElement.style.cursor = enabled ? mode === 'text' ? 'text' : 'crosshair' : '';
    if (outline) outline.style.display = 'none';
    if (area) area.style.display = 'none';
    areaStart = null;
  };
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent || !event.data || event.data.channel !== config.channel) return;
    if (event.data.type === 'studio-html-state-update' && event.data.regionId === config.regionId && Number.isInteger(event.data.version)) {
      receiveState(event.data.state ?? null, event.data.version); return;
    }
    if (event.data.type === 'studio-html-state-error' && event.data.regionId === config.regionId) {
      receiveState(event.data.state ?? null, event.data.version);
      showStateError(typeof event.data.message === 'string' ? event.data.message : '嵌入状态未能保存。'); return;
    }
    if (event.data.type !== 'studio-html-mode') return;
    if (!['element', 'text', 'area'].includes(event.data.mode)) return;
    enabled = event.data.enabled === true;
    config.writable = event.data.writable === true;
    mode = event.data.mode;
    setMode();
    window.parent.postMessage({ type: 'studio-html-ready', channel: config.channel, regionId: config.regionId }, '*');
  });
  const setup = () => {
    outline = overlay('outline');
    area = overlay('area');
    setMode();
    document.addEventListener('submit', (event) => event.preventDefault(), true);
    document.addEventListener('click', (event) => {
      const target = toElement(event.target);
      if (target?.closest('a,area')) event.preventDefault();
      if (!enabled || mode !== 'element') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const element = semantic(target);
      if (!element || element.closest('[data-studio-runtime]')) return;
      const parent = element.parentElement?.closest('[data-studio-id]');
      const text = `${element.textContent?.trim() ?? ''}${parent && parent !== element ? `\n所属：${parent.getAttribute('data-studio-id') ?? ''}` : ''}`;
      send([element], text, rectOf(element.getBoundingClientRect()));
    }, true);
    document.addEventListener('pointermove', (event: PointerEvent) => {
      if (!enabled) return;
      if (mode === 'area' && areaStart && area) {
        show(area, { x: Math.min(areaStart.x, event.clientX), y: Math.min(areaStart.y, event.clientY), width: Math.abs(event.clientX - areaStart.x), height: Math.abs(event.clientY - areaStart.y) });
      } else if (mode === 'element' && outline) {
        const element = semantic(toElement(event.target));
        if (element && !element.closest('[data-studio-runtime]')) show(outline, element.getBoundingClientRect());
      }
    }, true);
    document.addEventListener('pointerdown', (event: PointerEvent) => {
      if (!enabled || mode !== 'area' || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      areaStart = { x: event.clientX, y: event.clientY };
    }, true);
    document.addEventListener('pointerup', (event: PointerEvent) => {
      if (!enabled) return;
      if (mode === 'text') {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const element = semantic(toElement(range.commonAncestorContainer));
        if (element) send([element], selection.toString(), rectOf(range.getBoundingClientRect()));
      } else if (mode === 'area' && areaStart) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const box = { x: Math.min(areaStart.x, event.clientX), y: Math.min(areaStart.y, event.clientY), w: Math.abs(event.clientX - areaStart.x), h: Math.abs(event.clientY - areaStart.y) };
        areaStart = null;
        if (area) area.style.display = 'none';
        if (box.w < 4 || box.h < 4) return;
        const targets = [...document.querySelectorAll('[data-studio-id]')].filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.left <= box.x + box.w && rect.right >= box.x && rect.top <= box.y + box.h && rect.bottom >= box.y;
        });
        const deepest = targets.filter((element) => !targets.some((other) => other !== element && element.contains(other)));
        send(deepest, deepest.map((element) => element.textContent?.trim() ?? '').join('\n'), { x: box.x + scrollX, y: box.y + scrollY, w: box.w, h: box.h });
      }
    }, true);
    window.parent.postMessage({ type: 'studio-html-ready', channel: config.channel, regionId: config.regionId }, '*');
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true }); else setup();
}

export const HTML_REGION_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'";

export function buildHtmlRegionDocument(source: string, options: HtmlRuntimeOptions): string {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc.querySelectorAll('base,iframe,frame,frameset,object,embed,portal,link,meta[http-equiv],script[src]').forEach((node) => node.remove());
  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || ['target', 'formtarget', 'action', 'formaction', 'srcdoc', 'ping'].includes(name)) element.removeAttribute(attribute.name);
      else if (['src', 'poster', 'xlink:href'].includes(name) && !/^(?:data:(?:image|font|video|audio)\/|blob:|#)/i.test(attribute.value)) element.removeAttribute(attribute.name);
      else if (name === 'href' && !attribute.value.startsWith('#')) element.removeAttribute(attribute.name);
    }
  }
  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = HTML_REGION_CSP;
  const defaults = doc.createElement('style');
  defaults.setAttribute('data-studio-runtime', 'defaults');
  defaults.textContent = 'html{color-scheme:light;background:#f5f5f5;color:#2d3142}body{margin:0;font-family:Arial,"Microsoft YaHei",sans-serif}*{box-sizing:border-box}svg{max-width:100%}';
  const bridge = doc.createElement('script');
  bridge.setAttribute('data-studio-runtime', 'bridge');
  bridge.textContent = `(${selectionRuntime.toString()})(${JSON.stringify(options).replace(/</g, '\\u003c')});`;
  doc.head.prepend(csp, defaults, bridge);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

export function validateHtmlSelectionMessage(value: unknown, expected: Pick<HtmlRuntimeOptions, 'channel' | 'regionId' | 'sourceRevision'>): HtmlSelection | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (input.type !== 'studio-html-selection' || input.channel !== expected.channel || input.regionId !== expected.regionId || input.sourceRevision !== expected.sourceRevision) return null;
  if (!Array.isArray(input.targetIds) || input.targetIds.length > 100 || !input.targetIds.every((id) => typeof id === 'string' && id.length <= 160 && !/[\u0000-\u001f]/.test(id))) return null;
  if (typeof input.quote !== 'string' || input.quote.length > 4000 || typeof input.excerpt !== 'string' || input.excerpt.length > 16000) return null;
  if (input.selector !== undefined && (typeof input.selector !== 'string' || input.selector.length > 1200)) return null;
  let rect: HtmlSelection['rect'];
  if (input.rect !== undefined) {
    if (!input.rect || typeof input.rect !== 'object') return null;
    const candidate = input.rect as Record<string, unknown>;
    if (!['x', 'y', 'w', 'h'].every((key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]) && Math.abs(candidate[key] as number) <= 1e7)) return null;
    if ((candidate.w as number) < 0 || (candidate.h as number) < 0) return null;
    rect = { x: candidate.x as number, y: candidate.y as number, w: candidate.w as number, h: candidate.h as number };
  }
  return { regionId: expected.regionId, sourceRevision: expected.sourceRevision, targetIds: [...new Set(input.targetIds as string[])], quote: input.quote, excerpt: input.excerpt, ...(typeof input.selector === 'string' ? { selector: input.selector } : {}), ...(rect ? { rect } : {}) };
}

export interface HtmlStateSave { state: Json; baseVersion: number; saveId: number }

export function validateHtmlStateMessage(value: unknown, expected: Pick<HtmlRuntimeOptions, 'channel' | 'regionId' | 'sourceRevision'>): HtmlStateSave | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (input.type !== 'studio-html-state' || input.channel !== expected.channel || input.regionId !== expected.regionId || input.sourceRevision !== expected.sourceRevision) return null;
  if (!Number.isInteger(input.baseVersion) || (input.baseVersion as number) < 1 || !Number.isInteger(input.saveId) || (input.saveId as number) < 1) return null;
  if (!input.state || typeof input.state !== 'object' || Array.isArray(input.state)) return null;
  try {
    const encoded = JSON.stringify(input.state);
    if (new TextEncoder().encode(encoded).byteLength > 65536) return null;
    const validate = (current: unknown, depth: number): boolean => {
      if (depth > 16) return false;
      if (current === null || typeof current === 'boolean' || typeof current === 'string') return true;
      if (typeof current === 'number') return Number.isFinite(current);
      if (Array.isArray(current)) return current.every((child) => validate(child, depth + 1));
      return Boolean(current && typeof current === 'object' && Object.values(current).every((child) => validate(child, depth + 1)));
    };
    if (!validate(input.state, 0)) return null;
    return { state: JSON.parse(encoded) as Json, baseVersion: input.baseVersion as number, saveId: input.saveId as number };
  } catch { return null; }
}
