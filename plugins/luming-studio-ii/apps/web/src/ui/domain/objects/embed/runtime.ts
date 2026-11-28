import type { EmbedRuntimeOptions } from './contracts.js';
import { selectionRuntime } from './frame-runtime.js';
import { rebaseHtmlState } from './state.js';

const bubble =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M4 28V16a12 12 0 1 1 12 12H4Z" fill="#389cff" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>';
export const COMMENT_CURSOR =
  'url("data:image/svg+xml,' + encodeURIComponent(bubble) + '") 4 28, pointer';

export const HTML_REGION_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'";

function annotationTargets(doc: Document): ReadonlySet<string> {
  const unique = new Set<string>();
  const duplicates = new Set<string>();
  for (const element of doc.querySelectorAll('body [data-studio-id]')) {
    if (
      element.closest(
        'script,style,template,noscript,[data-studio-runtime],[hidden],[aria-hidden="true"]',
      )
    ) {
      continue;
    }

    const id = element.getAttribute('data-studio-id');
    if (!id) {
      continue;
    }

    if (unique.has(id)) {
      duplicates.add(id);
    }
    unique.add(id);
  }
  for (const id of duplicates) {
    unique.delete(id);
  }

  return unique;
}

export function buildHtmlRegionDocument(
  source: string,
  options: EmbedRuntimeOptions,
  receiveAnnotationTargets?: (targetIds: ReadonlySet<string>) => void,
): string {
  const doc = new DOMParser().parseFromString(source, 'text/html');
  doc
    .querySelectorAll(
      'base,iframe,frame,frameset,object,embed,portal,link,meta[charset],meta[http-equiv],script[src]',
    )
    .forEach((node) => node.remove());

  for (const element of doc.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith('on') ||
        ['target', 'formtarget', 'action', 'formaction', 'srcdoc', 'ping'].includes(name)
      ) {
        element.removeAttribute(attribute.name);
      } else if (
        ['src', 'poster', 'xlink:href'].includes(name) &&
        !/^(?:data:(?:image|font|video|audio)\/|blob:|#)/i.test(attribute.value)
      ) {
        element.removeAttribute(attribute.name);
      } else if (name === 'href' && !attribute.value.startsWith('#')) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  receiveAnnotationTargets?.(annotationTargets(doc));

  const charset = doc.createElement('meta');
  charset.setAttribute('charset', 'utf-8');
  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = HTML_REGION_CSP;
  const defaults = doc.createElement('style');
  defaults.setAttribute('data-studio-runtime', 'defaults');
  defaults.textContent =
    'html{color-scheme:light;background:#f5f5f5;color:#2d3142}body{margin:0;font-family:Arial,"Microsoft YaHei",sans-serif}*{box-sizing:border-box}svg{max-width:100%}';
  const cursorLayer = `studio-annotation-${options.channel.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const layerOrder = doc.createElement('style');
  layerOrder.setAttribute('data-studio-runtime', 'annotation-layer-order');
  layerOrder.textContent = `@layer ${cursorLayer};`;
  const bridge = doc.createElement('script');
  bridge.setAttribute('data-studio-runtime', 'bridge');
  bridge.textContent = `(${selectionRuntime.toString()})(${JSON.stringify({ ...options, commentCursor: COMMENT_CURSOR, cursorLayer }).replace(/</g, '\\u003c')}, ${rebaseHtmlState.toString()});`;

  doc.head.prepend(charset, csp, layerOrder, defaults, bridge);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
