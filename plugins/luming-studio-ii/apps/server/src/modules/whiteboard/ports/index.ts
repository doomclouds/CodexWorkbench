import type {
  BoardAccess,
  BoardHeader,
  BoardObject,
  PayloadRecord,
  StoredReceipt,
} from '../domain/index.js';

export type {
  Appearance,
  BoardAccess,
  BoardHeader,
  BoardObject,
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
} from '../domain/index.js';

export interface WhiteboardReader {
  getAccess(boardId: string, actorId: string): BoardAccess | undefined;
  getBoard(boardId: string): BoardHeader | undefined;
  listObjects(boardId: string): readonly BoardObject[];
  getObjects(boardId: string, objectIds: readonly string[]): readonly BoardObject[];
  getPayloads(boardId: string, objectIds: readonly string[]): readonly PayloadRecord[];
  getReceipt(boardId: string, actorId: string, commandId: string): StoredReceipt | undefined;
}

export interface WhiteboardWriter extends WhiteboardReader {
  listGroupObjects(boardId: string, groupId: string): readonly BoardObject[];
  listChildObjects(boardId: string, parentId: string): readonly BoardObject[];
  saveGeometry(boardId: string, objects: readonly BoardObject[]): void;
  advanceBoardRevision(boardId: string): bigint;
  saveReceipt(actorId: string, stored: StoredReceipt): void;
}

export interface WhiteboardRepository {
  read<T>(work: (reader: WhiteboardReader) => T): T;
  write<T>(work: (writer: WhiteboardWriter) => T): T;
}
