import { act } from 'react';
import { expect, test } from 'vitest';
import { StudioApp, WhiteboardApp } from '../../src/app/index.js';
import type { BoardCatalogService } from '../../src/data/catalog/index.js';
import type { BoardRoomSession, BoardRoomState } from '../../src/data/rooms/index.js';
import type { WhiteboardService } from '../../src/data/whiteboard/index.js';
import { createControlFixture } from '../support/render-control.js';

const whiteboard: WhiteboardService = {
  getScene: async (boardId) => ({
    boardId,
    revision: 0n,
    title: '共享白板',
    objects: [],
    canEdit: true,
  }),
  getPayloads: async () => [],
  moveObjects: async () => {
    throw new Error('Unexpected whiteboard mutation');
  },
  getReceipt: async () => undefined,
};

const catalog: BoardCatalogService = {
  listBoards: async () => ({ boards: [] }),
  createBoard: async () => {
    throw new Error('Unexpected board creation');
  },
  getReceipt: async () => undefined,
};

function roomFactory() {
  const created: string[] = [];
  const opened: string[] = [];
  const closed: string[] = [];

  function createRoomSession(boardId: string): BoardRoomSession {
    created.push(boardId);
    const state: BoardRoomState = {
      status: 'online',
      viewId: 'view-' + created.length,
      actorId: 'board-owner',
      boardRevision: 0n,
      canEdit: true,
      participants: [],
    };

    return {
      open() {
        opened.push(boardId);
        return () => {
          closed.push(boardId);
        };
      },
      subscribe: () => () => undefined,
      getSnapshot: () => state,
      publishPresence: () => undefined,
      changeTimer: async () => {
        throw new Error('Unexpected timer mutation');
      },
      getTimerReceipt: async () => undefined,
      now: () => 0,
      schedule: () => () => undefined,
    };
  }

  return { created, opened, closed, createRoomSession };
}

test('creates and releases one room per mounted board and preserves the standalone fallback', async () => {
  const fixture = createControlFixture();
  const rooms = roomFactory();

  async function render(boardId?: string, withRoom = true) {
    await act(async () =>
      fixture.render(
        <WhiteboardApp
          boardId={boardId}
          service={whiteboard}
          createCommandId={() => 'command'}
          createRoomSession={withRoom ? rooms.createRoomSession : undefined}
        />,
      ),
    );
  }

  try {
    await render();
    expect(rooms.created).toEqual([]);
    await render('board-a');
    await render('board-a');
    expect(rooms.created).toEqual(['board-a']);
    expect(rooms.opened).toEqual(['board-a']);
    await render('board-b');
    expect(rooms.created).toEqual(['board-a', 'board-b']);
    expect(rooms.opened).toEqual(['board-a', 'board-b']);
    expect(rooms.closed).toEqual(['board-a']);
    await render();
    expect(rooms.closed).toEqual(['board-a', 'board-b']);
    await render('local-board', false);
    expect(rooms.created).toEqual(['board-a', 'board-b']);
    expect(fixture.host.querySelector('button[aria-label="计时器"]')).not.toBeNull();
  } finally {
    fixture.dispose();
  }
});

test('accepts a host theme event without persisting a preference or replacing the current room', async () => {
  const fixture = createControlFixture();
  const rooms = roomFactory();
  const stored: string[] = [];
  const announcedBoards: string[] = [];
  let subscribed: ((theme: 'light' | 'dark') => void) | undefined;
  let disposed = false;

  try {
    await act(async () =>
      fixture.render(
        <StudioApp
          catalog={catalog}
          service={whiteboard}
          navigation={{
            read: () => ({ kind: 'whiteboard', boardId: 'board-a' }),
            write: () => undefined,
            subscribe: () => () => undefined,
          }}
          preferences={{
            layout: 'list',
            resolvedTheme: 'light',
            rememberLayout: () => undefined,
            rememberTheme: (theme) => stored.push(theme),
            subscribeTheme(listener) {
              subscribed = listener;
              return () => {
                disposed = true;
              };
            },
          }}
          createCommandId={() => 'command'}
          createRoomSession={rooms.createRoomSession}
          onViewContext={(context) => {
            if (context) {
              announcedBoards.push(context.boardId);
            }
          }}
        />,
      ),
    );
    const shell = fixture.host.querySelector('.studio-whiteboard-app');
    expect(shell?.getAttribute('data-theme')).toBe('light');
    if (!subscribed) {
      throw new Error('Host theme subscriber was not installed.');
    }

    act(() => subscribed?.('dark'));
    expect(shell?.getAttribute('data-theme')).toBe('dark');
    expect(rooms.opened).toEqual(['board-a']);
    expect(rooms.closed).toEqual([]);
    expect(stored).toEqual([]);
    expect(announcedBoards).toContain('board-a');
  } finally {
    fixture.dispose();
  }

  expect(disposed).toBe(true);
});
