// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LOCAL_ACTOR, DEFAULT_STYLE, type Board, type CollaborationRoom, type Presence } from '../src/contracts/studio';
import { OnlineParticipants } from '../src/app/shared/OnlineParticipants';
import { CursorChat } from '../src/app/shared/CursorChat';
import { useNativeGestureSync, type NativeGesture } from '../src/app/shared/useNativeGestureSync';
import { claimParticipantColor, participantColor } from '../src/app/shared/presence-members';
import { useViewportFollow } from '../src/app/shared/useViewportFollow';

let root: Root, container: HTMLDivElement;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); container.className = 'studio'; document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function type(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }

it('shows distinct live agents, their read/write status, and only other people in the header stack', async () => {
  const peer = (peerId: string, id: string, name: string, activity?: string): Presence => ({ peerId, actor: { ...LOCAL_ACTOR, id, name, kind: activity ? 'agent' : 'human' }, context: { viewId: peerId, artifactId: 'board', selectedIds: [], activity }, updatedAt: new Date().toISOString() });
  const peers = [peer('own-other-tab', LOCAL_ACTOR.id, '自己'), peer('human-page', 'human', '协作者'), peer('agent-one', 'agent-one', 'Codex · a1', 'reading'), peer('agent-two', 'agent-two', 'Codex · b2', 'writing')];
  await act(async () => root.render(<OnlineParticipants actor={LOCAL_ACTOR} peers={peers} following="" onFollow={() => {}} />));
  const button = container.querySelector<HTMLButtonElement>('[aria-label="此刻在这里"]')!;
  expect(button.querySelectorAll('.studio-online-avatar')).toHaveLength(3);
  await act(async () => button.click());
  expect(container.querySelectorAll('.studio-online-row')).toHaveLength(3); expect(container.textContent).not.toContain('自己');
  expect(container.textContent).toContain('Codex · a1'); expect(container.textContent).toContain('Codex · b2'); expect(container.textContent).toContain('正在读取'); expect(container.textContent).toContain('正在修改');
  expect(container.querySelectorAll('.studio-online-row .is-busy')).toHaveLength(2);
  const agentRow = [...container.querySelectorAll('.studio-online-row')].find(row => row.textContent?.includes('Codex · a1'))!;
  expect(agentRow.textContent).not.toContain('所有者');
  expect([...container.querySelectorAll('.studio-online-row')].find(row => row.textContent?.includes('协作者'))?.textContent).toContain('所有者');
  await act(async () => root.render(<OnlineParticipants actor={LOCAL_ACTOR} peers={peers.map(page => page.peerId === 'agent-one' ? { ...page, context: { ...page.context!, activity: 'idle', editingIds: [] } } : page)} following="" onFollow={() => {}} />));
  expect(agentRow.textContent).toContain('刚刚活动'); expect(agentRow.querySelector('.is-busy')).toBeNull();
});

it('opens cursor chat at the pointer, caps code points, and expires it without creating a comment', async () => {
  vi.useFakeTimers(); const onMessage = vi.fn();
  await act(async () => root.render(<CursorChat enabled live color="#785ee8" onMessage={onMessage} />));
  await act(async () => { window.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 150 })); window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })); });
  const input = container.querySelector<HTMLInputElement>('[aria-label="光标聊天"]')!;
  expect(input).not.toBeNull(); expect(container.querySelector<HTMLElement>('form')!.style.left).toBe('132px');
  await type(input, '字'.repeat(60)); expect(input.value).toHaveLength(50); expect(onMessage.mock.calls.at(-1)?.[0]).toHaveLength(50);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(container.querySelector('form')?.classList.contains('is-fading')).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(600); }); expect(container.querySelector('form')).toBeNull(); expect(onMessage.mock.calls.at(-1)).toEqual(['', 0]);
});

it('sends geometry during continuous pointer movement rather than debouncing until it stops', async () => {
  vi.useFakeTimers(); const send = vi.fn().mockResolvedValue(true), room: CollaborationRoom = { send, subscribe: () => () => {} };
  const board: Board = { artifact: { id: 'board', type: 'whiteboard', title: '', revision: 0, createdAt: '', updatedAt: '', pinned: false }, elements: [], style: DEFAULT_STYLE };
  let publish!: (gesture: NativeGesture | undefined) => void;
  function Fixture() { publish = useNativeGestureSync({ room, document: board, selfPeerId: 'own' }).publish; return null; }
  await act(async () => root.render(<Fixture />));
  for (let x = 0; x < 12; x++) await act(async () => { publish({ id: 'drag', kind: 'move', elements: [{ id: 'shape', type: 'shape', version: 1, x, y: 0, w: 50, h: 50 }] }); await vi.advanceTimersByTimeAsync(16); });
  expect(send.mock.calls.filter(([, data]) => data.phase !== 'end').length).toBeGreaterThanOrEqual(3);
  await act(async () => publish(undefined)); expect(send.mock.calls.at(-1)?.[1].phase).toBe('end');
});

it('keeps a collision claim stable when its own acknowledgement returns', () => {
  const actor = { ...LOCAL_ACTOR, id: 'later' }, earlier = { ...LOCAL_ACTOR, id: 'aaa' }, color = participantColor(actor);
  const peer: Presence = { peerId: 'first', actor: earlier, color, updatedAt: '' };
  const chosen = claimParticipantColor(actor, 'own', [peer]);
  expect(chosen).not.toBe(color);
  expect(claimParticipantColor(actor, 'own', [peer, { peerId: 'own', actor, color: chosen, updatedAt: '' }])).toBe(chosen);
});

it('eases follow movement over 90 ms, pauses while editing, and uses a fixed missing-peer deadline', async () => {
  vi.useFakeTimers(); const onStop = vi.fn(), room: CollaborationRoom = { send: vi.fn().mockResolvedValue(true), subscribe: () => () => {} };
  const peer: Presence = { peerId: 'remote-page', actor: { ...LOCAL_ACTOR, id: 'remote' }, visible: true, context: { artifactId: 'board', viewId: 'remote-page', selectedIds: [], viewport: { x: -100, y: -50, zoom: 2 }, surface: { w: 800, h: 400 } }, updatedAt: new Date().toISOString() };
  function Fixture({ peers, busy }: { peers: Presence[]; busy: boolean }) {
    const area = useRef<HTMLDivElement>(null);
    const follow = useViewportFollow({ actorId: 'local', peerId: 'own-page', peers, following: 'remote', room, area, busy, onStop, currentViewport: { x: 0, y: 0, zoom: 1 } });
    return <div ref={node => { area.current = node; if (node) { Object.defineProperty(node, 'clientWidth', { configurable: true, value: 400 }); Object.defineProperty(node, 'clientHeight', { configurable: true, value: 400 }); } }}><output>{JSON.stringify(follow.viewport)}</output></div>;
  }
  const render = async (peers: Presence[], busy: boolean) => act(async () => root.render(<Fixture peers={peers} busy={busy} />));
  const value = () => { const text = container.querySelector('output')!.textContent; return text ? JSON.parse(text) : undefined; };
  await render([peer], true); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); expect(value()).toBeUndefined();
  await render([peer], false); await act(async () => { await vi.advanceTimersByTimeAsync(45); });
  expect(value().x).toBeLessThan(0); expect(value().x).toBeGreaterThan(-50);
  await render([peer], true); const paused = value(); await act(async () => { await vi.advanceTimersByTimeAsync(200); }); expect(value()).toEqual(paused);
  await render([peer], false); await act(async () => { await vi.advanceTimersByTimeAsync(120); }); expect(value()).toEqual({ x: -50, y: 75, zoom: 1 });
  await render([], false); await act(async () => { await vi.advanceTimersByTimeAsync(600); });
  await render([{ ...peer, actor: { ...peer.actor, id: 'unrelated' } }], false); await act(async () => { await vi.advanceTimersByTimeAsync(399); }); expect(onStop).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(2); }); expect(onStop).toHaveBeenCalledOnce();
  onStop.mockClear();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  await render([{ ...peer, context: { ...peer.context!, viewport: { x: -200, y: -50, zoom: 2 } } }], false);
  expect(value()).toEqual({ x: -100, y: 75, zoom: 1 }); // Reduced motion applies the fitted view immediately.
  await render([{ ...peer, following: 'own-page' }], false);
  await act(async () => { await vi.advanceTimersByTimeAsync(1501); }); expect(onStop).toHaveBeenCalledOnce();
});
