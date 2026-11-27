import { exportConnector } from './export-geometry.js';
import { renderExportHtml, renderExportHtmlSource } from './export-html.js';
import { renderExportSvg } from './export-svg.js';
import {
  maxExportFileBytes,
  type BoardExportSnapshot,
  type ExportRenderCommand,
  type ExportBoardResult,
} from './export-types.js';
import type { BoardObject, ConnectorEndpoint } from './model.js';

const reservedFilename = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export function exportFilename(title: string, extension: string): string {
  const name = Array.from(title)
    .slice(0, 100)
    .join('')
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, '-')
    .trim()
    .replace(/[. ]+$/u, '');
  const filename = reservedFilename.test(name) ? '白板-' + name : name || '白板';

  return filename + '.' + extension;
}

function isOutside(endpoint: ConnectorEndpoint, selected: ReadonlySet<string>): boolean {
  return endpoint.attachment !== undefined && !selected.has(endpoint.attachment.objectId);
}

function standaloneObject(
  object: BoardObject,
  selected: ReadonlySet<string>,
  geometry: BoardExportSnapshot['geometry'],
): BoardObject {
  const { detail } = object;
  if (detail?.kind !== 'connector') {
    return object;
  }

  const outsideStart = isOutside(detail.start, selected);
  const outsideEnd = isOutside(detail.end, selected);
  if (!outsideStart && !outsideEnd) {
    return object;
  }

  const route = exportConnector(detail, geometry);
  const startPoint = route?.points[0] ?? detail.start.point;
  const endPoint = route?.points.at(-1) ?? detail.end.point;

  return {
    ...object,
    detail: {
      ...detail,
      start: outsideStart ? { point: startPoint } : detail.start,
      end: outsideEnd ? { point: endPoint } : detail.end,
      bends: route?.points.slice(1, -1) ?? detail.bends,
      relativeBends: undefined,
    },
  };
}

function jsonExport(snapshot: BoardExportSnapshot): string {
  const selected = new Set(snapshot.objects.map(({ objectId }) => objectId));
  const assets = [...snapshot.assets].map(([source, asset]) => ({ source, ...asset }));
  const data = {
    schemaVersion: 1,
    board: snapshot.board,
    objects: snapshot.objects.map((object) =>
      standaloneObject(object, selected, snapshot.geometry),
    ),
    payloads: snapshot.payloads,
    assets,
  };
  const json = JSON.stringify(data, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );

  return json + '\n';
}

function encodeFile(
  snapshot: BoardExportSnapshot,
  data: string | ExportBoardResult,
  extension: string,
  mimeType: string,
  title = snapshot.board.title,
): ExportBoardResult {
  if (typeof data !== 'string') {
    return data;
  }

  const content = new TextEncoder().encode(data);
  if (content.byteLength > maxExportFileBytes) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  return {
    kind: 'file',
    filename: exportFilename(title, extension),
    mimeType,
    revision: snapshot.board.revision,
    content,
  };
}

function renderVectorFile(snapshot: BoardExportSnapshot, format: 'svg' | 'png'): ExportBoardResult {
  const scene = renderExportSvg(snapshot);
  if (scene.kind === 'rejected') {
    return scene;
  }

  if (scene.regions.length) {
    const { width, height } = scene.viewport;
    const dimensions = width <= 16384 && height <= 16384;
    if (!dimensions || Math.ceil(width) * Math.ceil(height) > 32_000_000) {
      return { kind: 'rejected', reason: 'tooLarge' };
    }

    return {
      kind: 'browserPng',
      filename: exportFilename(snapshot.board.title, format),
      revision: snapshot.board.revision,
      width,
      height,
      svgTemplate: scene.svg,
      regions: scene.regions,
    };
  }

  return encodeFile(snapshot, scene.svg, 'svg', 'image/svg+xml');
}

export function renderExportFile(
  snapshot: BoardExportSnapshot,
  { format, scope }: Pick<ExportRenderCommand, 'format' | 'scope'>,
): ExportBoardResult {
  switch (format) {
    case 'svg':
    case 'png':
      return renderVectorFile(snapshot, format);
    case 'html': {
      const selected = scope.kind === 'selection';
      const html = selected ? renderExportHtmlSource(snapshot) : renderExportHtml(snapshot);
      const title = selected
        ? snapshot.objects[0]?.label || snapshot.board.title
        : snapshot.board.title;

      return encodeFile(snapshot, html, 'html', 'text/html', title);
    }
    case 'json':
      return encodeFile(snapshot, jsonExport(snapshot), 'json', 'application/json');
  }
}
