import { expect, test } from 'vitest';
import {
  createRoomsApplication,
  type RoomEvent,
} from '../../src/modules/rooms/application/index.js';
import type { RoomReader, RoomRepository } from '../../src/modules/rooms/ports/index.js';
import {
  createWhiteboardApplication,
  type BoardContentChange,
} from '../../src/modules/whiteboard/application/index.js';
import type { WhiteboardRepository } from '../../src/modules/whiteboard/ports/index.js';
import {
  boardId,
  editor,
  object,
  TestWhiteboardRepository,
  viewer,
} from './whiteboard-repository.js';

function room(initialRevision: bigint) {
  const reader: RoomReader = {
    access: () => ({
      role: 'owner',
      displayName: 'Owner',
      canEdit: true,
      boardRevision: initialRevision,
    }),
    timer: () => undefined,
    receipt: () => undefined,
  };
  const repository: RoomRepository = {
    read: (work) => work(reader),
    write: () => {
      throw new Error('A content change does not write room state');
    },
  };

  return createRoomsApplication(repository, { nowMillis: () => 100_000 }, 'room-instance');
}

test('publishes committed moves through the application and replays a failed publication safely', () => {
  const memory = new TestWhiteboardRepository([object('note')]);
  let writing = false;
  const repository: WhiteboardRepository = {
    read: (work) => memory.read(work),
    write(work) {
      writing = true;
      try {
        return memory.write(work);
      } finally {
        writing = false;
      }
    },
  };
  const rooms = room(memory.revision);
  const events: RoomEvent[] = [];
  rooms.subscribe(
    boardId,
    { actorId: editor.id, viewId: 'editor-view' },
    {
      deliver: (event) => {
        events.push(event);
      },
      close: () => undefined,
    },
  );
  const failure = new Error('Room publisher unavailable');
  const errors: unknown[] = [];
  const changes: { readonly change: BoardContentChange; readonly writing: boolean }[] = [];
  const application = createWhiteboardApplication(repository, undefined, {
    boardChanges: {
      publish(change) {
        changes.push({ change, writing });
        if (changes.length === 1) {
          throw failure;
        }

        rooms.publishContentChange({
          boardId: change.boardId,
          boardRevision: change.boardRevision,
          refreshScene: true,
        });
      },
      onError(error) {
        errors.push(error);
      },
    },
  });

  try {
    const command = {
      boardId,
      commandId: 'move-note',
      delta: { dx: 10, dy: 0 },
      targets: [{ objectId: 'note', expectedGeometryVersion: 1n }],
    };
    const first = application.moveObjects(editor, command);
    expect(first.outcome).toMatchObject({ kind: 'applied', boardRevision: 11n });
    expect(application.getCommandReceipt(editor, boardId, command.commandId)).toEqual(first);
    expect(events).toEqual([]);
    expect(errors).toEqual([failure]);

    expect(application.moveObjects(editor, command)).toEqual(first);
    expect(application.moveObjects(editor, command)).toEqual(first);
    expect(application.moveObjects(viewer, command).outcome).toMatchObject({ kind: 'rejected' });
    expect(memory.geometryWrites).toEqual([['note']]);
    expect(changes).toHaveLength(3);
    for (const notification of changes) {
      expect(notification).toMatchObject({
        writing: false,
        change: {
          kind: 'delta',
          boardId,
          boardRevision: 11n,
          changedObjects: [{ objectId: 'note', geometry: { x: 10 }, geometryVersion: 2n }],
          removedObjectIds: [],
        },
      });
    }

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({
      kind: 'contentChanged',
      change: { boardId, boardRevision: 11n, refreshScene: true },
    });
  } finally {
    rooms.close();
  }
});
