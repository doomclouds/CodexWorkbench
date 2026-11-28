import { act } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  BoardRoomContentChange,
  BoardRoomGesturePreview,
  BoardRoomObserver,
  BoardRoomParticipant,
  BoardRoomPresence,
  BoardRoomSession,
  BoardRoomState,
} from '../../src/data/rooms/index.js';
import {
  RoomPresenceSurface,
  type RoomPresenceSurfaceProps,
} from '../../src/surfaces/room-presence/index.js';
import { createControlFixture } from '../support/render-control.js';

const local = { x: -100, y: 0, zoom: 2, width: 800, height: 600 };
const peer: BoardRoomParticipant = {
  actorId: 'author',
  viewId: 'author-view',
  displayName: '作者',
  role: 'editor',
  sequence: 1n,
  expiresAtMillis: 1000,
  following: false,
  cursor: { x: 80, y: 40 },
  viewport: { centerX: 1000, centerY: 750, zoom: 0.5, width: 1600, height: 1200 },
};
const self: BoardRoomParticipant = {
  ...peer,
  actorId: 'local',
  viewId: 'local-view',
  displayName: '当前页面',
};
const initial: BoardRoomState = {
  status: 'online',
  actorId: self.actorId,
  viewId: self.viewId,
  canEdit: false,
  participants: [self, peer],
};

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => {
  fixture.dispose();
});

function mockRoom() {
  const listeners = new Set<() => void>();
  const close = vi.fn<() => void>();
  const publishPresence = vi.fn<(presence: BoardRoomPresence) => void>();
  let state = initial;
  let time = 0;
  const deadlines = new Map<() => void, number>();
  let observer: BoardRoomObserver | undefined;
  const session: BoardRoomSession = {
    open(next) {
      observer = next;
      return close;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    publishPresence,
    changeTimer: vi.fn<BoardRoomSession['changeTimer']>(),
    getTimerReceipt: vi.fn<BoardRoomSession['getTimerReceipt']>(),
    now: () => time,
    schedule(delay, callback) {
      deadlines.set(callback, time + delay);
      return () => deadlines.delete(callback);
    },
  };

  return {
    session,
    close,
    publishPresence,
    advance(elapsed: number) {
      act(() => {
        time += elapsed;
        const due = [...deadlines].filter(([, at]) => at <= time);
        for (const [callback] of due) {
          deadlines.delete(callback);
          callback();
        }
      });
    },
    update(patch: Partial<BoardRoomState>) {
      act(() => {
        state = { ...state, ...patch };
        listeners.forEach((listener) => listener());
      });
    },
    publishChange(change: BoardRoomContentChange) {
      observer?.onContentChanged?.(change);
    },
    revoke() {
      observer?.onAccessLost?.();
    },
  };
}

function button(label: string) {
  const control = Array.from(fixture.host.querySelectorAll('button')).find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === label,
  );

  if (!control) {
    throw new Error('Missing participant control ' + label);
  }

  return control;
}

function click(label: string) {
  act(() => {
    button(label).click();
  });
}

function startFollowing() {
  click('此刻在这里');
  click('跟随 作者');
}

function mount(room: ReturnType<typeof mockRoom>) {
  const onViewportRequest = vi.fn<RoomPresenceSurfaceProps['onViewportRequest']>();
  const onContentChanged = vi.fn<NonNullable<RoomPresenceSurfaceProps['onContentChanged']>>();
  const onAccessLost = vi.fn<NonNullable<RoomPresenceSurfaceProps['onAccessLost']>>();

  function render(overrides: Partial<RoomPresenceSurfaceProps> = {}) {
    fixture.render(
      <RoomPresenceSurface
        session={room.session}
        viewport={local}
        cursor={{ x: 24, y: 32 }}
        paused={false}
        detachSequence={0}
        onViewportRequest={onViewportRequest}
        onContentChanged={onContentChanged}
        onAccessLost={onAccessLost}
        render={(slot) => (
          <>
            {slot.participants}
            {slot.notice}
            {slot.overlay}
          </>
        )}
        {...overrides}
      />,
    );
  }

  render();
  return { render, onViewportRequest, onContentChanged, onAccessLost };
}

test('preserves both Agent avatars and colors in the header and roster while idle', () => {
  const room = mockRoom();
  mount(room);
  const first = 'agent-first';
  const second = 'agent-second';
  const work = {
    taskId: 'scope',
    generation: 'generation',
    label: '整理流程',
    phase: 'writing',
    areas: [],
    expiresAtUnixMs: 30_000,
  } as const;
  room.update({
    onlineAgentIds: [first, second],
    agentWorkspaces: [
      { ...work, agentId: first },
      { ...work, agentId: second },
    ],
  });
  const headerColors = () =>
    Array.from(
      fixture.host.querySelectorAll<HTMLElement>('.room-presence-avatar-stack .room-agent-avatar'),
      (avatar) => avatar.style.backgroundColor,
    );

  const colors = headerColors();
  expect(colors).toHaveLength(2);
  click('此刻在这里');
  room.update({ agentWorkspaces: [] });
  expect(headerColors()).toEqual(colors);
  expect(
    Array.from(fixture.host.querySelectorAll('.room-agent-identity')).filter((element) =>
      element.textContent?.includes('空闲'),
    ),
  ).toHaveLength(2);
  room.update({ readingAgentIds: [first] });
  expect(fixture.host.textContent).toContain('正在读取');
  room.update({ readingAgentIds: [] });
  expect(fixture.host.textContent).not.toContain('正在读取');

  room.update({ onlineAgentIds: [second] });
  expect(headerColors()).toEqual(colors.slice(1));
  room.update({ onlineAgentIds: [] });
  expect(headerColors()).toEqual([]);
});

test('publishes its own viewport, renders remote cursors and fits a larger remote view', () => {
  const room = mockRoom();
  const surface = mount(room);
  expect(button('此刻在这里').title).toBe('作者');
  const marker = fixture.host.querySelector<HTMLElement>('.room-presence-cursor');
  expect(marker?.style.left).toBe('60px');
  expect(marker?.style.top).toBe('80px');
  expect(fixture.host.querySelectorAll('.room-presence-cursor')).toHaveLength(1);
  expect(room.publishPresence).toHaveBeenLastCalledWith({
    viewport: { centerX: 250, centerY: 150, zoom: 2, width: 800, height: 600 },
    cursor: { x: 24, y: 32 },
    following: false,
  });

  startFollowing();

  expect(surface.onViewportRequest).toHaveBeenCalledExactlyOnceWith({
    x: 150,
    y: 112.5,
    zoom: 0.25,
  });
  expect(room.publishPresence).toHaveBeenLastCalledWith({
    viewport: undefined,
    cursor: { x: 24, y: 32 },
    following: true,
  });
  expect(fixture.host.textContent).toContain('正在跟随 作者 的视角');
  expect(fixture.host.querySelector('.room-presence-banner > svg')).not.toBeNull();

  room.update({ participants: [self, { ...peer, cursor: { x: 83, y: 40 } }] });
  expect(surface.onViewportRequest).toHaveBeenCalledOnce();
});

test('updates the remote pointer without rendering the whiteboard slot again', () => {
  const room = mockRoom();
  const surface = mount(room);
  const renderWorkspace = vi.fn<RoomPresenceSurfaceProps['render']>(({ overlay }) => overlay);
  surface.render({ render: renderWorkspace });
  const marker = () => fixture.host.querySelector<HTMLElement>('.room-presence-cursor');
  expect(marker()?.style.left).toBe('60px');
  renderWorkspace.mockClear();

  room.update({
    participants: [
      self,
      {
        ...peer,
        sequence: 2n,
        expiresAtMillis: 2000,
        cursor: { x: 95, y: 40 },
        viewport: peer.viewport && { ...peer.viewport },
      },
    ],
  });

  expect(renderWorkspace).not.toHaveBeenCalled();
  expect(marker()?.style.left).toBe('90px');
  expect(surface.onViewportRequest).not.toHaveBeenCalled();
});

test('publishes only current editing object IDs, including during focused document editing', () => {
  const room = mockRoom();
  room.update({ canEdit: true });
  const surface = mount(room);
  const current = () => room.publishPresence.mock.lastCall?.[0];

  surface.render({ editingObjectIds: ['editing-document'], paused: true });
  expect(current()?.editingObjectIds).toEqual(['editing-document']);
  expect(current()?.cursor).toBeUndefined();
  expect(current()?.viewport).toBeUndefined();

  surface.render({ editingObjectIds: [] });
  expect(current()?.editingObjectIds).toBeUndefined();

  surface.render({ editingObjectIds: ['editing-text'] });
  expect(current()?.editingObjectIds).toEqual(['editing-text']);
  room.update({ canEdit: false });
  expect(current()?.editingObjectIds).toBeUndefined();
});

test('shares gesture geometry across windows and expires unsaved previews without redrawing on cursor samples', () => {
  const room = mockRoom();
  const surface = mount(room);
  const renderWorkspace = vi.fn<RoomPresenceSurfaceProps['render']>(() => null);
  surface.render({ render: renderWorkspace });
  const gesture = {
    kind: 'move',
    changes: [
      {
        id: 'note',
        expectedVersion: 0,
        geometry: { x: 40, y: 50, width: 100, height: 100, rotation: 0 },
      },
    ],
  } as const satisfies BoardRoomGesturePreview;
  const own = { ...self, gesture, gestureExpiresAtMillis: 500 };
  const other = { ...own, viewId: 'other-window' };
  room.update({ participants: [own, other] });
  expect(renderWorkspace.mock.lastCall?.[0].remoteGesturePreviews).toEqual([gesture]);
  renderWorkspace.mockClear();

  room.update({
    participants: [own, { ...other, cursor: { x: 90, y: 10 }, gestureExpiresAtMillis: 600 }],
  });
  expect(renderWorkspace).not.toHaveBeenCalled();
  room.advance(500);
  expect(renderWorkspace).not.toHaveBeenCalled();
  room.advance(100);
  expect(renderWorkspace.mock.lastCall?.[0].remoteGesturePreviews).toEqual([]);
});

test('groups all windows by actor and transfers the followed view when its first window closes', () => {
  const room = mockRoom();
  const surface = mount(room);
  const ownSecondWindow = { ...self, viewId: 'local-second-window' };
  const inactiveWindow = { ...peer, viewId: 'author-idle', viewport: undefined, cursor: undefined };
  const alternateWindow = {
    ...peer,
    viewId: 'author-other-window',
    expiresAtMillis: 2000,
    cursor: { x: 95, y: 40 },
    viewport: { centerX: 1200, centerY: 850, zoom: 0.5, width: 1600, height: 1200 },
  };
  room.update({ participants: [self, ownSecondWindow, inactiveWindow, peer, alternateWindow] });

  const trigger = button('此刻在这里');
  expect(trigger.title).toBe('作者');
  expect(trigger.querySelectorAll('.room-presence-avatar')).toHaveLength(1);
  const cursors = fixture.host.querySelectorAll<HTMLElement>('.room-presence-cursor');
  expect(cursors).toHaveLength(1);
  expect(cursors[0]?.style.left).toBe('90px');
  click('此刻在这里');
  expect(fixture.host.querySelectorAll('.room-presence-row')).toHaveLength(1);
  expect(fixture.host.textContent).toContain('在画布上 · 可编辑');
  click('跟随 作者');
  expect(surface.onViewportRequest).toHaveBeenCalledExactlyOnceWith({
    x: 150,
    y: 112.5,
    zoom: 0.25,
  });

  room.update({ participants: [self, ownSecondWindow, inactiveWindow, alternateWindow] });
  expect(surface.onViewportRequest).toHaveBeenLastCalledWith({ x: 100, y: 87.5, zoom: 0.25 });
  expect(surface.onViewportRequest).toHaveBeenCalledTimes(2);
  expect(fixture.host.textContent).toContain('正在跟随 作者 的视角');
});

test.each(['editor', 'commenter', 'viewer'])(
  'uses the owner nickname and excludes the current %s guest from the participant control',
  (role) => {
    const room = mockRoom();
    const visitor = { ...self, actorId: 'visitor-id', displayName: '访客昵称', role };
    const owner = { ...peer, actorId: 'private-owner-id', displayName: '陆工', role: 'owner' };
    room.update({
      actorId: visitor.actorId,
      participants: [visitor, owner, { ...visitor, viewId: 'another-guest-tab' }],
    });
    mount(room);
    const trigger = button('此刻在这里');
    expect(trigger.title).toBe(owner.displayName);
    expect(trigger.textContent).toBe('陆');
    click('此刻在这里');
    const rows = fixture.host.querySelectorAll('.room-presence-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.querySelector('strong')?.textContent).toBe(owner.displayName);
    expect(rows[0]?.textContent).toContain('所有者');
  },
);

test('opens the anchored participant menu with focus and restores the trigger on Escape', () => {
  mount(mockRoom());
  const trigger = button('此刻在这里');
  click('此刻在这里');
  const panel = fixture.host.querySelector<HTMLElement>('[role="dialog"][aria-label="此刻在这里"]');
  expect(panel?.style.getPropertyValue('--studio-ui-anchor-offset')).toBeTruthy();
  expect(document.activeElement).toBe(panel?.querySelector('.room-presence-members'));
  expect(button('关闭此刻在这里')).toBeDefined();

  act(() => {
    panel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
});

test('follows the most recently active window without waiting for the previous one to leave', () => {
  const room = mockRoom();
  const surface = mount(room);
  startFollowing();
  const other = {
    ...peer,
    viewId: 'author-current-window',
    activityAtMillis: 200,
    viewport: { centerX: 1200, centerY: 850, zoom: 0.5, width: 1600, height: 1200 },
  };
  room.update({ participants: [self, { ...peer, activityAtMillis: 100 }, other] });
  expect(surface.onViewportRequest).toHaveBeenLastCalledWith({ x: 100, y: 87.5, zoom: 0.25 });
});

test('pauses following in preview, resumes the same view, and detaches on local navigation', () => {
  const room = mockRoom();
  const surface = mount(room);
  startFollowing();
  surface.render({ paused: true });
  room.update({
    participants: [
      self,
      { ...peer, viewport: { centerX: 1200, centerY: 850, zoom: 0.5, width: 1600, height: 1200 } },
    ],
  });
  expect(fixture.host.textContent).toContain('已暂停跟随 作者');
  expect(fixture.host.querySelector('.room-presence-cursor')).toBeNull();
  expect(surface.onViewportRequest).toHaveBeenCalledOnce();
  expect(room.publishPresence).toHaveBeenLastCalledWith({
    viewport: undefined,
    cursor: undefined,
    following: true,
  });

  surface.render();
  expect(surface.onViewportRequest).toHaveBeenLastCalledWith({ x: 100, y: 87.5, zoom: 0.25 });
  surface.render({ detachSequence: 1 });
  expect(fixture.host.textContent).not.toContain('正在跟随');
  expect(room.publishPresence).toHaveBeenLastCalledWith(
    expect.objectContaining({ following: false, viewport: expect.any(Object) }),
  );
  room.update({ participants: [peer] });
  expect(surface.onViewportRequest).toHaveBeenCalledTimes(2);
});

test('retains the chosen actor while reconnecting without adopting a different participant', () => {
  const room = mockRoom();
  const surface = mount(room);
  startFollowing();
  room.update({ status: 'reconnecting', participants: [] });
  expect(fixture.host.textContent).toContain('正在重新连接白板 · 暂停跟随 作者');
  expect(surface.onViewportRequest).toHaveBeenCalledOnce();

  room.update({ status: 'online', participants: [self, peer] });
  expect(surface.onViewportRequest).toHaveBeenCalledTimes(2);
  room.update({ status: 'reconnecting', participants: [] });
  room.update({ status: 'online', participants: [self, { ...peer, actorId: 'different-actor' }] });
  expect(fixture.host.textContent).not.toContain('正在跟随');
  expect(surface.onViewportRequest).toHaveBeenCalledTimes(2);
});

test('shows no avatar while a solo view reconnects and restores actual collaborators', () => {
  const room = mockRoom();
  room.update({ participants: [self] });
  mount(room);
  const trigger = () => fixture.host.querySelector('[aria-label="此刻在这里"]');
  expect(trigger()).toBeNull();

  room.update({ status: 'reconnecting', participants: [] });
  expect(trigger()).toBeNull();

  const previousView = { ...self, viewId: 'previous-local-view' };
  room.update({
    status: 'online',
    participants: [self, previousView, peer],
    onlineAgentIds: ['agent-one'],
  });
  expect(button('此刻在这里').title).toBe('Agent、作者');
});

test('keeps one edit outline per remote person and object inside the active viewport', () => {
  const room = mockRoom();
  const geometry = { x: 90, y: 45, width: 80, height: 50, rotation: 30 };
  const objectGeometry = new Map([
    ['editing-shape', geometry],
    ['offscreen', { ...geometry, x: 1000 }],
    ['self-shape', geometry],
  ]);
  const surface = mount(room);
  surface.render({ objectGeometry });
  const targets = () => fixture.host.querySelectorAll<HTMLElement>('[data-peer-state="editing"]');
  expect(targets()).toHaveLength(0);

  const remote = { ...peer, editingObjectIds: ['editing-shape', 'offscreen', 'missing'] };
  const writers = [
    { ...self, editingObjectIds: ['self-shape'] },
    remote,
    { ...remote, viewId: 'duplicate-author-view' },
  ];
  room.update({ participants: writers });
  expect(targets()).toHaveLength(1);
  const target = targets()[0];
  expect(target?.dataset.peerTarget).toBe('editing-shape');
  expect(target?.getAttribute('aria-label')).toBe('作者 · 正在编辑');
  expect(target?.style.left).toBe('80px');
  expect(target?.style.top).toBe('90px');
  expect(target?.style.width).toBe('160px');
  const outline = target?.querySelector<HTMLElement>('.room-peer-editing__outline');
  const cursorLabel = fixture.host.querySelector<HTMLElement>('.room-presence-cursor > span');
  expect(outline?.style.transform).toBe('rotate(30deg)');
  expect(outline?.style.borderColor).toBe(cursorLabel?.style.backgroundColor);

  surface.render({ objectGeometry, paused: true });
  expect(targets()).toHaveLength(0);
  surface.render({ objectGeometry });
  expect(targets()).toHaveLength(1);
  room.update({ status: 'reconnecting' });
  expect(targets()).toHaveLength(0);
  room.update({ status: 'online', participants: [self, peer] });
  expect(targets()).toHaveLength(0);
});

test('stops follow loops and forwards content changes and access-loss signals through the session', () => {
  const room = mockRoom();
  const surface = mount(room);
  startFollowing();
  room.update({ participants: [self, { ...peer, following: true }] });
  expect(fixture.host.textContent).not.toContain('正在跟随 作者');
  click('此刻在这里');
  expect(button('跟随 作者').disabled).toBe(true);

  const changed = {
    revision: 3n,
    changedObjectIds: ['shape'],
    removedObjectIds: [],
    refreshScene: false,
  };
  room.publishChange(changed);
  room.update({ status: 'accessLost' });
  room.revoke();
  expect(surface.onContentChanged).toHaveBeenCalledExactlyOnceWith(changed);
  expect(surface.onAccessLost).toHaveBeenCalledOnce();
  expect(fixture.host.textContent).toContain('白板访问已撤销');
  expect(fixture.host.querySelector('.room-presence-trigger')).toBeNull();
  expect(fixture.host.querySelector('.room-presence-cursor')).toBeNull();
  expect(surface.onViewportRequest).toHaveBeenCalledOnce();

  fixture.dispose();
  fixture = createControlFixture();
  expect(room.close).toHaveBeenCalledOnce();
});
