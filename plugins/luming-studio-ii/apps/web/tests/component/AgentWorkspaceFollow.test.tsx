import { act } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  BoardRoomAgentWorkspace,
  BoardRoomSession,
  BoardRoomState,
} from '../../src/data/rooms/index.js';
import {
  RoomPresenceSurface,
  type RoomPresenceSurfaceProps,
} from '../../src/surfaces/room-presence/index.js';
import { createControlFixture } from '../support/render-control.js';

type Workspaces = readonly BoardRoomAgentWorkspace[];
type WorkspaceArea = BoardRoomAgentWorkspace['areas'][number];

const builder = 'builder';
const defaultViewport = { x: 0, y: 0, zoom: 0.5, width: 1200, height: 800 };
const label = '整理架构图';
const agentWorkspace: BoardRoomAgentWorkspace = {
  agentId: builder,
  taskId: 'diagram',
  generation: 'generation-a',
  label,
  phase: 'writing',
  areas: [],
  expiresAtUnixMs: 30_000,
};
const trigger = '此刻在这里';
const followLabel = '跟随 Agent：' + label;
const releaseLabel = '结束此工作区：' + label;

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => {
  fixture.dispose();
});

function area(id: string, x: number, y: number, width: number, height: number): WorkspaceArea {
  return { id, bounds: { x, y, width, height }, active: false };
}

function roomWithWorkspaces(
  agentWorkspaces: Workspaces,
  canReleaseAgentActivity = false,
  releaseAgentWorkspace?: BoardRoomSession['releaseAgentWorkspace'],
) {
  const listeners = new Set<() => void>();
  let state: BoardRoomState = {
    status: 'online',
    actorId: 'host',
    viewId: 'host-view',
    canEdit: true,
    participants: [],
    agentWorkspaces,
    canReleaseAgentActivity,
  };
  const session: BoardRoomSession = {
    open: () => () => undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    publishPresence: vi.fn<BoardRoomSession['publishPresence']>(),
    changeTimer: vi.fn<BoardRoomSession['changeTimer']>(),
    getTimerReceipt: vi.fn<BoardRoomSession['getTimerReceipt']>(),
    releaseAgentWorkspace,
    now: () => 1000,
    schedule: () => () => undefined,
  };
  const onViewportRequest = vi.fn<RoomPresenceSurfaceProps['onViewportRequest']>();

  function render(overrides: Partial<RoomPresenceSurfaceProps> = {}) {
    fixture.render(
      <RoomPresenceSurface
        session={session}
        viewport={defaultViewport}
        paused={false}
        detachSequence={0}
        onViewportRequest={onViewportRequest}
        render={({ participants, notice }) => (
          <>
            {participants}
            {notice}
          </>
        )}
        {...overrides}
      />,
    );
  }

  function update(workspaces: Workspaces) {
    act(() => {
      state = { ...state, agentWorkspaces: workspaces };
      listeners.forEach((listener) => listener());
    });
  }

  render();
  return { render, update, onViewportRequest };
}

function button(name: string) {
  const matches = Array.from(fixture.host.querySelectorAll('button'));
  const control = matches.find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === name,
  );

  if (!control) {
    throw new Error('Missing participant control ' + name);
  }

  return control;
}

function click(name: string) {
  act(() => {
    button(name).click();
  });
}

test('opens the participant menu with only an Agent present and fits the working range', () => {
  const workspace = { ...agentWorkspace, areas: [area('compact', 100, 200, 1500, 900)] };
  const room = roomWithWorkspaces([workspace]);
  expect(button(trigger).querySelector('.room-agent-avatar')).not.toBeNull();

  click(trigger);
  expect(fixture.host.textContent).toContain('修改中 · 整理架构图');
  expect(fixture.host.querySelector('[data-agent-task-release]')).toBeNull();

  click(followLabel);
  expect(room.onViewportRequest).toHaveBeenCalledOnce();
  const [camera] = room.onViewportRequest.mock.lastCall ?? [];
  expect(camera?.x).toBeCloseTo(-25.6);
  expect(camera?.y).toBeCloseTo(-78.4);
  expect(camera?.zoom).toBeCloseTo(0.736);
  expect(fixture.host.textContent).toContain('的工作区');
});

test('retains the current scale when entering an oversized Agent area and when already inside it', () => {
  const workspace = { ...agentWorkspace, areas: [area('wide', 4000, 2000, 16_000, 12_000)] };
  const room = roomWithWorkspaces([workspace]);
  click(trigger);
  click(followLabel);
  expect(room.onViewportRequest).toHaveBeenCalledExactlyOnceWith({
    x: -2000,
    y: -1000,
    zoom: 0.5,
  });

  room.update([{ ...workspace, phase: 'verifying' }]);
  expect(room.onViewportRequest).toHaveBeenCalledOnce();
  room.render({ detachSequence: 1 });
  expect(fixture.host.textContent).not.toContain('正在跟随');
});

test('focuses the active area on a second screen without jumping on a later snapshot', () => {
  const left = area('left', 0, 0, 200, 120);
  const right = area('right', 10_000, 0, 200, 120);
  const first = { ...agentWorkspace, areas: [left, right] };
  const room = roomWithWorkspaces([first]);
  click(trigger);
  click(followLabel);
  expect(room.onViewportRequest).toHaveBeenLastCalledWith({ x: 500, y: 340, zoom: 1 });

  room.update([{ ...first, areas: [left, { ...right, active: true }] }]);
  expect(room.onViewportRequest).toHaveBeenLastCalledWith({ x: -9500, y: 340, zoom: 1 });
  room.update([{ ...first, areas: [right, left] }]);
  expect(room.onViewportRequest).toHaveBeenCalledTimes(2);

  room.update([]);
  expect(fixture.host.textContent).not.toContain('正在跟随');
  expect(fixture.host.querySelector('.room-agent-avatar')).toBeNull();
});

test('groups two Agent workspaces and releases the matching lease from the owner menu', async () => {
  const first = { ...agentWorkspace, areas: [area('left', 0, 0, 200, 120)] };
  const second = {
    ...agentWorkspace,
    taskId: 'notes',
    generation: 'generation-b',
    label: '核对便签',
    phase: 'verifying' as const,
    areas: [area('right', 500, 0, 200, 120)],
  };
  const release = vi.fn<NonNullable<BoardRoomSession['releaseAgentWorkspace']>>();
  release.mockRejectedValueOnce(new Error('服务暂不可用'));
  release.mockResolvedValueOnce(undefined);
  const room = roomWithWorkspaces([first, second], true, release);
  click(trigger);
  expect(fixture.host.querySelectorAll('.room-agent-row')).toHaveLength(1);
  expect(fixture.host.textContent).toContain('2个工作区');
  expect(fixture.host.textContent).toContain('检查中 · 核对便签');

  await act(async () => click(releaseLabel));
  expect(fixture.host.querySelector('[role="alert"]')?.textContent).toContain('服务暂不可用');
  await act(async () => click(releaseLabel));
  expect(release).toHaveBeenLastCalledWith({
    agentId: builder,
    taskId: 'diagram',
    generation: 'generation-a',
  });
  expect(release).toHaveBeenCalledTimes(2);
  expect(fixture.host.querySelectorAll('[data-agent-task-release]')).toHaveLength(2);
  expect(button(releaseLabel).disabled).toBe(true);

  room.update([second]);
  expect(fixture.host.textContent).not.toContain(label);
  expect(fixture.host.querySelectorAll('[data-agent-task-release]')).toHaveLength(1);
});
