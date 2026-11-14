// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ACTOR, type Actor, type HistoryEntry, type Presence, type RoomTimer } from '../src/contracts/studio';
import { EditorPopover } from '../src/app/shared/editor-panels/EditorPopover';
import { HistoryPanel, groupHistoryByDate, type HistoryPanelProps } from '../src/app/shared/editor-panels/HistoryPanel';
import { SharePanel, joinedActors, type SharePanelProps } from '../src/app/shared/editor-panels/SharePanel';
import { TimerControl } from '../src/app/shared/editor-panels/TimerControl';

let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(children: React.ReactNode) { await act(async () => root.render(children)); }
function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function input(label: string, value: string) {
  const node = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
}
const version = (id: string, revision: number, createdAt: string, extra: Partial<HistoryEntry> = {}): HistoryEntry => ({ id, revision, createdAt, actor: LOCAL_ACTOR, summary: `修改 ${id}`, changedIds: [`element-${id}`], ...extra });
const person: Actor = { id: 'peer', name: '协作者', kind: 'human', role: 'editor' };
const peer = (peerId: string, actor = person): Presence => ({ peerId, actor, updatedAt: '2026-11-14T10:00:00Z' });
function historyProps(extra: Partial<HistoryPanelProps> = {}): HistoryPanelProps {
  return { history: [], currentRevision: 3, actor: LOCAL_ACTOR, canRestore: true, onRefresh: vi.fn(), onPreview: vi.fn(), onRestore: vi.fn(), ...extra };
}
function shareProps(extra: Partial<SharePanelProps> = {}): SharePanelProps {
  return { title: '测试作品', actor: LOCAL_ACTOR, peers: [], share: { enabled: false }, exportFormats: [{ format: 'png', label: 'PNG 图片' }, { format: 'json', label: 'JSON 数据' }], canBackup: true, onStart: vi.fn(), onReset: vi.fn(), onStop: vi.fn(), onCopy: vi.fn(), onExport: vi.fn(), ...extra };
}

describe('history popover content', () => {
  it('groups local calendar dates without changing source order and keeps unknown dates readable', () => {
    const now = new Date(2026, 10, 14, 0, 10), source = [version('older', 1, new Date(2026, 10, 10).toISOString()), version('yesterday', 2, new Date(2026, 10, 13, 23, 59).toISOString()), version('today', 3, new Date(2026, 10, 14, 0, 1).toISOString()), version('unknown', 0, 'invalid')];
    const grouped = groupHistoryByDate(source, now);
    expect(grouped.map(group => [group.label, group.entries.map(entry => entry.id)])).toEqual([['今天', ['today']], ['昨天', ['yesterday']], ['2026年11月10日', ['older']], ['日期未知', ['unknown']]]);
    expect(source.map(entry => entry.id)).toEqual(['older', 'yesterday', 'today', 'unknown']);
  });

  it('expands recorded object ids and calls inspect, preview and whole-version restore with the actual entry', async () => {
    const old = version('old', 2, '2026-11-13T09:30:00Z', { changedIds: ['a', 'b', 'a'] }), current = version('current', 3, '2026-11-14T09:30:00Z');
    const props = historyProps({ history: [old, current], onInspectChange: vi.fn() });
    await render(<HistoryPanel {...props} />);
    expect(host.textContent).toContain('当前版本');
    await click('展开版本 2');
    const inspect = [...host.querySelectorAll('button')].filter(node => node.textContent === '看改动');
    expect(inspect).toHaveLength(2);
    await act(async () => inspect[1]!.click());
    expect(props.onInspectChange).toHaveBeenCalledWith(old, 'b');
    await click('预览版本'); expect(props.onPreview).toHaveBeenCalledWith(old);
    await click('恢复为新版本'); expect(props.onRestore).toHaveBeenCalledWith(old);
    await click('展开版本 3');
    expect(host.textContent).not.toContain('恢复为新版本');
  });

  it('retains read-only preview but hides restore for viewers and supports returning from preview', async () => {
    const old = version('old', 2, '2026-11-13T09:30:00Z'), onReturnToCurrent = vi.fn();
    const props = historyProps({ history: [old], canRestore: false, previewId: old.id, onReturnToCurrent });
    await render(<HistoryPanel {...props} />); await click('展开版本 2');
    expect(host.textContent).not.toContain('恢复为新版本');
    await click('正在预览'); expect(props.onPreview).toHaveBeenCalledWith(old);
    await click('返回当前版本'); expect(onReturnToCurrent).toHaveBeenCalledOnce();
  });
});

describe('share and export popover content', () => {
  it('shows each joined actor once and requires explicit LAN start before any copy action', async () => {
    const peers = [peer('owner', LOCAL_ACTOR), peer('first'), peer('second')];
    expect(joinedActors(peers, LOCAL_ACTOR).map(value => value.peerId)).toEqual(['first']);
    const props = shareProps({ peers }); await render(<SharePanel {...props} />);
    expect([...host.querySelectorAll('.studio-share-person strong')].filter(node => node.textContent === person.name)).toHaveLength(1);
    expect(button('复制可编辑链接').disabled).toBe(true);
    expect(button('复制可评论链接').disabled).toBe(true);
    expect(button('复制仅查看链接').disabled).toBe(true);
    await click('复制可编辑链接'); expect(props.onCopy).not.toHaveBeenCalled(); expect(props.onStart).not.toHaveBeenCalled();
    await click('启用局域网分享'); expect(props.onStart).toHaveBeenCalledOnce();
  });

  it('copies only supplied role links and keeps reset and stop behind their more controls', async () => {
    const props = shareProps({ share: { enabled: true, links: { editor: 'http://local.test/editor', commenter: 'http://local.test/commenter', viewer: 'http://local.test/viewer' } } });
    await render(<SharePanel {...props} />);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await click('复制可评论链接'); expect(props.onCopy).toHaveBeenCalledWith('http://local.test/commenter');
    await click('可编辑链接更多操作'); await click('重置此链接'); expect(props.onReset).toHaveBeenCalledWith('editor');
    await click('更多共享设置'); await click('停止局域网分享'); expect(props.onStop).toHaveBeenCalledOnce();
  });

  it('renders product export formats dynamically and excludes owner management and backup for guests', async () => {
    const props = shareProps({ actor: { ...person, role: 'viewer' }, owner: LOCAL_ACTOR, share: { enabled: true, links: { editor: 'hidden' } }, canBackup: false });
    await render(<SharePanel {...props} />);
    expect(host.querySelector('[aria-label="更多共享设置"]')).toBeNull();
    expect(host.querySelector('[aria-label="复制可编辑链接"]')).toBeNull();
    expect(host.textContent).toContain('仅查看');
    await click('导出'); await click('PNG 图片PNG'); expect(props.onExport).toHaveBeenCalledWith('png');
    expect(host.textContent).not.toContain('SVG'); expect(host.textContent).not.toContain('完整作品备份');
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('exports the archive only when that capability is supplied and supports tab keyboard navigation', async () => {
    const props = shareProps(); await render(<SharePanel {...props} />);
    const tab = host.querySelector('[role="tab"][aria-selected="true"]')!;
    await act(async () => tab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(document.activeElement?.textContent).toBe('导出');
    await click('完整作品备份包含历史记录与资源ZIP'); expect(props.onExport).toHaveBeenCalledWith('zip');
  });
});

describe('shared timer control', () => {
  it('edits local minutes and seconds before sending a real start action', async () => {
    const onAction = vi.fn(); await render(<TimerControl timer={null} canEdit busy={false} onAction={onAction} />);
    await click('共享计时器');
    expect(host.querySelector<HTMLInputElement>('[aria-label="计时分钟"]')?.value).toBe('5');
    await click('增加一分钟'); await click('减少一分钟');
    expect(onAction).not.toHaveBeenCalled();
    await input('计时分钟', '2'); await input('计时秒数', '35'); await click('开始');
    expect(onAction).toHaveBeenCalledWith('start', 155);
    expect(host.querySelector('[aria-label="计时分钟"]')).not.toBeNull(); // The service response owns the running state.
  });

  it('uses shared pause, resume and reset callbacks and never changes a running duration locally', async () => {
    const onAction = vi.fn(), timer: RoomTimer = { deadline: Date.now() + 125000, remainingMs: 125000, paused: false, source: person };
    await render(<TimerControl timer={timer} canEdit busy={false} onAction={onAction} />); await click('共享计时器');
    expect(host.querySelector('[aria-label="剩余时间"]')?.textContent).toBe('02:05');
    expect(button('增加一分钟').disabled).toBe(true);
    await click('暂停'); expect(onAction).toHaveBeenLastCalledWith('pause', undefined);
    await render(<TimerControl timer={{ ...timer, paused: true, deadline: null }} canEdit busy={false} onAction={onAction} />);
    await click('继续'); expect(onAction).toHaveBeenLastCalledWith('resume', undefined);
    await click('重置'); expect(onAction).toHaveBeenLastCalledWith('reset');
  });

  it('updates the countdown from its deadline and gives viewers no timer mutation controls', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const timer: RoomTimer = { deadline: Date.now() + 2000, remainingMs: 2000, paused: false, source: person }, onAction = vi.fn();
    await render(<TimerControl timer={timer} canEdit={false} busy={false} onAction={onAction} />); await click('共享计时器');
    await act(async () => vi.advanceTimersByTime(2000));
    expect(host.querySelector('[aria-label="剩余时间"]')?.textContent).toBe('00:00');
    expect(host.textContent).toContain('已结束');
    expect(host.querySelector('[aria-label="暂停"]')).toBeNull(); expect(host.querySelector('[aria-label="增加一分钟"]')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });
});

describe('non-modal editor popover', () => {
  function Example({ onClosed = () => {} }: { onClosed?: () => void }) {
    const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null);
    return <div><div className="studio-editor-popover-anchor"><button ref={anchor} onClick={() => setOpen(previous => !previous)}>打开</button>{open && <EditorPopover title="测试浮层" anchorRef={anchor} onClose={() => { onClosed(); setOpen(false); }}><input aria-label="浮层输入" /><div contentEditable suppressContentEditableWarning aria-label="画布文字">Text</div></EditorPopover>}</div><button>外部</button></div>;
  }
  it('focuses the dialog, closes on Escape and returns focus to its trigger', async () => {
    await render(<Example />); await click('打开');
    expect(document.activeElement).toBe(host.querySelector('[role="dialog"]'));
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(button('打开'));
  });

  it('leaves contenteditable keys alone and closes on outside pointerdown without blocking it', async () => {
    const onClosed = vi.fn(); await render(<Example onClosed={onClosed} />); await click('打开');
    const text = host.querySelector('[contenteditable]')!, escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => text.dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(false); expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(onClosed).not.toHaveBeenCalled();
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    await act(async () => button('外部').dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false); expect(onClosed).toHaveBeenCalledOnce(); expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
