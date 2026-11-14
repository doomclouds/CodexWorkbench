// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PeerPresenceOverlay from '../src/app/canvas/PeerPresenceOverlay.js';
import { participantColor } from '../src/app/shared/presence-members.js';
import { elementBounds } from '../src/app/canvas/canvas-model.js';
import type { BoardElement, Presence } from '../src/contracts/studio.js';
import { OnlineParticipants } from '../src/app/shared/OnlineParticipants.js';

const START = Date.UTC(2026, 10, 15, 3, 0);
const elements: BoardElement[] = [
  { id: 'one', type: 'shape', x: 100, y: 200, w: 240, h: 120, version: 1 },
  { id: 'two', type: 'shape', x: 500, y: 400, w: 180, h: 100, version: 1 },
  { id: 'arrow', type: 'arrow', from: 'one', to: 'two', x: 0, y: 0, w: 1, h: 1, version: 1 },
];
const context = (editingIds: string[] = [], movingIds: string[] = []) => ({ artifactId: 'board', viewId: 'page', selectedIds: [], editingIds, movingIds });
const peer = (id: string, extra: Partial<Presence> = {}): Presence => ({ peerId: id, actor: { id, name: id, role: 'editor', kind: 'human' }, context: context(), updatedAt: new Date(START).toISOString(), ...extra });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(START); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function mount(peers: Presence[], props: Partial<React.ComponentProps<typeof PeerPresenceOverlay>> = {}) { await act(async () => root.render(<PeerPresenceOverlay peers={peers} elements={elements} artifactId="board" selfActorId="self" zoom={2} {...props} />)); }
async function advance(ms: number) { await act(async () => vi.advanceTimersByTime(ms)); }

it('uses the claimed palette and chooses the freshest cursor per other actor while hiding every self page', async () => {
  const actor = { id: 'alice', name: 'Alice', kind: 'human' as const, role: 'editor' as const };
  await mount([
    peer('self-old', { actor: { ...actor, id: 'self' }, cursor: { x: 1, y: 1, t: START } }),
    peer('self-new', { actor: { ...actor, id: 'self' }, cursor: { x: 2, y: 2, t: START } }),
    peer('alice-old', { actor, color: '#019c7f', cursor: { x: 10, y: 20, t: START - 3000 }, updatedAt: new Date(START + 1).toISOString() }),
    peer('alice-current', { actor, color: '#019c7f', cursor: { x: 30, y: 40, surface: 'board', t: START - 1000 } }),
    peer('hidden', { visible: false, cursor: { x: 10, y: 10, t: START } }),
    peer('null', { cursor: null }),
    peer('reader', { cursor: { x: 10, y: 10, t: START, surface: 'html' } }),
  ]);
  const cursors = host.querySelectorAll<HTMLElement>('.studio-remote-cursor'); expect(cursors).toHaveLength(1);
  expect(cursors[0]!.dataset.peerId).toBe('alice-current'); expect(cursors[0]!.style.left).toBe('30px'); expect(cursors[0]!.style.transform).toBe('scale(0.5)');
  expect(cursors[0]!.querySelector('path')!.getAttribute('fill')).toBe(participantColor(actor, '#019c7f'));
  expect(vi.getTimerCount()).toBe(1);
  await mount([]); expect(host.querySelector('.studio-remote-cursor')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});

it('renders human and Agent activity on the actual object bounds with distinct nonblocking name slots', async () => {
  const human = peer('alice', { color: '#dc3c3d', context: context(['one', 'missing']) });
  const agent = peer('builder', { actor: { id: 'builder', name: 'Builder', kind: 'agent', role: 'editor' }, color: '#785ee8', context: context(['one'], ['arrow']) });
  await mount([human, agent, peer('self', { context: context(['two']) }), peer('idle-agent', { actor: { id: 'idle-agent', name: 'Idle', kind: 'agent', role: 'editor' }, context: { ...context(), activity: 'idle', selectedIds: ['two'] } })]);
  const hints = host.querySelectorAll<HTMLElement>('[data-peer-target]'); expect(hints).toHaveLength(3);
  const first = host.querySelector<HTMLElement>('[data-peer-target="one"][data-peer-actor="alice"]')!, second = host.querySelector<HTMLElement>('[data-peer-target="one"][data-peer-actor="builder"]')!;
  expect(first.getAttribute('aria-label')).toBe('alice 正在编辑此对象'); expect(second.textContent).toContain('Builder · 正在修改');
  expect(first.style.left).toBe('98.5px'); expect(first.style.width).toBe('243px'); expect(first.style.borderColor).toBe('rgb(220, 60, 61)');
  expect(first.style.pointerEvents).toBe('none'); expect(second.querySelector('span')!.style.bottom).not.toBe(first.querySelector('span')!.style.bottom);
  const arrow = host.querySelector<HTMLElement>('[data-peer-target="arrow"]')!, box = elementBounds(elements[2]!, elements);
  expect(arrow.style.left).toBe(`${box.x - 1.5}px`); expect(arrow.getAttribute('aria-label')).toBe('Builder 正在修改此对象');
  expect(host.querySelector('[data-peer-actor="idle-agent"]')).toBeNull(); expect(host.querySelector('[data-peer-actor="self"]')).toBeNull();
  await mount([{ ...human, visible: false }, { ...agent, context: context() }]); expect(host.querySelector('[data-peer-target]')).toBeNull();
});

it('caps same-object labels at three plus the remaining count', async () => {
  await mount(Array.from({ length: 5 }, (_value, index) => peer(`person-${index}`, { context: context(['one']) })));
  expect(host.querySelectorAll('[data-peer-target="one"]')).toHaveLength(3); expect(host.textContent).toContain('另 2 人');
});

it('matches the actual header avatar claim for the pointer and editing badge', async () => {
  const peers = [peer('alice', { color: '#fbb315', context: context(['one']), cursor: { x: 10, y: 20, t: START } })];
  await act(async () => root.render(<><OnlineParticipants peers={peers} actor={{ id: 'self', name: 'Me', role: 'owner', kind: 'human' }} following="" onFollow={() => {}} /><PeerPresenceOverlay peers={peers} elements={elements} artifactId="board" selfActorId="self" zoom={1} /></>));
  const avatar = host.querySelector<HTMLElement>('.studio-online-avatar')!, cursor = host.querySelector<HTMLElement>('.studio-remote-cursor > span')!, badge = host.querySelector<HTMLElement>('[data-peer-target] > span')!;
  expect(cursor.style.background).toBe(avatar.style.background); expect(badge.style.background).toBe(avatar.style.background);
  expect(host.querySelector('.studio-remote-cursor path')!.getAttribute('fill')).toBe('#fbb315');
});

it('automatically fades chat, marks a 60-second cursor idle and expires it at 15 minutes without new peer events', async () => {
  let parentRenders = 0;
  const peers = [peer('alice', { context: context(['one']), cursor: { x: 10, y: 20, t: START }, chat: 'hello', chatExpiresAt: START + 5000 })];
  function Parent() { parentRenders++; return <PeerPresenceOverlay peers={peers} elements={elements} artifactId="board" selfActorId="self" zoom={1} />; }
  await act(async () => root.render(<Parent />));
  await advance(4999); expect(host.querySelector('p')!.style.opacity).toBe('1');
  await advance(1); expect(host.querySelector('p')!.style.opacity).toBe('0'); expect(host.querySelector('p')!.style.transition).toBe('opacity 600ms linear');
  await advance(600); expect(host.querySelector('p')).toBeNull();
  await advance(54_400); expect(host.querySelector('.studio-remote-cursor')!.classList.contains('is-idle')).toBe(true); expect((host.querySelector('.studio-remote-cursor') as HTMLElement).style.opacity).toBe('0.35');
  await advance(840_000); expect(host.querySelector('.studio-remote-cursor')).toBeNull(); expect(host.querySelector('[data-peer-target]')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  expect(parentRenders).toBe(1);
});

it.each([-7_200_000, 7_200_000])('uses the server clock offset %s for cursor and chat deadlines', async offset => {
  vi.setSystemTime(START - offset);
  await mount([peer('alice', { cursor: { x: 10, y: 20, t: START }, chat: 'server clock', chatExpiresAt: START + 5000 })], { clockOffsetMs: offset });
  await advance(5600); expect(host.querySelector('p')).toBeNull(); expect(host.querySelector('.is-idle')).toBeNull();
  await advance(54_400); expect(host.querySelector('.is-idle')).not.toBeNull();
  await advance(840_000); expect(host.querySelector('.studio-remote-cursor')).toBeNull();
});

it('pauses the single deadline timer for hidden surfaces and recalculates on visibility recovery', async () => {
  const peers = [peer('alice', { cursor: { x: 10, y: 20, t: START } })];
  await mount(peers); expect(vi.getTimerCount()).toBe(1);
  await act(async () => { host.hidden = true; }); expect(vi.getTimerCount()).toBe(0); expect(host.querySelector('.studio-remote-cursor')).toBeNull();
  await advance(70_000); await act(async () => { host.hidden = false; }); expect(host.querySelector('.is-idle')).not.toBeNull(); expect(vi.getTimerCount()).toBe(1);
  await mount(peers, { preview: true }); expect(host.querySelector('.studio-remote-cursor')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});

it('reacts to document visibility, explicit cursor null and peer departure without lingering marks', async () => {
  let visibility: DocumentVisibilityState = 'visible'; vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const page = peer('alice', { cursor: { x: 10, y: 20, t: START } });
  await mount([page]);
  await act(async () => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); }); expect(vi.getTimerCount()).toBe(0); expect(host.querySelector('.studio-remote-cursor')).toBeNull();
  await advance(61_000); await act(async () => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); }); expect(host.querySelector('.is-idle')).not.toBeNull();
  await mount([{ ...page, cursor: null }]); expect(host.querySelector('.studio-remote-cursor')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  await mount([page]); expect(host.querySelector('.studio-remote-cursor')).not.toBeNull(); await mount([]); expect(host.querySelector('.studio-remote-cursor')).toBeNull();
});

it('removes chat without an animation when reduced motion is enabled', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  await mount([peer('alice', { cursor: { x: 10, y: 20, t: START }, chat: 'quiet', chatExpiresAt: START + 5000 })]);
  expect(host.querySelector('p')!.style.transition).toBe('none'); await advance(5000); expect(host.querySelector('p')).toBeNull();
});
