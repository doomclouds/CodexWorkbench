import type {
  BoardAccess,
  BoardHeader,
  BoardObject,
  PayloadRecord,
  StoredReceipt,
} from '../../src/modules/whiteboard/domain/index.js';
import type {
  WhiteboardReader,
  WhiteboardRepository,
  WhiteboardWriter,
} from '../../src/modules/whiteboard/ports/index.js';

export const boardId = 'unit-board';
export const editor = { id: 'editor' };
export const viewer = { id: 'viewer' };

export function object(objectId: string, overrides: Partial<BoardObject> = {}): BoardObject {
  return {
    objectId,
    kind: 'shape',
    label: objectId,
    geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 0 },
    geometryVersion: 1n,
    locked: false,
    ...overrides,
  };
}

export class TestWhiteboardRepository implements WhiteboardRepository, WhiteboardWriter {
  readonly objects = new Map<string, BoardObject>();
  readonly access = new Map<string, BoardAccess>([
    [editor.id, { canEdit: true }],
    [viewer.id, { canEdit: false }],
  ]);
  readonly payloadQueries: string[][] = [];
  readonly geometryWrites: string[][] = [];
  readonly objectQueries: string[][] = [];
  readonly receipts = new Map<string, StoredReceipt>();
  sceneReads = 0;
  revision = 10n;

  constructor(
    objects: readonly BoardObject[],
    private readonly payloads: readonly PayloadRecord[] = [],
  ) {
    for (const entry of objects) {
      this.objects.set(entry.objectId, entry);
    }
  }

  read<T>(work: (reader: WhiteboardReader) => T): T {
    return work(this);
  }

  write<T>(work: (writer: WhiteboardWriter) => T): T {
    return work(this);
  }

  getAccess(id: string, actorId: string): BoardAccess | undefined {
    return id === boardId ? this.access.get(actorId) : undefined;
  }

  getBoard(id: string): BoardHeader | undefined {
    return id === boardId ? { boardId, title: 'Unit board', revision: this.revision } : undefined;
  }

  listObjects(_boardId: string): readonly BoardObject[] {
    this.sceneReads += 1;

    return [...this.objects.values()];
  }

  getObjects(_boardId: string, objectIds: readonly string[]): readonly BoardObject[] {
    this.objectQueries.push([...objectIds]);

    return objectIds.flatMap((id) => this.objects.get(id) ?? []);
  }

  getPayloads(_boardId: string, objectIds: readonly string[]): readonly PayloadRecord[] {
    this.payloadQueries.push([...objectIds]);

    return this.payloads.filter(({ objectId }) => objectIds.includes(objectId));
  }

  getReceipt(_boardId: string, actorId: string, commandId: string): StoredReceipt | undefined {
    return this.receipts.get(JSON.stringify([actorId, commandId]));
  }

  listGroupObjects(_boardId: string, groupId: string): readonly BoardObject[] {
    return [...this.objects.values()].filter((entry) => entry.groupId === groupId);
  }

  listChildObjects(_boardId: string, parentId: string): readonly BoardObject[] {
    return [...this.objects.values()].filter((entry) => entry.parentId === parentId);
  }

  saveGeometry(_boardId: string, objects: readonly BoardObject[]) {
    this.geometryWrites.push(objects.map(({ objectId }) => objectId));
    for (const entry of objects) {
      this.objects.set(entry.objectId, entry);
    }
  }

  advanceBoardRevision(_boardId: string): bigint {
    this.revision += 1n;

    return this.revision;
  }

  saveReceipt(actorId: string, stored: StoredReceipt) {
    this.receipts.set(JSON.stringify([actorId, stored.receipt.commandId]), stored);
  }
}
