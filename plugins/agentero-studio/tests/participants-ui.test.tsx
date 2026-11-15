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

it.each(['human', 'agent'] as const)('keeps %s identity visible but disables follow throughout a preview', async kind => {
  const onFollow = vi.fn(), peer: Presence = { peerId: 'preview-peer', actor: { id: 'preview-member', name: 'Preview member', kind, role: 'owner' }, context: { artifactId: 'board', viewId: 'preview-peer', selectedIds: [], viewport: { x: 30, y: 20, zoom: 1 }, agentTasks: [{ taskId: 'task', scope: { rect: { x: 100, y: 200, w: 500, h: 300 } }, expiresAt: Date.now() + 60000 }] }, updatedAt: new Date().toISOString() };
  await act(async () => root.render(<OnlineParticipants actor={LOCAL_ACTOR} peers={[peer]} following="" onFollow={onFollow} preview />));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="此刻在这里"]')!.click());
  const follow = container.querySelector<HTMLButtonElement>('.studio-online-row button')!;
  expect(container.textContent).toContain(peer.actor.name); expect(follow.disabled).toBe(true); expect(follow.title).toBe('预览期间不能跟随，请先退出预览');
  await act(async () => follow.click()); expect(onFollow).not.toHaveBeenCalled();
  await act(async () => root.render(<OnlineParticipants actor={LOCAL_ACTOR} peers={[peer]} following="" onFollow={onFollow} />));
  expect(follow.disabled).toBe(false); await act(async () => follow.click()); expect(onFollow).toHaveBeenCalledWith(peer.actor.id);
});

it('offers explicit Agent-area follow without inventing a viewport, and disables it on lease expiry', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000); const onFollow = vi.fn();
  const peer: Presence = { peerId: 'agent-peer', actor: { ...LOCAL_ACTOR, id: 'agent', name: 'Builder', kind: 'agent' }, context: { artifactId: 'board', viewId: 'agent-peer', selectedIds: [], activity: 'working', agentTasks: [{ taskId: 'work', label: '扩展架构图', scope: { rect: { x: 100, y: 100, w: 500, h: 300 } }, expiresAt: 2000 }] }, updatedAt: new Date().toISOString() };
  await act(async () => root.render(<OnlineParticipants actor={LOCAL_ACTOR} peers={[peer]} following="" onFollow={onFollow} />));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="此刻在这里"]')!.click());
  expect(container.textContent).toContain('扩展架构图');
  const follow = container.querySelector<HTMLButtonElement>('.studio-online-row button')!;
  expect(follow.disabled).toBe(false); await act(async () => follow.click()); expect(onFollow).toHaveBeenCalledWith('agent');
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="此刻在这里"]')!.click());
  await act(async () => vi.advanceTimersByTimeAsync(1001));
  expect(container.querySelector<HTMLButtonElement>('.studio-online-row button')!.disabled).toBe(true);
});

it('follows the Agent world area with pan and zoom, yields while editing, and stops on task expiry', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000); vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const onStop = vi.fn(), room: CollaborationRoom = { send: vi.fn().mockResolvedValue(true), subscribe: () => () => {} };
  const peer: Presence = { peerId: 'agent-peer', actor: { ...LOCAL_ACTOR, id: 'agent', kind: 'agent' }, context: { artifactId: 'board', viewId: 'agent-peer', selectedIds: [], agentTasks: [{ taskId: 'work', scope: { rect: { x: 100, y: 200, w: 600, h: 400 } }, expiresAt: 2000 }] }, updatedAt: new Date().toISOString() };
  function Fixture({ busy }: { busy: boolean }) {
    const area = useRef<HTMLDivElement>(null);
    const follow = useViewportFollow({ actorId: 'local', peerId: 'own', peers: [peer], following: 'agent', room, area, busy, onStop });
    return <div ref={node => { area.current = node; if (node) { Object.defineProperty(node, 'clientWidth', { configurable: true, value: 400 }); Object.defineProperty(node, 'clientHeight', { configurable: true, value: 400 }); } }}><output>{JSON.stringify(follow.viewport)}</output></div>;
  }
  await act(async () => root.render(<Fixture busy />)); expect(container.querySelector('output')!.textContent).toBe('');
  await act(async () => root.render(<Fixture busy={false} />));
  const view = JSON.parse(container.querySelector('output')!.textContent!); expect(view.zoom).toBeLessThan(1); expect(view.x).toBeLessThan(0); expect(view.y).toBeLessThan(0);
  await act(async () => vi.advanceTimersByTimeAsync(1001)); expect(onStop).toHaveBeenCalledOnce();
});

it('keeps an Agent ID target on current board geometry and exits when that target disappears', async () => {
  vi.useFakeTimers(); vi.setSystemTime(1000); vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const room: CollaborationRoom = { send: vi.fn().mockResolvedValue(true), subscribe: () => () => {} }, onStop = vi.fn();
  const peer: Presence = { peerId: 'agent-peer', actor: { ...LOCAL_ACTOR, id: 'agent', kind: 'agent' }, context: { artifactId: 'board', viewId: 'agent-peer', selectedIds: [], agentTasks: [{ taskId: 'work', scope: { ids: ['shape'] }, expiresAt: 62000 }] }, updatedAt: new Date().toISOString() };
  const board: Board = { artifact: { id: 'board', type: 'whiteboard', title: '', revision: 0, createdAt: '', updatedAt: '', pinned: false }, elements: [{ id: 'shape', type: 'shape', x: 0, y: 0, w: 100, h: 100, version: 1 }], style: DEFAULT_STYLE };
  function Fixture({ document }: { document: Board }) {
    const area = useRef<HTMLDivElement>(null), follow = useViewportFollow({ actorId: 'local', peerId: 'own', peers: [peer], following: 'agent', room, area, busy: false, onStop, document });
    return <div ref={area}><output>{JSON.stringify(follow.viewport)}</output></div>;
  }
  await act(async () => root.render(<Fixture document={board} />)); const first = JSON.parse(container.querySelector('output')!.textContent!);
  await act(async () => root.render(<Fixture document={{ ...board, elements: [{ ...board.elements[0]!, x: 1000 }] }} />)); const moved = JSON.parse(container.querySelector('output')!.textContent!);
  expect(moved.x).toBeLessThan(first.x - 900); expect(onStop).not.toHaveBeenCalled();
  await act(async () => root.render(<Fixture document={{ ...board, elements: [] }} />)); expect(onStop).toHaveBeenCalledOnce(); expect(container.querySelector('output')!.textContent).toBe('');
});

let root: Root, container: HTMLDivElement;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); container.className = 'studio'; document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function type(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); }); }

it('ignores human read/write activity labels when readonly peers have no real editing or saving targets', async () => {
  const peers = (['viewer', 'commenter'] as const).map((role, index): Presence => ({ peerId: `${role}-page`, actor: { ...LOCAL_ACTOR, id: role, name: role, kind: 'human', role }, context: { artifactId: 'board', viewId: `${role}-page`, selectedIds: ['one'], editingIds: [], movingIds: [], savingIds: [], activity: index ? 'reading' : 'writing' }, updatedAt: new Date().toISOString() }));
  await act(async () => root.render(<OnlineParticipants actor={LOCAL_ACTOR} peers={peers} following="" onFollow={() => {}} />));
  expect(container.querySelector('.is-busy')).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="此刻在这里"]')!.click());
  for (const row of container.querySelectorAll('.studio-online-row')) {
    expect(row.querySelector('p')!.textContent).toContain('在画布上');
    expect(row.textContent).not.toContain('正在修改'); expect(row.textContent).not.toContain('正在读取');
    expect(row.querySelector('.is-busy')).toBeNull(); expect(row.querySelector('strong small')).toBeNull();
  }
});

it('distinguishes saving from live editing and clears busy after save completion or failure despite selection', async () => {
  const page: Presence = { peerId: 'alice-page', actor: { ...LOCAL_ACTOR, id: 'alice', name: 'Alice', role: 'editor' }, context: { artifactId: 'board', viewId: 'alice-page', selectedIds: ['one', 'two'], editingIds: [], movingIds: [], savingIds: [] }, updatedAt: new Date().toISOString() };
  const render = (context: NonNullable<Presence['context']>) => act(async () => root.render(<OnlineParticipants actor={LOCAL_ACTOR} peers={[{ ...page, context }]} following="" onFollow={() => {}} />));
  await render({ ...page.context!, savingIds: ['one'], editingIds: ['two'] });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="此刻在这里"]')!.click());
  const row = () => container.querySelector('.studio-online-row')!;
  expect(row().querySelector('p')!.textContent).toContain('正在编辑'); expect(row().textContent).not.toContain('正在保存');
  await act(async () => root.render(<OnlineParticipants actor={LOCAL_ACTOR} peers={[{ ...page, context: { ...page.context!, savingIds: ['one'] } }, { ...page, peerId: 'alice-other-page', context: { ...page.context!, viewId: 'alice-other-page', editingIds: ['two'] } }]} following="" onFollow={() => {}} />));
  expect(row().querySelector('p')!.textContent).toContain('正在编辑'); expect(row().textContent).not.toContain('正在保存');
  await render({ ...page.context!, savingIds: ['one'], movingIds: ['two'] }); expect(row().textContent).not.toContain('正在保存');
  await render({ ...page.context!, savingIds: ['one'] }); expect(row().querySelector('p')!.textContent).toContain('正在保存'); expect(row().querySelector('.is-busy')).not.toBeNull();
  await render(page.context!); expect(row().querySelector('p')!.textContent).toContain('在画布上'); expect(row().querySelector('.is-busy')).toBeNull();
  await render({ ...page.context!, savingIds: ['one'] }); expect(row().querySelector('.is-busy')).not.toBeNull();
  await render({ ...page.context!, dirty: true, issues: [{ type: 'save-error', message: '保存失败', ids: ['one'] }] });
  expect(row().textContent).not.toContain('正在保存'); expect(row().textContent).not.toContain('正在编辑'); expect(row().querySelector('.is-busy')).toBeNull();
});

it('keeps both Agents as robots in the header and member list throughout working and idle changes', async () => {
  const agent = (id: string, name: string, color: string, working: boolean): Presence => ({ peerId: `${id}-page`, actor: { ...LOCAL_ACTOR, id, name, kind: 'agent' }, color, context: { artifactId: 'board', viewId: `${id}-page`, selectedIds: [], activity: working ? 'working' : 'idle', agentTasks: working ? [{ taskId: `${id}-task`, label: '绘制图解', scope: { rect: { x: 0, y: 0, w: 200, h: 100 } }, expiresAt: Date.now() + 60_000 }] : [] }, updatedAt: new Date().toISOString() });
  const render = (workingA: boolean, workingB: boolean) => act(async () => root.render(<OnlineParticipants actor={LOCAL_ACTOR} peers={[agent('agent-a', 'Agent A · aa00', '#785ee8', workingA), agent('agent-b', 'Agent B · bb00', '#d25f25', workingB)]} following="agent-a" onFollow={() => {}} />));
  await render(true, true); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="此刻在这里"]')!.click());
  const colors = [...container.querySelectorAll<HTMLElement>('.studio-online-avatar')].map(avatar => avatar.style.background);
  for (const [a, b] of [[true, true], [false, true], [false, false], [true, false]]) {
    await render(a!, b!);
    const header = container.querySelectorAll('.studio-online-stack .studio-online-avatar'), list = container.querySelectorAll('.studio-online-row .studio-online-avatar');
    expect(header).toHaveLength(2); expect(list).toHaveLength(2);
    for (const avatar of [...header, ...list]) { expect(avatar.querySelector('svg.lucide-bot')).not.toBeNull(); expect(avatar.querySelector('.studio-agent-working-mark')).toBeNull(); }
    expect([...container.querySelectorAll<HTMLElement>('.studio-online-avatar')].map(avatar => avatar.style.background).sort()).toEqual([...colors].sort());
    expect(container.querySelectorAll('.studio-online-avatar.is-followed')).toHaveLength(2);
    expect(container.querySelectorAll('.studio-online-avatar.is-busy')).toHaveLength((Number(a) + Number(b)) * 2);
  }
});

it('keeps Agent identity separate from a normalized work status for plain and already-prefixed labels', async () => {
  const peers = ['绘制服务图', '正在工作 · 绘制依赖图'].map((label, index): Presence => ({ peerId: `agent-${index}-page`, actor: { ...LOCAL_ACTOR, id: `agent-${index}`, name: `Agent ${index ? 'B' : 'A'} · ${index ? 'bb00' : 'aa00'}`, kind: 'agent' }, context: { artifactId: 'board', viewId: `agent-${index}-page`, selectedIds: [], agentTasks: [{ taskId: 'task', label, scope: { rect: { x: index * 300, y: 0, w: 200, h: 100 } }, expiresAt: Date.now() + 60_000 }] }, updatedAt: new Date().toISOString() }));
  await act(async () => root.render(<OnlineParticipants actor={LOCAL_ACTOR} peers={peers} following="" onFollow={() => {}} />));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="此刻在这里"]')!.click());
  const rows = [...container.querySelectorAll('.studio-online-row')];
  for (const peer of peers) {
    const row = rows.find(row => row.querySelector('strong')?.firstChild?.textContent === peer.actor.name)!;
    expect(row).toBeDefined(); expect(row.querySelector('strong')!.textContent).not.toContain('绘制');
    const status = row.querySelector('p')!.textContent!; expect(status).toBe(`正在工作 · ${peer.actor.id === 'agent-0' ? '绘制服务图' : '绘制依赖图'}`);
    expect(status.match(/正在工作/g)).toHaveLength(1);
  }
});

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
  await act(async () => { publish(undefined); await vi.advanceTimersByTimeAsync(40); });
  expect(send.mock.calls.at(-1)?.[1].phase).toBe('end');
  const finalFrame = send.mock.calls.filter(([, data]) => data.phase === 'start').at(-1)?.[1];
  expect(finalFrame.atoms).toEqual(expect.arrayContaining([expect.objectContaining({ element: expect.objectContaining({ id: 'shape', x: 11 }) })]));
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
