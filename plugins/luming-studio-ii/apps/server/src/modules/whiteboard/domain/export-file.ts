import { exportConnector } from './export-geometry.js';
import { renderExportSvg } from './export-svg.js';
import {
  maxExportFileBytes,
  type BoardExportSnapshot,
  type ExportBoardResult,
} from './export-types.js';
import type { BoardObject, ConnectorEndpoint } from './model.js';

const reservedFilename = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function filenameFor(title: string, format: 'json' | 'svg'): string {
  const name = Array.from(title)
    .slice(0, 100)
    .join('')
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, '-')
    .trim()
    .replace(/[. ]+$/u, '');
  const filename = reservedFilename.test(name) ? '白板-' + name : name || '白板';

  return filename + '.' + format;
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

export function renderExportFile(
  snapshot: BoardExportSnapshot,
  format: 'json' | 'svg',
): ExportBoardResult {
  const data = format === 'svg' ? renderExportSvg(snapshot) : jsonExport(snapshot);
  if (typeof data !== 'string') {
    return data;
  }

  const content = new TextEncoder().encode(data);
  if (content.byteLength > maxExportFileBytes) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  return {
    kind: 'file',
    filename: filenameFor(snapshot.board.title, format),
    mimeType: format === 'svg' ? 'image/svg+xml' : 'application/json',
    revision: snapshot.board.revision,
    content,
  };
}
