import {
  renderExportFile,
  selectExportObjects,
  selectExportRectangle,
  type Actor,
  type BoardExportRejection,
  type BoardExportSnapshot,
  type BoardExportStale,
  type ExportRenderCommand,
  type ExportBoardResult,
} from '../domain/index.js';
import type { WhiteboardReader, WhiteboardRepository } from '../ports/index.js';
import { captureExportAssets } from './export-assets.js';

type AccessCheck = (reader: WhiteboardReader, actor: Actor, boardId: string) => void;
type CapturedExport = BoardExportSnapshot | BoardExportRejection | BoardExportStale;

const maxExportObjects = 10000;
const maxSnapshotObjects = 20000;

function captureHtmlSource(
  reader: WhiteboardReader,
  board: BoardExportSnapshot['board'],
  objectIds: readonly string[],
): CapturedExport {
  const [objectId] = objectIds;
  if (objectIds.length !== 1 || !objectId) {
    return { kind: 'rejected', reason: 'invalidSelection' };
  }

  const [object] = reader.getObjects(board.boardId, [objectId]);
  if (!object) {
    return { kind: 'rejected', reason: 'invalidSelection' };
  }
  if (object.kind !== 'html' && object.kind !== 'diagram' && object.kind !== 'chart') {
    return { kind: 'rejected', reason: 'unsupported' };
  }

  return {
    board,
    objects: [object],
    geometry: new Map([[objectId, object]]),
    payloads: reader.getPayloads(board.boardId, [objectId]),
    assets: new Map(),
  };
}

function captureSnapshot(
  reader: WhiteboardReader,
  command: ExportRenderCommand,
  board: BoardExportSnapshot['board'],
): CapturedExport {
  if (board.revision !== command.expectedRevision) {
    return { kind: 'stale', revision: board.revision };
  }
  if (command.format === 'html-source') {
    return command.scope.kind === 'selection'
      ? captureHtmlSource(reader, board, command.scope.objectIds)
      : { kind: 'rejected', reason: 'invalidSelection' };
  }

  const objects = reader.listObjects(command.boardId, maxSnapshotObjects + 1);
  if (objects.length > maxSnapshotObjects) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const geometry = new Map(objects.map((object) => [object.objectId, object]));
  const selected = command.rectangle
    ? selectExportRectangle(objects, geometry, command.rectangle)
    : selectExportObjects(objects, geometry, command.scope);

  if ('kind' in selected) {
    return selected;
  }
  if (selected.length > maxExportObjects) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const ids = selected.map(({ objectId }) => objectId);
  const rows = reader.getPayloads(command.boardId, ids);
  const payloadById = new Map(rows.map((row) => [row.objectId, row]));
  const payloads = ids.flatMap((id) => payloadById.get(id) ?? []);
  const assets = captureExportAssets(reader, command.boardId, payloads, command.format);
  if ('kind' in assets) {
    return assets;
  }

  return { board, objects: selected, geometry, payloads, assets };
}

export function executeBoardExport(
  repository: WhiteboardRepository,
  actor: Actor,
  command: ExportRenderCommand,
  requireAccess: AccessCheck,
  readBoard: (reader: WhiteboardReader) => BoardExportSnapshot['board'],
): ExportBoardResult {
  const snapshot = repository.read((reader) => {
    requireAccess(reader, actor, command.boardId);

    return captureSnapshot(reader, command, readBoard(reader));
  });

  if ('kind' in snapshot) {
    return snapshot;
  }

  const file = renderExportFile(snapshot, command);
  if (file.kind === 'file' || file.kind === 'browserPng') {
    repository.read((reader) => requireAccess(reader, actor, command.boardId));
  }

  return file;
}
