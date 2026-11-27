import { finitePoint, geometryCorners } from './export-geometry.js';
import { documentMarkup, embedMarkup, offlineAsset, todoMarkup } from './export-html-content.js';
import { escapeXml } from './export-svg-content.js';
import {
  expandFrame,
  exportViewport,
  positionedSvgMarkup,
  type ExportFrame,
} from './export-svg.js';
import {
  maxExportFileBytes,
  type BoardExportRejection,
  type BoardExportSnapshot,
} from './export-types.js';
import type { BoardObject, Geometry, PayloadRecord } from './model.js';

const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>body{margin:0;background:#f5f5f5;color:#2d3142;font:16px/1.5 system-ui,sans-serif}main{position:relative;overflow:hidden;margin:auto}.world{position:absolute;inset:0}iframe,svg,video{display:block;border:0}iframe{background:transparent}section{box-sizing:border-box;overflow:auto;background:#fff;border:1px solid #bfc0c0;border-radius:4px;padding:.7em 1em}h1{margin:.05em 0 .5em;font-size:1.1em}h2,h3{margin:.8em 0 .35em}p,pre,figure,blockquote{margin:.5em 0;overflow-wrap:anywhere}pre{white-space:pre-wrap}.list-item{display:list-item;margin-left:1.25em}img{max-width:100%}figcaption{font-size:.85em}video{background:#111;object-fit:contain}ul{list-style:none;padding:0;margin:0}li{padding:.3em 0;border-top:1px solid #e6e6e6}li input{vertical-align:middle;margin-right:.5em}@media print{main{margin:0}}</style>`;

function positioned({ x, y, width, height, rotation }: Geometry) {
  return `position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;transform:rotate(${rotation % 360}deg)`;
}

function nativeLayer(object: BoardObject, payload: PayloadRecord, snapshot: BoardExportSnapshot) {
  const label = escapeXml(object.label);
  const position = positioned(object.geometry);
  const { data } = payload;
  switch (payload.bodyKind) {
    case 'document':
      return `<section style="${position}" aria-label="${label}"><h1>${label}</h1>${documentMarkup(data.blocks, snapshot.assets)}</section>`;
    case 'todo':
      return `<section style="${position}" aria-label="${label}"><h1>${label}</h1>${todoMarkup(data.items)}</section>`;
    case 'embed':
      return `<iframe title="${label}" sandbox="allow-scripts" style="${position}" srcdoc="${escapeXml(embedMarkup(data, snapshot.assets))}"></iframe>`;
    case 'video': {
      const source = offlineAsset(data.src, snapshot.assets);
      if (!source?.startsWith('data:video/')) {
        return false;
      }

      const poster = offlineAsset(data.poster, snapshot.assets);
      const posterAttribute = poster?.startsWith('data:image/')
        ? ` poster="${escapeXml(poster)}"`
        : '';

      return `<video controls playsinline preload="metadata" style="${position}" src="${escapeXml(source)}"${posterAttribute}></video>`;
    }
  }
}

function vectorLayer(
  object: BoardObject,
  index: number,
  payload: PayloadRecord | undefined,
  snapshot: BoardExportSnapshot,
) {
  const shape = positionedSvgMarkup(object, index, snapshot, payload);
  if (!shape) {
    return undefined;
  }

  const frame = expandFrame(undefined, shape.bounds);
  const { left, top, right, bottom } = frame;
  const width = Math.max(1, right - left + 4);
  const height = Math.max(1, bottom - top + 4);
  const x = left - 2;
  const y = top - 2;
  const style = `position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
  const value = `<svg xmlns="http://www.w3.org/2000/svg" style="${style}" viewBox="${x} ${y} ${width} ${height}">${shape.value}</svg>`;

  return { value, bounds: shape.bounds };
}

function objectLayer(
  object: BoardObject,
  index: number,
  snapshot: BoardExportSnapshot,
  payload: PayloadRecord | undefined,
) {
  const native = payload ? nativeLayer(object, payload, snapshot) : undefined;
  if (native === false) {
    return undefined;
  }
  if (native === undefined) {
    return vectorLayer(object, index, payload, snapshot);
  }

  const bounds = geometryCorners(object.geometry);

  return bounds.every(finitePoint) ? { value: native, bounds } : undefined;
}

export function renderExportHtmlSource(
  snapshot: BoardExportSnapshot,
): string | BoardExportRejection {
  const [payload] = snapshot.payloads;
  if (payload?.bodyKind === 'embed' && typeof payload.data.html === 'string') {
    return payload.data.html;
  }

  return { kind: 'rejected', reason: 'unsupported' };
}

export function renderExportHtml(snapshot: BoardExportSnapshot): string | BoardExportRejection {
  const payloads = new Map(snapshot.payloads.map((payload) => [payload.objectId, payload]));
  const layers: string[] = [];
  const utf8 = new TextEncoder();
  let bytes = 0;
  let frame: ExportFrame | undefined;

  for (const [index, object] of snapshot.objects.entries()) {
    const layer = objectLayer(object, index, snapshot, payloads.get(object.objectId));
    if (!layer) {
      return { kind: 'rejected', reason: 'unsupported' };
    }

    bytes += utf8.encode(layer.value).byteLength;
    if (bytes > maxExportFileBytes) {
      return { kind: 'rejected', reason: 'tooLarge' };
    }

    frame = expandFrame(frame, layer.bounds);
    layers.push(layer.value);
  }

  const { x, y, width, height } = exportViewport(frame);
  const title = escapeXml(snapshot.board.title);

  return `<!doctype html>\n<html lang="zh-CN"><head>${head}<title>${title}</title></head><body><main aria-label="${title}" style="width:${width}px;height:${height}px"><div class="world" style="transform:translate(${-x}px,${-y}px)">${layers.join('')}</div></main></body></html>\n`;
}
