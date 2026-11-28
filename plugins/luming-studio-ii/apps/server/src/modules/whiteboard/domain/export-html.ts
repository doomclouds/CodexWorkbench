import { finitePoint, geometryCorners } from './export-geometry.js';
import {
  boardTableCss,
  boardTableMarkup,
  documentAssetsAvailable,
  documentMarkup,
  embedMarkup,
  exportLink,
  offlineAsset,
  richTextMarkup,
  todoMarkup,
} from './export-html-content.js';
import { escapeXml } from './export-svg-content.js';
import { svgColor, svgShape } from './export-svg-shapes.js';
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
import type { BoardObject, Geometry, JsonObject, PayloadRecord } from './model.js';

const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src 'self' data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>
body{margin:0;background:#f5f5f5;color:#2d3142;font:16px/1.5 system-ui,sans-serif}
main{position:relative;overflow:hidden;margin:auto}.world{position:absolute;inset:0}
iframe,svg,video{display:block;border:0}iframe{background:transparent}
.native-card{box-sizing:border-box;overflow:auto;background:#fff;border:1px solid #bfc0c0;border-radius:4px;padding:.7em 1em}
.board-table-frame{overflow:auto}.board-document table{width:100%;border-collapse:collapse}.board-document :is(th,td){border:1px solid #bfc0c0;padding:6px 10px}.board-document th{background:#ececec}
.native-link{display:flex;flex-direction:column;justify-content:center;gap:4px;text-decoration:none;overflow-wrap:anywhere}.native-link strong{text-decoration:underline}.native-link small{color:#4f5d75}
.board-rich-text{box-sizing:border-box;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.board-rich-line{min-height:1.45em}.board-shape-label{display:flex;align-items:center;width:100%;height:100%;pointer-events:none}.board-shape-label>div{width:100%}.board-shape-label a{pointer-events:auto}
h1{margin:.05em 0 .5em;font-size:1.1em}h2,h3{margin:.8em 0 .35em}p,pre,figure,blockquote{margin:.5em 0;overflow-wrap:anywhere}pre{white-space:pre-wrap}
a{color:#2e5aa8}img{max-width:100%;height:auto}figcaption{font-size:.85em}video{background:#111;object-fit:contain}
.board-tasks,.task-list{list-style:none;padding:0;margin:0}.board-tasks li{padding:.3em 0;border-top:1px solid #e6e6e6}li input{vertical-align:middle;margin-right:.5em}
@media print{main{margin:0}}
${boardTableCss}</style>`;

const nativePayloadKinds = new Set([
  'document',
  'todo',
  'table',
  'html',
  'chart',
  'diagram',
  'video',
  'link',
]);

function positioned({ x, y, width, height, rotation }: Geometry) {
  return `position:absolute;left:${x}px;top:${y}px;width:${width}px;height:${height}px;transform:rotate(${rotation % 360}deg)`;
}

function textStyle(data: JsonObject, centered: boolean) {
  const color = svgColor(typeof data.color === 'string' ? data.color : undefined, '#2d3142');
  const size =
    typeof data.fontSize === 'number' && Number.isFinite(data.fontSize)
      ? Math.max(8, Math.min(400, data.fontSize))
      : 16;
  const family =
    typeof data.fontFamily === 'string' && /^[\p{L}\p{N} ,_-]{1,80}$/u.test(data.fontFamily)
      ? data.fontFamily
      : 'system-ui,sans-serif';
  const fallbackAlign = centered || data.align === 'TEXT_ALIGNMENT_CENTER' ? 'center' : 'left';
  const align = data.align === 'TEXT_ALIGNMENT_RIGHT' ? 'right' : fallbackAlign;
  const weight = data.bold === true ? 700 : 400;
  const slant = data.italic === true ? 'italic' : 'normal';

  return `;color:${color};font:${slant} ${weight} ${size}px/1.45 ${family};text-align:${align}`;
}

function objectText(object: BoardObject, data: JsonObject) {
  return richTextMarkup(typeof data.text === 'string' ? data.text : object.label);
}

function textCard(object: BoardObject, data: JsonObject) {
  const note = object.kind === 'note';
  const fill = svgColor(object.appearance?.fill, '#f6e39c');
  const stroke = svgColor(object.appearance?.stroke, '#bfc0c0');
  const decoration = note
    ? `;background:${fill};border:1px solid ${stroke};border-radius:4px;padding:12px`
    : '';
  const style = positioned(object.geometry) + textStyle(data, note) + decoration;

  return `<div class="board-rich-text" style="${style}">${objectText(object, data)}</div>`;
}

function shapeMarkup(object: BoardObject, data: JsonObject) {
  const { width, height } = object.geometry;
  const outline = object.detail?.kind === 'shape' ? object.detail.outline : 'rounded';
  const shape = svgShape(outline, width, height, object.appearance);
  if (shape === undefined) {
    return undefined;
  }

  const style = textStyle(data, true);

  return `${shape}<foreignObject width="${width}" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml" class="board-rich-text board-shape-label" style="${style}"><div>${objectText(object, data)}</div></div></foreignObject>`;
}

function nativeLayer(
  object: BoardObject,
  payload: PayloadRecord | undefined,
  snapshot: BoardExportSnapshot,
) {
  if (object.kind === 'text' || object.kind === 'note') {
    return textCard(object, payload?.data ?? {});
  }
  if (!payload) {
    return undefined;
  }

  const label = escapeXml(object.label);
  const position = positioned(object.geometry);
  const { data } = payload;
  switch (payload.bodyKind) {
    case 'document':
      return documentAssetsAvailable(data.blocks, snapshot.assets)
        ? `<section class="native-card board-document" style="${position}" aria-label="${label}"><h1>${label}</h1>${documentMarkup(data.blocks, snapshot.assets)}</section>`
        : false;
    case 'todo':
      return `<section class="native-card" style="${position}" aria-label="${label}"><h1>${label}</h1>${todoMarkup(data.items)}</section>`;
    case 'table':
      return `<section class="board-table-frame" style="${position}" aria-label="${label}">${boardTableMarkup(data, object.appearance?.fill)}</section>`;
    case 'link': {
      const href = exportLink(data.href);

      return href
        ? `<a class="native-card native-link" style="${position}" href="${href}" target="_blank" rel="noopener noreferrer"><strong>${label}</strong><small>${href}</small></a>`
        : undefined;
    }
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
  const richShape = object.kind === 'shape' ? shapeMarkup(object, payload?.data ?? {}) : undefined;
  const shape = positionedSvgMarkup(object, index, snapshot, payload, richShape);
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
  const native = nativeLayer(object, payload, snapshot);

  if (native === false) {
    return { kind: 'rejected', reason: 'assetUnavailable' } satisfies BoardExportRejection;
  }
  if (native === undefined) {
    return nativePayloadKinds.has(object.kind)
      ? undefined
      : vectorLayer(object, index, payload, snapshot);
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
    if ('kind' in layer) {
      return layer;
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
