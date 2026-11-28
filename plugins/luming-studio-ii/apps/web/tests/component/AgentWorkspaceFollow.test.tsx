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
  scheduleFrame?: BoardRoomSession['scheduleFrame'],
) {
  const listeners = new Set<() => void>();
  const timers = new Map<() => void, number>();
  let now = 1000;
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
    scheduleFrame,
    now: () => now,
    schedule(delay, run) {
      timers.set(run, now + delay);

      return () => timers.delete(run);
    },
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
        render={({ participants, notice, overlay }) => (
          <>
            {participants}
            {notice}
            {overlay}
          </>
        )}
        {...overrides}
      />,
    );
  }

  function update(workspaces: Workspaces, status = state.status) {
    act(() => {
      state = { ...state, agentWorkspaces: workspaces, status };
      listeners.forEach((listener) => listener());
    });
  }

  function advance(elapsed: number) {
    act(() => {
      now += elapsed;
      const due = [...timers].filter(([, at]) => at <= now);
      for (const [run] of due) {
        timers.delete(run);
        run();
      }
    });
  }

  render();
  return { render, update, advance, onViewportRequest };
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

test('reframes a moved object from the live board geometry and stops if it is removed', () => {
  const target = area('target', 0, 0, 200, 120);
  const workspace = { ...agentWorkspace, areas: [target] };
  const room = roomWithWorkspaces([workspace]);
  room.render({ objectGeometry: new Map([['target', { ...target.bounds, rotation: 0 }]]) });
  expect(room.onViewportRequest).not.toHaveBeenCalled();
  click(trigger);
  click(followLabel);
  expect(room.onViewportRequest).toHaveBeenLastCalledWith({ x: 500, y: 340, zoom: 1 });

  const moved = { ...target.bounds, x: 10_000, y: 100, rotation: 0 };
  room.render({ objectGeometry: new Map([['target', moved]]) });
  expect(room.onViewportRequest).toHaveBeenLastCalledWith({ x: -9500, y: 240, zoom: 1 });
  expect(
    fixture.host.querySelector<HTMLElement>('[data-agent-workspace-area="target"]'),
  ).toBeNull();

  room.render({ objectGeometry: new Map() });
  expect(fixture.host.textContent).not.toContain('正在跟随');
  expect(room.onViewportRequest).toHaveBeenCalledTimes(2);
});

test('requires an explicit new follow after disconnection even when the same Agent returns', () => {
  const workspace = { ...agentWorkspace, areas: [area('target', 0, 0, 200, 120)] };
  const room = roomWithWorkspaces([workspace]);
  click(trigger);
  click(followLabel);
  const next = {
    ...workspace,
    generation: 'generation-b',
    areas: [area('next', 5000, 0, 200, 120)],
  };
  room.update([], 'reconnecting');
  room.update([next], 'online');
  expect(fixture.host.textContent).not.toContain('正在跟随');
  expect(room.onViewportRequest).toHaveBeenCalledOnce();

  click(trigger);
  click(followLabel);
  expect(room.onViewportRequest).toHaveBeenLastCalledWith({ x: -4500, y: 340, zoom: 1 });
});

test('fits narrow windows and changes cameras only after explicitly choosing another Agent', () => {
  const left = { ...agentWorkspace, areas: [area('left', 0, 0, 500, 220)] };
  const right = {
    ...agentWorkspace,
    agentId: 'second-agent',
    label: '审查配置',
    areas: [area('right', 1000, 0, 500, 220)],
  };
  const room = roomWithWorkspaces([left, right]);
  room.render({ viewport: { ...defaultViewport, width: 340, height: 540 } });
  expect(room.onViewportRequest).not.toHaveBeenCalled();
  click(trigger);
  click(followLabel);
  expect(room.onViewportRequest).toHaveBeenLastCalledWith({ x: 48, y: 216.32, zoom: 0.488 });

  room.update([left, { ...right, areas: [area('right', 1200, 0, 500, 220)] }]);
  expect(room.onViewportRequest).toHaveBeenCalledOnce();
  click(trigger);
  click('跟随 Agent：审查配置');
  expect(room.onViewportRequest).toHaveBeenLastCalledWith({
    x: -537.6,
    y: 216.32,
    zoom: 0.488,
  });
});

test('yields the camera while locally editing and discards the selection on a board change', () => {
  const workspace = { ...agentWorkspace, areas: [area('target', 0, 0, 200, 120)] };
  const room = roomWithWorkspaces([workspace]);
  click(trigger);
  click(followLabel);
  room.render({ editingObjectIds: ['local-text'] });
  room.update([{ ...workspace, areas: [area('target', 2000, 0, 200, 120)] }]);
  expect(room.onViewportRequest).toHaveBeenCalledOnce();
  room.render();
  expect(room.onViewportRequest).toHaveBeenLastCalledWith({ x: -1500, y: 340, zoom: 1 });

  const next = roomWithWorkspaces([workspace]);
  expect(next.onViewportRequest).not.toHaveBeenCalled();
  expect(fixture.host.textContent).not.toContain('正在跟随');
});

test('eases the Agent camera in motion and cancels it on mouse or zoom detachment', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;
  const scheduleFrame = (frame: FrameRequestCallback) => {
    const id = ++nextId;
    frames.set(id, frame);

    return () => {
      frames.delete(id);
    };
  };
  const room = roomWithWorkspaces(
    [{ ...agentWorkspace, areas: [area('target', 0, 0, 200, 120)] }],
    false,
    undefined,
    scheduleFrame,
  );
  click(trigger);
  click(followLabel);
  expect(room.onViewportRequest).not.toHaveBeenCalled();

  function step(id: number, time: number) {
    const frame = frames.get(id);
    frames.delete(id);
    act(() => frame?.(time));
  }

  step(1, 0);
  step(2, 45);
  expect(room.onViewportRequest).toHaveBeenCalledExactlyOnceWith({ x: 250, y: 170, zoom: 0.75 });
  expect(frames.size).toBe(1);
  room.render({ detachSequence: 1 });
  expect(frames.size).toBe(0);
  expect(room.onViewportRequest).toHaveBeenCalledOnce();
  expect(fixture.host.textContent).not.toContain('正在跟随');
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
  const memberReleases = () =>
    fixture.host.querySelectorAll('.room-agent-workspace [data-agent-task-release]');
  expect(memberReleases()).toHaveLength(2);
  expect(button(releaseLabel).disabled).toBe(true);

  room.update([second]);
  expect(fixture.host.textContent).not.toContain(label);
  expect(memberReleases()).toHaveLength(1);
});

test('ends the workspace from its canvas label and restores canvas focus when the button disappears', async () => {
  const workspace = { ...agentWorkspace, areas: [area('left', 50, 100, 200, 120)] };
  const release = vi.fn<NonNullable<BoardRoomSession['releaseAgentWorkspace']>>();
  release.mockRejectedValueOnce(new Error('服务暂不可用'));
  release.mockResolvedValueOnce(undefined);
  const room = roomWithWorkspaces([workspace], true, release);
  fixture.host.tabIndex = 0;
  const focusCanvas = vi.fn(() => fixture.host.focus());
  room.render({ onCanvasFocus: focusCanvas });

  const overlayRelease = fixture.host.querySelector<HTMLButtonElement>(
    '.room-agent-workspace-label [data-agent-task-release]',
  );
  expect(overlayRelease?.hasAttribute('data-canvas-native')).toBe(true);
  overlayRelease?.focus();
  await act(async () => overlayRelease?.click());
  expect(fixture.host.querySelector('[role="alert"]')?.textContent).toContain('服务暂不可用');
  expect(fixture.host.ownerDocument.activeElement).toBe(overlayRelease);
  expect(focusCanvas).not.toHaveBeenCalled();

  await act(async () => overlayRelease?.click());
  expect(release).toHaveBeenLastCalledWith({
    agentId: builder,
    taskId: 'diagram',
    generation: 'generation-a',
  });
  room.update([{ ...workspace, endReason: 'released', endedAtUnixMs: 1000 }]);
  expect(overlayRelease?.isConnected).toBe(false);
  expect(focusCanvas).toHaveBeenCalledOnce();
  expect(fixture.host.ownerDocument.activeElement).toBe(fixture.host);
});

test('outlines visible workspace areas at their canvas coordinates with one task label', () => {
  const workspace = {
    ...agentWorkspace,
    areas: [
      { ...area('current', 80, 120, 460, 300), active: true },
      area('second', 600, 200, 180, 140),
      area('outside', 5000, 0, 100, 100),
    ],
  };
  const room = roomWithWorkspaces([workspace]);
  const overlay = () => fixture.host.querySelector('[data-agent-task="diagram"]');
  const current = overlay()?.querySelector<HTMLElement>('[data-agent-workspace-area="current"]');
  expect(current?.style).toMatchObject({
    left: '40px',
    top: '60px',
    width: '230px',
    height: '150px',
  });
  expect(current?.hasAttribute('data-active-area')).toBe(true);
  expect(overlay()?.querySelectorAll('[data-agent-workspace-area]')).toHaveLength(2);
  expect(overlay()?.querySelectorAll('[role="status"]')).toHaveLength(1);
  room.render({ paused: true });
  expect(overlay()).toBeNull();
});

test('updates stalled and terminal states without following or offering release of an ended lease', () => {
  const left = area('left', 50, 100, 200, 120);
  const workspace = {
    ...agentWorkspace,
    phase: 'preparing' as const,
    lastProgressAtUnixMs: 1000,
    expiresAtUnixMs: 601_000,
    areas: [left],
  };
  const release = vi.fn<NonNullable<BoardRoomSession['releaseAgentWorkspace']>>();
  const room = roomWithWorkspaces([workspace], true, release);
  const overlay = () => fixture.host.querySelector('[data-agent-task="diagram"]');
  const outline = () => overlay()?.querySelector('[data-agent-workspace-area="left"]');
  const mark = () => overlay()?.querySelector('.room-agent-working-mark');
  expect(overlay()?.textContent).toContain('准备中');
  expect(outline()?.hasAttribute('data-active-area')).toBe(false);
  expect(mark()?.getAttribute('data-agent-motion')).toBe('running');
  expect(mark()?.querySelector('.lucide-bot')).not.toBeNull();
  click(trigger);
  click(followLabel);

  const writing = { ...workspace, phase: 'writing' as const, areas: [{ ...left, active: true }] };
  room.update([writing]);
  expect(overlay()?.textContent).toContain('修改中');
  expect(outline()?.hasAttribute('data-active-area')).toBe(true);
  expect(mark()?.getAttribute('data-agent-motion')).toBe('running');

  room.advance(120_000);
  expect(overlay()?.getAttribute('data-agent-state')).toBe('stale');
  expect(overlay()?.textContent).toContain('暂未收到新进度 · 修改中');
  expect(outline()?.hasAttribute('data-active-area')).toBe(false);
  expect(mark()?.getAttribute('data-agent-motion')).toBe('paused');
  expect(button(trigger).querySelector('.room-agent-avatar')).not.toBeNull();

  const progressed = { ...workspace, phase: 'verifying' as const, lastProgressAtUnixMs: 121_000 };
  room.update([progressed]);
  expect(overlay()?.textContent).toContain('检查中');
  expect(overlay()?.textContent).not.toContain('暂未收到新进度');
  expect(outline()?.hasAttribute('data-active-area')).toBe(false);
  expect(mark()?.getAttribute('data-agent-motion')).toBe('running');
  room.update([{ ...progressed, endedAtUnixMs: 121_000, endReason: 'completed' }]);
  expect(overlay()?.textContent).toContain('已完成 · ' + label);
  expect(mark()?.getAttribute('data-agent-motion')).toBe('paused');
  expect(fixture.host.textContent).not.toContain('正在跟随');
  click(trigger);
  expect(button(followLabel).disabled).toBe(true);
  expect(fixture.host.querySelector('[data-agent-task-release]')).toBeNull();
  room.advance(499);
  expect(overlay()).not.toBeNull();
  room.advance(1);
  expect(overlay()).toBeNull();
});

test('fades a finished workspace independently of another Agent and handles expiry', () => {
  const working = { ...agentWorkspace, areas: [area('left', 50, 100, 200, 120)] };
  const reviewer = {
    ...agentWorkspace,
    agentId: 'reviewer',
    taskId: 'review',
    areas: [area('right', 600, 100, 200, 120)],
    expiresAtUnixMs: 2000,
  };
  const room = roomWithWorkspaces([working, reviewer]);
  const review = () => fixture.host.querySelector('[data-agent-task="review"]');
  const mark = () => review()?.querySelector('[data-agent-motion]');
  const ended = { ...working, endReason: 'released' as const, endedAtUnixMs: 1000 };
  room.update([ended, reviewer]);
  expect(mark()?.getAttribute('data-agent-motion')).toBe('running');

  room.advance(500);
  expect(fixture.host.querySelector('[data-agent-task="diagram"]')).toBeNull();
  expect(mark()?.getAttribute('data-agent-motion')).toBe('running');

  room.advance(500);
  expect(review()?.textContent).toContain('工作区已过期');
  expect(mark()?.getAttribute('data-agent-motion')).toBe('paused');
  room.advance(500);
  expect(review()).toBeNull();
});
