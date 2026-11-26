import {
  renderExportFile,
  selectExportObjects,
  type Actor,
  type BoardExportRejection,
  type BoardExportSnapshot,
  type BoardExportStale,
  type ExportBoardCommand,
  type ExportBoardResult,
} from '../domain/index.js';
import type { WhiteboardReader, WhiteboardRepository } from '../ports/index.js';
import { captureExportAssets } from './export-assets.js';

type AccessCheck = (reader: WhiteboardReader, actor: Actor, boardId: string) => void;
type CapturedExport = BoardExportSnapshot | BoardExportRejection | BoardExportStale;

const maxExportObjects = 10000;
const maxSnapshotObjects = 20000;
const richSvgKinds = new Set(['html', 'diagram', 'chart']);

function captureSnapshot(
  reader: WhiteboardReader,
  command: ExportBoardCommand,
  board: BoardExportSnapshot['board'],
): CapturedExport {
  if (board.revision !== command.expectedRevision) {
    return { kind: 'stale', revision: board.revision };
  }

  const objects = reader.listObjects(command.boardId, maxSnapshotObjects + 1);
  if (objects.length > maxSnapshotObjects) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }

  const geometry = new Map(objects.map((object) => [object.objectId, object]));
  const selected = selectExportObjects(objects, geometry, command.scope);
  if ('kind' in selected) {
    return selected;
  }
  if (selected.length > maxExportObjects) {
    return { kind: 'rejected', reason: 'tooLarge' };
  }
  if (command.format === 'svg' && selected.some(({ kind }) => richSvgKinds.has(kind))) {
    return { kind: 'rejected', reason: 'unsupported' };
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
  command: ExportBoardCommand,
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

  const file = renderExportFile(snapshot, command.format);
  if (file.kind === 'file') {
    repository.read((reader) => requireAccess(reader, actor, command.boardId));
  }

  return file;
}
