import { act } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  BoardRoomSession,
  BoardRoomState,
  BoardRoomTimer,
  BoardRoomTimerReceipt,
} from '../../src/data/rooms/index.js';
import { SharedTimerSurface } from '../../src/surfaces/shared-timer/index.js';
import { createControlFixture } from '../support/render-control.js';

const serverTime = 1_786_000_000_000;
const idleTimer: BoardRoomTimer = {
  version: 0n,
  phase: 'idle',
  durationMs: 300_000,
  remainingMs: 300_000,
};

let fixture: ReturnType<typeof createControlFixture>;

beforeEach(() => {
  fixture = createControlFixture();
});

afterEach(() => {
  fixture.dispose();
});

function mockTimer(initial: Partial<BoardRoomState> = {}) {
  const listeners = new Set<() => void>();
  let snapshot: BoardRoomState = {
    status: 'online',
    viewId: 'view-a',
    canEdit: true,
    participants: [],
    timer: idleTimer,
    ...initial,
  };
  let now = serverTime;
  const tasks = new Map<() => void, number>();

  function update(change: Partial<BoardRoomState>) {
    snapshot = { ...snapshot, ...change };
    listeners.forEach((listener) => listener());
  }

  function advance(delayMs: number) {
    now += delayMs;
    for (const [task, due] of [...tasks]) {
      if (due <= now) {
        tasks.delete(task);
        task();
      }
    }
  }

  function schedule(delayMs: number, task: () => void) {
    tasks.set(task, now + delayMs);

    return () => {
      tasks.delete(task);
    };
  }

  const changeTimer = vi.fn<BoardRoomSession['changeTimer']>();
  const getTimerReceipt = vi.fn<BoardRoomSession['getTimerReceipt']>();
  let serial = 0;
  const createCommandId = vi.fn(() => 'timer-op-' + ++serial);
  const session: BoardRoomSession = {
    open: () => () => undefined,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    publishPresence: () => undefined,
    changeTimer,
    getTimerReceipt,
    now: () => now,
    schedule,
  };
  fixture.render(<SharedTimerSurface session={session} createCommandId={createCommandId} />);

  return { update, advance, changeTimer, getTimerReceipt, createCommandId, tasks };
}

function findButton(label: string) {
  return [...fixture.host.querySelectorAll('button')].find(
    (button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === label,
  );
}

async function press(label: string) {
  const button = findButton(label);
  if (!button) {
    throw new Error('Timer test could not find ' + label);
  }

  await act(async () => button.click());
}

function durationField(name: string) {
  const input = fixture.host.querySelector<HTMLInputElement>('input[aria-label="' + name + '"]');
  if (!input) {
    throw new Error('Timer duration field is missing');
  }

  return input;
}

function pasteDuration(value: string) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => value } });
  act(() => {
    durationField('计时分钟').dispatchEvent(event);
  });
}

function output() {
  return fixture.host.querySelector('output[aria-label="剩余时间"]')?.textContent;
}

test('displays an authoritative running deadline and the ended grace period to a viewer', () => {
  const timer: BoardRoomTimer = {
    ...idleTimer,
    version: 3n,
    phase: 'running',
    deadlineUnixMs: serverTime + 3201,
    remainingMs: 4300,
  };
  const room = mockTimer({ canEdit: false, timer });
  expect(output()).toBe('00:04');
  expect(findButton('暂停')).toBeUndefined();
  act(() => room.advance(1200));
  expect(output()).toBe('00:03');
  act(() => room.advance(2100));
  expect(output()).toBe('00:00');
  expect(fixture.host.querySelector('[aria-label="计时状态"]')?.textContent).toBe('已结束');
  act(() => room.advance(2400));
  expect(output()).toBe('05:00');
  expect(room.tasks.size).toBe(0);
  expect(room.changeTimer).not.toHaveBeenCalled();
});

test('keeps the local duration draft while authorization temporarily becomes read-only', async () => {
  const room = mockTimer();
  await press('共享计时器');
  pasteDuration('１２：０９');
  expect(durationField('计时分钟').value).toBe('12');
  expect(durationField('计时秒数').value).toBe('09');
  act(() => room.update({ canEdit: false }));
  expect(fixture.host.querySelector('[aria-label="计时时长"]')).toBeNull();
  expect(output()).toBe('05:00');
  expect(findButton('开始')).toBeUndefined();
  act(() => room.update({ canEdit: true }));
  expect(durationField('计时分钟').value).toBe('12');
  expect(durationField('计时秒数').value).toBe('09');
  expect(room.changeTimer).not.toHaveBeenCalled();
});

test('commits a typed duration then starts at the confirmed state version', async () => {
  const room = mockTimer();
  const configured = { ...idleTimer, version: 1n, durationMs: 81_000, remainingMs: 81_000 };
  const running: BoardRoomTimer = {
    ...configured,
    version: 2n,
    phase: 'running',
    deadlineUnixMs: serverTime + configured.durationMs,
  };
  room.changeTimer.mockImplementationOnce(async ({ commandId }) => {
    room.update({ timer: configured });
    return { kind: 'applied', commandId, timer: configured };
  });
  room.changeTimer.mockImplementationOnce(async ({ commandId }) => {
    room.update({ timer: running });
    return { kind: 'applied', commandId, timer: running };
  });
  await press('共享计时器');
  pasteDuration('01:21');
  await press('开始');

  expect(room.changeTimer.mock.calls.map(([command]) => command)).toEqual([
    {
      commandId: 'timer-op-1',
      expectedVersion: 0n,
      action: { kind: 'setDuration', durationMs: 81_000 },
    },
    { commandId: 'timer-op-2', expectedVersion: 1n, action: { kind: 'start' } },
  ]);
  expect(output()).toBe('01:21');
  expect(findButton('暂停')).toBeDefined();
});

test('pauses, resumes and resets using the latest room versions', async () => {
  const timer: BoardRoomTimer = {
    ...idleTimer,
    version: 3n,
    phase: 'running',
    deadlineUnixMs: serverTime + 75_000,
    remainingMs: 75_000,
  };
  const paused: BoardRoomTimer = {
    ...idleTimer,
    version: 4n,
    phase: 'paused',
    remainingMs: 75_000,
  };
  const resumed: BoardRoomTimer = { ...timer, version: 5n };
  const room = mockTimer({ timer });
  for (const next of [paused, resumed, { ...paused, version: 6n }, { ...idleTimer, version: 7n }]) {
    room.changeTimer.mockImplementationOnce(async ({ commandId }) => {
      room.update({ timer: next });
      return { kind: 'applied', commandId, timer: next };
    });
  }
  await press('暂停');
  await press('继续');
  await press('暂停');
  await press('重置');

  expect(
    room.changeTimer.mock.calls.map(([command]) => [command.expectedVersion, command.action]),
  ).toEqual([
    [3n, { kind: 'pause' }],
    [4n, { kind: 'resume' }],
    [5n, { kind: 'pause' }],
    [6n, { kind: 'reset' }],
  ]);
  expect(durationField('计时分钟').value).toBe('05');
});

test('retains the original command across closing and reconnecting, then retries it after lookup', async () => {
  const room = mockTimer();
  room.changeTimer.mockRejectedValueOnce(new Error('写入连接中断'));
  room.getTimerReceipt.mockRejectedValueOnce(new Error('回执连接中断'));
  room.getTimerReceipt.mockResolvedValueOnce(undefined);
  room.changeTimer.mockResolvedValueOnce({
    commandId: 'timer-op-1',
    kind: 'applied',
    timer: { ...idleTimer, version: 1n },
  });
  await press('共享计时器');
  await press('开始');
  expect(fixture.host.textContent).toContain('计时命令结果待确认');
  await press('共享计时器');
  act(() => room.update({ status: 'reconnecting' }));
  await press('共享计时器');
  expect(findButton('重试原命令')).toBeUndefined();
  expect(fixture.host.textContent).toContain('正在重新连接');
  act(() => room.update({ status: 'online' }));
  await press('重试原命令');

  expect(room.createCommandId).toHaveBeenCalledOnce();
  expect(room.getTimerReceipt.mock.calls.map(([commandId]) => commandId)).toEqual([
    'timer-op-1',
    'timer-op-1',
  ]);
  expect(room.changeTimer.mock.calls.map(([command]) => command)).toEqual([
    { commandId: 'timer-op-1', expectedVersion: 0n, action: { kind: 'start' } },
    { commandId: 'timer-op-1', expectedVersion: 0n, action: { kind: 'start' } },
  ]);
  expect(findButton('重试原命令')).toBeUndefined();
});

test('drops timer controls and aborts an inflight mutation on access loss', async () => {
  const room = mockTimer();
  let finish!: (receipt: BoardRoomTimerReceipt) => void;
  room.changeTimer.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await press('共享计时器');
  await press('开始');
  act(() => room.update({ status: 'accessLost', canEdit: false, timer: undefined }));
  expect(fixture.host.textContent).toBe('');
  expect(room.changeTimer.mock.lastCall?.[1]?.aborted).toBe(true);
  expect(room.tasks.size).toBe(0);
  await act(async () => finish({ commandId: 'timer-op-1', kind: 'applied', timer: idleTimer }));
  expect(room.changeTimer).toHaveBeenCalledOnce();
});
