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
const taskMeta = (at = START) => ({ generation: 'generation-1', phase: 'writing' as const, startedAt: at, lastActivityAt: at, lastProgressAt: at });
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

it('hides only the matching peer and target moving hint when its geometry preview is visible', async () => {
  const alice = peer('alice', { context: context([], ['one', 'two']) });
  const otherPage = peer('alice-other-page', { actor: alice.actor, context: context([], ['one']) });
  const bob = peer('bob', { context: context([], ['one']) });
  await mount([alice, bob], { geometryTargets: [{ peerId: 'alice', elementIds: ['one'] }] });
  expect(host.querySelector('[data-peer-actor="alice"][data-peer-state="moving"]')!.getAttribute('data-peer-targets')).toBe('two');
  expect(host.querySelector('[data-peer-actor="bob"][data-peer-state="moving"]')!.getAttribute('data-peer-targets')).toBe('one');
  await mount([alice, otherPage, bob], { geometryTargets: [{ peerId: 'alice', elementIds: ['one'] }] });
  expect(host.querySelector('[data-peer-id="alice"][data-peer-target="one"]')).toBeNull();
  expect(host.querySelector('[data-peer-id="alice"][data-peer-target="two"]')).not.toBeNull();
  expect(host.querySelector('[data-peer-id="alice-other-page"][data-peer-target="one"]')).not.toBeNull();
  expect(host.querySelector('[data-peer-id="bob"][data-peer-target="one"]')).not.toBeNull();
  await mount([{ ...alice, context: { ...context(['one'], ['one', 'two']), savingIds: ['two'] } }], { geometryTargets: [{ peerId: 'alice', elementIds: ['one', 'two'] }] });
  expect(host.querySelector('[data-peer-target="one"]')!.getAttribute('aria-label')).toBe('alice 正在编辑此对象');
  expect(host.querySelector('[data-peer-target="two"]')!.getAttribute('aria-label')).toBe('alice 正在保存此对象');
  expect(host.querySelector('[data-peer-state="moving"]')).toBeNull();
});

it('does not turn missing canonical targets into a board-wide hint or mask an unrelated existing target', async () => {
  const page = peer('alice', { context: context([], ['one']) });
  await mount([page]); expect(host.querySelector('[data-peer-target="one"]')).not.toBeNull();
  await mount([page], { elements: elements.filter(element => element.id !== 'one') }); expect(host.querySelector('[data-peer-state]')).toBeNull();
  await mount([{ ...page, context: context([], ['new-preview', 'two']) }], { geometryTargets: [{ peerId: 'alice', elementIds: ['new-preview'] }] });
  expect(host.querySelectorAll('[data-peer-state]')).toHaveLength(1); expect(host.querySelector('[data-peer-target="two"]')).not.toBeNull();
});

it('shows saving only on queued targets while input and geometry take priority on their own targets', async () => {
  const page = peer('alice', { context: { ...context(['two'], ['arrow']), selectedIds: ['one', 'two', 'arrow'], savingIds: ['one', 'two', 'arrow'] } });
  await mount([page]);
  expect(host.querySelectorAll('[data-peer-target]')).toHaveLength(3);
  expect(host.querySelector('[data-peer-target="one"]')!.getAttribute('aria-label')).toBe('alice 正在保存此对象');
  expect(host.querySelector('[data-peer-target="two"]')!.getAttribute('aria-label')).toBe('alice 正在编辑此对象');
  expect(host.querySelector('[data-peer-target="arrow"]')!.getAttribute('aria-label')).toBe('alice 正在修改此对象');
  await mount([{ ...page, context: { ...context(), selectedIds: ['one', 'two', 'arrow'], savingIds: ['one'] } }]);
  expect(host.querySelectorAll('[data-peer-target]')).toHaveLength(1); expect(host.querySelector('[data-peer-target="one"]')!.textContent).toContain('正在保存');
  expect(host.querySelector('[data-peer-target="two"]')).toBeNull(); expect(host.querySelector('[data-peer-target="arrow"]')).toBeNull();
});

it('removes save hints after completion or failure without keeping selected objects marked as edited', async () => {
  const page = peer('alice', { context: { ...context(), selectedIds: ['one', 'two'], savingIds: ['one'] } });
  await mount([page]); expect(host.querySelector('[data-peer-target="one"]')!.textContent).toContain('正在保存');
  await mount([{ ...page, context: { ...page.context!, savingIds: [] } }]); expect(host.querySelector('[data-peer-target]')).toBeNull();
  await mount([page]); expect(host.querySelector('[data-peer-target]')).not.toBeNull();
  await mount([{ ...page, context: { ...page.context!, savingIds: [], dirty: true, issues: [{ type: 'save-error', message: '保存失败', ids: ['one'] }] } }]);
  expect(host.querySelector('[data-peer-target]')).toBeNull(); expect(host.textContent).not.toContain('正在编辑');
});

it('combines a peer\'s real targets of the same state into one outline without combining another peer', async () => {
  const alice = peer('alice', { context: { ...context(['one', 'two']), selectedIds: ['one', 'two', 'arrow'] } });
  await mount([alice, peer('bob', { context: context(['one']) })]);
  const aliceHints = host.querySelectorAll<HTMLElement>('[data-peer-state][data-peer-actor="alice"]');
  expect(aliceHints).toHaveLength(1); expect(aliceHints[0]!.dataset.peerTargets).toBe('one two');
  expect(aliceHints[0]!.getAttribute('aria-label')).toBe('alice 正在编辑 2 个对象');
  expect(aliceHints[0]!.style.width).toBe('583px'); expect(host.querySelector('[data-peer-target="arrow"]')).toBeNull();
  expect(host.querySelector('[data-peer-target="one"][data-peer-actor="bob"]')).not.toBeNull();
  const bob = peer('bob', { context: context(['one']) });
  await mount([{ ...alice, context: { ...context(), selectedIds: ['arrow'], savingIds: ['one', 'two'] } }, bob]);
  expect(host.querySelectorAll('[data-peer-state="saving"]')).toHaveLength(1);
  expect(host.querySelector('[data-peer-state="saving"]')!.getAttribute('aria-label')).toBe('alice 正在保存 2 个对象');
  await mount([{ ...alice, context: { ...context(), savingIds: [] } }, bob]);
  expect(host.querySelector('[data-peer-state][data-peer-actor="alice"]')).toBeNull(); expect(host.querySelector('[data-peer-target="one"][data-peer-actor="bob"]')).not.toBeNull();
});

it('keeps work animation on each Agent area while separating its identity from normalized task status', async () => {
  const peers = ['绘制服务图', '正在工作 · 绘制依赖图'].map((label, index) => peer(`agent-${index}`, { actor: { id: `agent-${index}`, name: `Agent ${index ? 'B' : 'A'} · ${index ? 'bb00' : 'aa00'}`, kind: 'agent', role: 'owner' }, context: { ...context(), activity: 'working', agentTasks: [{ ...taskMeta(), taskId: `task-${index}`, label, scope: { rect: { x: index * 300, y: 0, w: 200, h: 100 } }, expiresAt: START + 60_000 }] } }));
  await mount(peers);
  for (const [index, agent] of peers.entries()) {
    const area = host.querySelector<HTMLElement>(`[data-agent-task="task-${index}"]`)!;
    expect(area.querySelectorAll('.studio-agent-working-mark')).toHaveLength(1);
    expect(area.textContent).toContain(`${agent.actor.name} · 修改中 · ${index ? '绘制依赖图' : '绘制服务图'}`);
    expect(area.textContent!.match(/修改中/g)).toHaveLength(1); expect(area.style.pointerEvents).toBe('none');
  }
  await mount(peers.map(agent => ({ ...agent, context: { ...agent.context!, activity: 'idle', agentTasks: [] } })));
  expect(host.querySelector('.studio-agent-working-mark')).toBeNull();
});

it('renders an explicit empty-ground Agent task as a nonblocking animated area and expires it on the server clock', async () => {
  const agent = peer('builder', { actor: { id: 'builder', name: 'Builder', kind: 'agent', role: 'owner' }, context: { ...context(), activity: 'working', agentTasks: [{ ...taskMeta(), taskId: 'task', label: '扩展架构图', scope: { rect: { x: 50, y: 70, w: 600, h: 400 } }, expiresAt: START + 2000 }] } });
  await mount([agent]);
  const area = host.querySelector<HTMLElement>('[data-agent-task="task"]')!;
  expect(area).not.toBeNull(); expect(area.style.left).toBe('50px'); expect(area.style.width).toBe('600px'); expect(area.style.pointerEvents).toBe('none');
  expect(area.textContent).toContain('Builder'); expect(area.textContent).toContain('扩展架构图'); expect(area.querySelector('.studio-agent-working-mark')).not.toBeNull();
  await advance(2000); expect(host.querySelector('[data-agent-task]')?.classList.contains('is-ending')).toBe(true);
  await advance(500); expect(host.querySelector('[data-agent-task]')).toBeNull();
});

it('resolves task IDs against current geometry and keeps independent Agent regions visible', async () => {
  const task = (id: string, actorId: string) => peer(actorId, { actor: { id: actorId, name: actorId, kind: 'agent', role: 'owner' }, context: { ...context(), agentTasks: [{ ...taskMeta(), taskId: id, scope: { ids: ['one', 'two'] }, expiresAt: START + 60_000 }] } });
  const peers = [task('first', 'agent-one'), task('second', 'agent-two')]; await mount(peers);
  expect(host.querySelectorAll('[data-agent-task]')).toHaveLength(2);
  const before = host.querySelector<HTMLElement>('[data-agent-task="first"]')!.style.width;
  await mount(peers, { elements: elements.map(element => element.id === 'two' ? { ...element, x: 900 } : element) });
  expect(host.querySelector<HTMLElement>('[data-agent-task="first"]')!.style.width).not.toBe(before);
  await mount(peers, { preview: true }); expect(host.querySelector('[data-agent-task]')).toBeNull();
});

it('clears Agent claims on the server deadline despite a different client clock and no new presence event', async () => {
  vi.setSystemTime(START - 7200_000);
  const agent = peer('builder', { actor: { id: 'builder', name: 'Builder', kind: 'agent', role: 'owner' }, context: { ...context(), agentTasks: [{ ...taskMeta(), taskId: 'work', scope: { ids: ['one'] }, expiresAt: START + 1000 }] } });
  await mount([agent], { clockOffsetMs: 7200_000 }); expect(host.querySelector('[data-agent-task]')).not.toBeNull();
  await advance(1000); expect(host.querySelector('[data-agent-task]')?.classList.contains('is-ending')).toBe(true);
  await advance(500); expect(host.querySelector('[data-agent-task]')).toBeNull();
});

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

it.each([-7_200_000, 7_200_000])('keeps a workspace after a minute and marks stale progress on server time %s without peer updates', async offset => {
  vi.setSystemTime(START - offset);
  const task = { ...taskMeta(), taskId: 'long-work', generation: 'long-generation', phase: 'preparing' as const, label: '准备房屋笔迹', scope: { rect: { x: 30, y: 40, w: 500, h: 300 } }, expiresAt: START + 600_000 };
  const agent = peer('builder', { actor: { id: 'builder', name: 'Agent A', kind: 'agent', role: 'owner' }, context: { ...context(), activity: 'writing', agentTasks: [task] } });
  await mount([agent], { clockOffsetMs: offset });
  const area = () => host.querySelector<HTMLElement>('[data-agent-task="long-work"]')!;
  expect(area().textContent).toContain('准备中');
  await advance(60_001); expect(area()).not.toBeNull(); expect(area().classList.contains('is-stale')).toBe(false);
  await advance(59_999); expect(area().classList.contains('is-stale')).toBe(true); expect(area().textContent).toContain('暂未收到新进度');
  expect(area().style.getPropertyValue('--agent-work-play-state')).toBe('paused');
  await mount([{ ...agent, updatedAt: new Date(START + 120_000).toISOString(), context: { ...agent.context!, agentTasks: [{ ...task, lastActivityAt: START + 120_000, expiresAt: START + 720_000 }] } }], { clockOffsetMs: offset });
  expect(area().classList.contains('is-stale')).toBe(true);
  await mount([{ ...agent, context: { ...agent.context!, agentTasks: [{ ...task, phase: 'verifying', lastProgressAt: START + 120_000, lastActivityAt: START + 120_000, expiresAt: START + 720_000 }] } }], { clockOffsetMs: offset });
  expect(area().classList.contains('is-stale')).toBe(false); expect(area().textContent).toContain('检查中');
  expect(area().style.getPropertyValue('--agent-work-play-state')).toBe('running');
});

it('fades a terminal workspace for 500 ms without showing a release action or reusing a newer generation', async () => {
  const task = { ...taskMeta(), taskId: 'work', generation: 'old-generation', scope: { ids: ['one'] }, expiresAt: START + 600_000 };
  const agent = peer('builder', { actor: { id: 'builder', name: 'Agent A', kind: 'agent', role: 'owner' }, context: { ...context(), agentTasks: [task] } });
  const release = vi.fn().mockResolvedValue(undefined);
  await mount([agent], { onReleaseAgentTask: release });
  const terminal = { ...task, endedAt: START, outcome: 'released' as const };
  await mount([{ ...agent, context: { ...agent.context!, agentTasks: [terminal, { ...task, generation: 'new-generation', scope: { rect: { x: 800, y: 40, w: 100, h: 100 } } }] } }], { onReleaseAgentTask: release });
  const old = host.querySelector<HTMLElement>('[data-agent-generation="old-generation"]')!;
  expect(old).not.toBeNull(); expect(old.classList.contains('is-ending')).toBe(true); expect(old.querySelector('button')).toBeNull();
  expect(host.querySelectorAll('[data-agent-task="work"]')).toHaveLength(2);
  await advance(499); expect(host.querySelector('[data-agent-generation="old-generation"]')).not.toBeNull();
  await advance(1); expect(host.querySelector('[data-agent-generation="old-generation"]')).toBeNull();
  const newer = host.querySelector<HTMLElement>('[data-agent-generation="new-generation"]')!;
  expect(newer).not.toBeNull(); await act(async () => newer.querySelector<HTMLButtonElement>('button')!.click());
  expect(release).toHaveBeenCalledWith({ artifactId: 'board', targetActorId: 'builder', taskId: 'work', generation: 'new-generation' });
});

it('ends an expired workspace locally with a short fade even if no further presence event arrives', async () => {
  const task = { ...taskMeta(), taskId: 'work', scope: { rect: { x: 20, y: 30, w: 400, h: 200 } }, expiresAt: START + 600_000 };
  const agent = peer('builder', { actor: { id: 'builder', name: 'Agent A', kind: 'agent', role: 'owner' }, context: { ...context(), agentTasks: [task] } });
  await mount([agent]); await advance(600_000);
  expect(host.querySelector('[data-agent-task="work"]')?.classList.contains('is-ending')).toBe(true);
  await advance(500); expect(host.querySelector('[data-agent-task]')).toBeNull();
  await mount([{ ...agent, context: { ...agent.context!, agentTasks: [{ ...task, outcome: 'expired', endedAt: START + 600_200 }] } }]);
  expect(host.querySelector('[data-agent-task]')).toBeNull();
});

it('keeps the last visible bounds only for a terminal fade and never revives an already empty active scope', async () => {
  const task = { ...taskMeta(), taskId: 'work', scope: { ids: ['one'] }, expiresAt: START + 600_000 };
  const agent = peer('builder', { actor: { id: 'builder', name: 'Agent A', kind: 'agent', role: 'owner' }, context: { ...context(), agentTasks: [task] } });
  await mount([agent]); const before = host.querySelector<HTMLElement>('[data-agent-task]')!.style.left;
  await mount([{ ...agent, context: { ...agent.context!, agentTasks: [{ ...task, endedAt: START, outcome: 'completed' }] } }], { elements: [] });
  expect(host.querySelector<HTMLElement>('[data-agent-task]')!.style.left).toBe(before);
  await advance(500); expect(host.querySelector('[data-agent-task]')).toBeNull();
  await mount([agent], { elements: [] }); expect(host.querySelector('[data-agent-task]')).toBeNull();
  await mount([{ ...agent, context: { ...agent.context!, agentTasks: [{ ...task, endedAt: START + 500, outcome: 'completed' }] } }], { elements: [] });
  expect(host.querySelector('[data-agent-task]')).toBeNull();
});

it('keeps an owner release failure recoverable and never automatically targets another generation', async () => {
  const task = { ...taskMeta(), taskId: 'work', scope: { rect: { x: 20, y: 30, w: 400, h: 200 } }, expiresAt: START + 600_000 };
  const agent = peer('builder', { actor: { id: 'builder', name: 'Agent A', kind: 'agent', role: 'owner' }, context: { ...context(), agentTasks: [task] } });
  let reject!: (cause: Error) => void;
  const release = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  await mount([agent], { onReleaseAgentTask: release });
  const button = host.querySelector<HTMLButtonElement>('[data-agent-task] button'); expect(button).not.toBeNull();
  await act(async () => button!.click()); expect(button!.disabled).toBe(true);
  await act(async () => reject(new Error('工作区版本已改变，请重新核对')));
  expect(host.querySelector('[data-agent-task]')).not.toBeNull(); expect(button!.disabled).toBe(false);
  expect(host.querySelector('[role="alert"]')!.textContent).toContain('工作区版本已改变'); expect(release).toHaveBeenCalledTimes(1);
  await mount([agent], { preview: true, onReleaseAgentTask: release }); expect(host.querySelector('button')).toBeNull();
});
