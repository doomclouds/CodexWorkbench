import type {
  BoardAccess,
  BoardChanges,
  BoardEditApplied,
  BoardExportAsset,
  BoardHeader,
  BoardObject,
  BoardVersionCommit,
  BoardVersionSummary,
  PayloadRecord,
  StoredBoardEditReceipt,
  StoredReceipt,
} from '../domain/index.js';

export type {
  Appearance,
  BoardAccess,
  BoardChanges,
  BoardEditApplied,
  BoardEditReceipt,
  BoardHeader,
  BoardObject,
  BoardVersionCommit,
  BoardVersionSummary,
  CommandReceipt,
  ConnectorDetail,
  ConnectorEndpoint,
  Geometry,
  GeometryDetail,
  JsonObject,
  MoveOutcome,
  PayloadRecord,
  Point,
  StoredReceipt,
  StoredBoardEditReceipt,
} from '../domain/index.js';

export type ExportAssetRead =
  | { readonly kind: 'asset'; readonly asset: BoardExportAsset }
  | { readonly kind: 'tooLarge' };

export interface WhiteboardReader {
  getAccess(boardId: string, actorId: string): BoardAccess | undefined;
  getBoard(boardId: string): BoardHeader | undefined;
  listObjects(boardId: string, limit?: number): readonly BoardObject[];
  getObjects(boardId: string, objectIds: readonly string[]): readonly BoardObject[];
  getPayloads(boardId: string, objectIds: readonly string[]): readonly PayloadRecord[];
  getExportAsset?(
    boardId: string,
    assetId: string,
    maximumBytes: number,
  ): ExportAssetRead | undefined;
  getReceipt(boardId: string, actorId: string, commandId: string): StoredReceipt | undefined;
}

export interface WhiteboardWriter extends WhiteboardReader {
  listGroupObjects(boardId: string, groupId: string): readonly BoardObject[];
  listChildObjects(boardId: string, parentId: string): readonly BoardObject[];
  listRelatedConnectors?(boardId: string, objectIds: readonly string[]): readonly BoardObject[];
  saveGeometry(boardId: string, objects: readonly BoardObject[]): void;
  advanceBoardRevision(boardId: string, commit?: BoardVersionCommit): bigint;
  saveReceipt(actorId: string, stored: StoredReceipt): void;
}

export interface WhiteboardRepository {
  read<T>(work: (reader: WhiteboardReader) => T): T;
  write<T>(work: (writer: WhiteboardWriter) => T): T;
}

export interface BoardEditReader extends WhiteboardReader {
  payloadByteSize?(boardId: string, objectIds: readonly string[], revision?: bigint): bigint;
  getEditReceipt(
    boardId: string,
    actorId: string,
    commandId: string,
  ): StoredBoardEditReceipt | undefined;
  listVersions(boardId: string, before?: bigint, limit?: number): readonly BoardVersionSummary[];
  getVersion(boardId: string, revision: bigint): BoardVersionSummary | undefined;
  listVersionObjects(
    boardId: string,
    revision: bigint,
    objectIds?: readonly string[],
  ): readonly BoardObject[];
  getVersionPayloads(
    boardId: string,
    revision: bigint,
    objectIds: readonly string[],
  ): readonly PayloadRecord[];
}

export interface BoardEditWriter extends WhiteboardWriter, BoardEditReader {
  hasUsedObjectId(boardId: string, objectId: string): boolean;
  listRelatedConnectors(boardId: string, objectIds: readonly string[]): readonly BoardObject[];
  applyBoardChanges(
    board: BoardHeader,
    changes: BoardChanges,
    commit: Omit<BoardVersionCommit, 'changedObjectCount'>,
  ): BoardEditApplied;
  saveEditReceipt(actorId: string, stored: StoredBoardEditReceipt): void;
}

export interface BoardEditRepository extends WhiteboardRepository {
  read<T>(work: (reader: BoardEditReader) => T): T;
  write<T>(work: (writer: BoardEditWriter) => T): T;
}
