// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ACTOR, type Actor, type HistoryBatch, type ShareMember, type RoomTimer } from '../src/contracts/studio';
import { EditorPopover } from '../src/app/shared/editor-panels/EditorPopover';
import { HistoryPanel, groupHistoryByDate, type HistoryPanelProps } from '../src/app/shared/editor-panels/HistoryPanel';
import { SharePanel, type SharePanelProps } from '../src/app/shared/editor-panels/SharePanel';
import { TimerControl } from '../src/app/shared/editor-panels/TimerControl';

let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function render(children: React.ReactNode) { await act(async () => root.render(<div className="studio" data-studio-theme="light">{children}</div>)); }
function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) { await act(async () => { const node = button(label); node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); node.click(); }); }
async function input(label: string, value: string) {
  const node = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); });
}
const version = (id: string, revision: number, createdAt: string, extra: Partial<HistoryBatch> = {}): HistoryBatch => ({ id, revision, createdAt, firstVersionId: id, firstRevision: revision, firstCreatedAt: createdAt, versionIds: [id], actor: LOCAL_ACTOR, summary: `修改 ${id}`, changedIds: [`element-${id}`], ...extra });
const person: Actor = { id: 'peer', name: '协作者', kind: 'human', role: 'editor' };
const member: ShareMember = { id: person.id, name: person.name, role: 'editor', joinedAt: '2026-11-14T10:00:00Z', lastSeenAt: '2026-11-14T10:00:00Z', active: true, online: true };
function historyProps(extra: Partial<HistoryPanelProps> = {}): HistoryPanelProps {
  return { history: [], currentRevision: 3, actor: LOCAL_ACTOR, canRestore: true, onRefresh: vi.fn(), onPreview: vi.fn(), onRestore: vi.fn().mockResolvedValue(true), onLoadChanges: vi.fn(async (entry: HistoryBatch) => [...new Set(entry.changedIds)].map(id => ({ id, before: null, after: { text: '新增内容' } }))), ...extra };
}
function shareProps(extra: Partial<SharePanelProps> = {}): SharePanelProps {
  return { title: '测试作品', actor: LOCAL_ACTOR, share: { enabled: false, owner: LOCAL_ACTOR, members: [], roleEnabled: { editor: true, commenter: true, viewer: true } }, exportFormats: [{ format: 'png', label: 'PNG 图片' }, { format: 'json', label: 'JSON 数据' }], canBackup: true, onStart: vi.fn().mockResolvedValue(true), onReset: vi.fn().mockResolvedValue(true), onToggleRole: vi.fn().mockResolvedValue(true), onMemberRole: vi.fn().mockResolvedValue(true), onRemoveMember: vi.fn().mockResolvedValue(true), onCopy: vi.fn(), onExport: vi.fn(), ...extra };
}

describe('history popover content', () => {
  it('groups local calendar dates without changing source order and keeps unknown dates readable', () => {
    const now = new Date(2026, 10, 14, 0, 10), source = [version('older', 1, new Date(2026, 10, 10).toISOString()), version('yesterday', 2, new Date(2026, 10, 13, 23, 59).toISOString()), version('today', 3, new Date(2026, 10, 14, 0, 1).toISOString()), version('unknown', 0, 'invalid')];
    const grouped = groupHistoryByDate(source, now);
    expect(grouped.map(group => [group.label, group.entries.map(entry => entry.id)])).toEqual([['今天', ['today']], ['昨天', ['yesterday']], ['2026年11月10日', ['older']], ['日期未知', ['unknown']]]);
    expect(source.map(entry => entry.id)).toEqual(['older', 'yesterday', 'today', 'unknown']);
  });

  it('opens a real item diff inside history and keeps preview and confirmed whole-version restore separate', async () => {
    const old = version('old', 2, '2026-11-13T09:30:00Z', { changedIds: ['a', 'b', 'a'] }), current = version('current', 3, '2026-11-14T09:30:00Z');
    const props = historyProps({ history: [old, current], onLoadChanges: vi.fn().mockResolvedValue([{ id: 'a', before: null, after: { text: '新增内容' } }, { id: 'b', before: { text: '已删除的内容' }, after: null }]) });
    await render(<HistoryPanel {...props} />);
    expect(host.textContent).toContain('当前版本');
    await click('展开版本 2');
    const inspect = [...host.querySelectorAll('button')].filter(node => node.textContent === '看改动');
    expect(inspect).toHaveLength(2);
    await act(async () => inspect[1]!.click());
    expect(host.querySelector('.studio-history-difference h2')?.textContent).toBe('元素 · b');
    expect(host.querySelector('[aria-label="删除行数"]')?.textContent).toBe('−1');
    expect(host.querySelector('[aria-label="逐行改动"]')?.textContent).toContain('已删除的内容');
    expect(props.onPreview).not.toHaveBeenCalled();
    await click('返回版本历史');
    await click('预览版本'); expect(props.onPreview).toHaveBeenCalledWith(old);
    await click('恢复为新版本'); expect(props.onRestore).not.toHaveBeenCalled();
    await click('确认恢复'); expect(props.onRestore).toHaveBeenCalledWith(old, undefined);
    await click('展开版本 3');
    expect(host.textContent).not.toContain('恢复为新版本');
  });

  it('shows the true batch interval and confirms single-unit restoration at its final version', async () => {
    const batch = version('last', 8, '2026-11-14T10:04:00Z', { firstVersionId: 'first', firstRevision: 5, firstCreatedAt: '2026-11-14T10:01:00Z', versionIds: ['first', 'six', 'seven', 'last'], beforeVersionId: 'before' });
    const props = historyProps({ history: [batch], currentRevision: 9 });
    await render(<HistoryPanel {...props} />); await click('展开版本 8');
    expect(host.textContent).toContain('版本 5–8');
    expect(props.onLoadChanges).toHaveBeenCalledWith(batch);
    await click('看改动'); await click('只恢复这一处'); await click('取消');
    expect(props.onRestore).not.toHaveBeenCalled();
    await click('只恢复这一处'); await click('确认恢复');
    expect(props.onRestore).toHaveBeenCalledWith(batch, 'element-last');
  });

  it('shows a failed diff read and retries it without pretending the change list is empty', async () => {
    const old = version('old', 1, '2026-11-13T09:30:00Z');
    const onLoadChanges = vi.fn().mockRejectedValueOnce(new Error('历史读取失败')).mockResolvedValueOnce([{ id: 'a', before: { text: '旧' }, after: { text: '新' } }]);
    await render(<HistoryPanel {...historyProps({ history: [old], onLoadChanges })} />); await click('展开版本 1');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('历史读取失败');
    await click('重试'); await click('看改动');
    expect(host.querySelector('[aria-label="逐行改动"]')?.textContent).toContain('新');
    expect(onLoadChanges).toHaveBeenCalledTimes(2);
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
  it('offers local invitations without enabling LAN and changes scope explicitly', async () => {
    const props = shareProps(); props.share!.members = [member]; await render(<SharePanel {...props} />);
    expect([...host.querySelectorAll('.studio-share-person strong')].filter(node => node.textContent === person.name)).toHaveLength(1);
    expect(button('复制可编辑链接').disabled).toBe(false);
    expect(button('复制可评论链接').disabled).toBe(false);
    expect(button('复制仅查看链接').disabled).toBe(false);
    await click('复制可编辑链接'); expect(props.onCopy).toHaveBeenCalledWith(undefined, 'editor'); expect(props.onStart).not.toHaveBeenCalled();
    await click('一般访问权限'); await click('局域网可访问'); expect(props.onStart).toHaveBeenCalledWith('lan');
  });

  it('copies only supplied role links and keeps reset and stop behind their more controls', async () => {
    const props = shareProps(); props.share = { ...props.share!, enabled: true, access: 'lan', links: { editor: 'http://local.test/editor', commenter: 'http://local.test/commenter', viewer: 'http://local.test/viewer' } };
    await render(<SharePanel {...props} />);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await click('复制可评论链接'); expect(props.onCopy).toHaveBeenCalledWith('http://local.test/commenter', 'commenter');
    await click('可编辑链接更多操作'); await click('重置此链接'); expect(props.onReset).not.toHaveBeenCalled();
    await click('确认重置'); expect(props.onReset).toHaveBeenCalledWith('editor');
    await click('一般访问权限'); await click('仅这台电脑'); expect(props.onStart).toHaveBeenCalledWith('local');
  });

  it('uses real role-link toggles and member role/removal callbacks with confirmation', async () => {
    const props = shareProps(); props.share = { ...props.share!, enabled: true, members: [member], roleEnabled: { editor: true, commenter: false, viewer: true }, links: { editor: 'editor-link', viewer: 'viewer-link' } };
    await render(<SharePanel {...props} />);
    await click('启用可评论链接'); expect(props.onToggleRole).toHaveBeenCalledWith('commenter', true); expect(props.onStart).not.toHaveBeenCalled();
    await click('可编辑链接更多操作'); await click('停用此链接'); expect(props.onToggleRole).toHaveBeenCalledWith('editor', false);
    await click(`管理成员：${member.name}`);
    expect(button('可评论').disabled).toBe(true);
    await click('仅查看'); expect(props.onMemberRole).toHaveBeenCalledWith(member.id, 'viewer');
    await click(`管理成员：${member.name}`); await click('移除访问权限');
    expect(props.onRemoveMember).not.toHaveBeenCalled(); await click('确认移除');
    expect(props.onRemoveMember).toHaveBeenCalledWith(member.id);
  });

  it('uses the guest invitation projection and canonical link without owner management or tabs', async () => {
    const props = shareProps({ actor: { ...person, role: 'viewer' }, share: { enabled: true, role: 'viewer', roles: ['viewer'], links: { viewer: 'viewer-link' } }, canonicalLink: 'http://local.test/?artifactId=board', canBackup: false });
    await render(<SharePanel {...props} />);
    expect(host.querySelector(`[aria-label="管理成员：${member.name}"]`)).toBeNull();
    expect(host.querySelector('[aria-label="复制可编辑链接"]')).toBeNull();
    expect(host.textContent).toContain('仅查看');
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.textContent).not.toContain('作品所有者'); expect(host.textContent).not.toContain('完整作品备份');
    await click('复制仅查看链接'); expect(props.onCopy).toHaveBeenCalledWith('viewer-link', 'viewer');
    await click('复制页面链接'); expect(props.onCopy).toHaveBeenCalledWith('http://local.test/?artifactId=board');
    expect(props.onStart).not.toHaveBeenCalled();
  });

  it('focuses an available member role when the member current role link is disabled', async () => {
    const props = shareProps(); props.share = { ...props.share!, members: [{ ...member, active: false }], roleEnabled: { editor: false, commenter: false, viewer: true } };
    await render(<SharePanel {...props} />); await click(`管理成员：${member.name}`);
    expect(document.activeElement?.textContent).toBe('仅查看');
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })));
    expect(document.activeElement?.textContent).toBe('移除访问权限');
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
  const timerState = (extra: Partial<RoomTimer> = {}): RoomTimer => ({ durationMs: 125000, deadline: Date.now() + 125000, remainingMs: 125000, paused: false, source: person, ...extra });
  const timerInput = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  async function key(label: string, value: string, type = 'keydown') { await act(async () => timerInput(label).dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true, cancelable: true }))); }
  async function type(label: string, value: string) {
    for (const digit of value) await act(async () => {
      const node = timerInput(label);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, node.value + digit);
      node.dispatchEvent(new InputEvent('input', { bubbles: true, data: digit, inputType: 'insertText' }));
    });
  }
  it('keeps one continuous face, edits minutes/seconds and starts the entered duration', async () => {
    const onAction = vi.fn(); await render(<TimerControl timer={null} canEdit busy={false} onAction={onAction} />);
    await click('共享计时器');
    expect(timerInput('计时分钟').value).toBe('05');
    expect(host.querySelector('.studio-timer-digits')?.textContent).toBe('05:00');
    expect(host.querySelector('.studio-editor-popover-heading')).toBeNull(); expect(host.querySelector('.studio-timer-footer')).toBeNull();
    await click('增加一分钟'); await click('减少一分钟');
    expect(onAction.mock.calls).toEqual([['set-duration', 360], ['set-duration', 300]]);
    await input('计时分钟', '2'); await input('计时秒数', '35'); await click('开始');
    expect(onAction).toHaveBeenLastCalledWith('start', 155);
    expect(host.querySelector('[aria-label="计时分钟"]')).not.toBeNull(); // The service response owns the running state.
  });

  it('sends shared running adjustments and replaces them with same-slot reset when paused', async () => {
    const onAction = vi.fn(), timer = timerState();
    await render(<TimerControl timer={timer} canEdit busy={false} onAction={onAction} />);
    expect(host.querySelector('[aria-label="剩余时间"]')?.textContent).toBe('02:05');
    expect(button('增加一分钟').disabled).toBe(false);
    await click('增加一分钟'); expect(onAction).toHaveBeenLastCalledWith('adjust', undefined, 60);
    await click('减少一分钟'); expect(onAction).toHaveBeenLastCalledWith('adjust', undefined, -60);
    expect(host.querySelector('[aria-label="剩余时间"]')?.textContent).toBe('02:05');
    await click('暂停'); expect(onAction).toHaveBeenLastCalledWith('pause', undefined);
    await render(<TimerControl timer={{ ...timer, paused: true, deadline: null }} canEdit busy={false} onAction={onAction} />);
    expect(host.querySelector('[aria-label="增加一分钟"]')).toBeNull();
    expect(button('重置').parentElement?.className).toBe('studio-timer-slot');
    await click('继续'); expect(onAction).toHaveBeenLastCalledWith('resume', undefined);
    await click('重置'); expect(onAction).toHaveBeenLastCalledWith('reset');
  });

  it('commits paused digits as a new shared duration and leaves cross-half drafts untouched until commit', async () => {
    const onAction = vi.fn(), timer = timerState({ paused: true, deadline: null });
    await render(<TimerControl timer={timer} canEdit busy={false} onAction={onAction} />);
    await act(async () => timerInput('计时分钟').focus());
    await type('计时分钟', '12');
    expect(timerInput('计时分钟').value).toBe('12'); expect(document.activeElement).toBe(timerInput('计时秒数')); expect(onAction).not.toHaveBeenCalled();
    await type('计时秒数', '34'); await key('计时秒数', 'Enter');
    expect(onAction).toHaveBeenLastCalledWith('set-duration', 754);
    await render(<TimerControl timer={timerState({ durationMs: 754000, remainingMs: 754000, deadline: null })} canEdit busy={false} onAction={onAction} />);
    expect(button('开始')).toBeDefined(); expect(button('增加一分钟')).toBeDefined(); expect(host.querySelector('[aria-label="重置"]')).toBeNull();
  });

  it('supports separated paste, keyboard field movement, arrow commit and Escape draft cancellation', async () => {
    const onAction = vi.fn(); await render(<TimerControl timer={null} canEdit busy={false} onAction={onAction} />); await click('共享计时器');
    for (const separator of [':', '.', ',']) {
      const node = timerInput('计时分钟'), paste = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: { getData: () => `3${separator}27` } });
      await act(async () => { node.focus(); node.dispatchEvent(paste); });
      expect(timerInput('计时分钟').value).toBe('03'); expect(timerInput('计时秒数').value).toBe('27'); expect(document.activeElement).toBe(timerInput('计时秒数'));
      await key('计时秒数', 'Escape'); expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(timerInput('计时分钟').value).toBe('05');
    }
    expect(onAction).not.toHaveBeenCalled();
    await key('计时秒数', 'ArrowLeft'); expect(document.activeElement).toBe(timerInput('计时分钟'));
    await key('计时分钟', '.'); expect(document.activeElement).toBe(timerInput('计时秒数'));
    await key('计时秒数', 'ArrowDown'); expect(timerInput('计时秒数').value).toBe('59'); expect(timerInput('计时分钟').value).toBe('05'); expect(onAction).not.toHaveBeenCalled();
    await key('计时秒数', 'ArrowDown', 'keyup'); expect(onAction).toHaveBeenLastCalledWith('set-duration', 359);
    await input('计时分钟', '0'); await input('计时秒数', '0'); await key('计时秒数', 'Enter');
    expect(onAction).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('至少为 1 秒');
  });

  it('uses whole-minute idle boundaries and forbids running nudges that would end or exceed the clock', async () => {
    const onAction = vi.fn(); await render(<TimerControl timer={timerState({ durationMs: 155000, remainingMs: 155000, deadline: null })} canEdit busy={false} onAction={onAction} />); await click('共享计时器');
    await click('增加一分钟'); expect(onAction).toHaveBeenLastCalledWith('set-duration', 180);
    await click('减少一分钟'); expect(onAction).toHaveBeenLastCalledWith('set-duration', 120);
    await render(<TimerControl timer={timerState({ durationMs: 5940000, remainingMs: 5940000, deadline: null })} canEdit busy={false} onAction={onAction} />);
    expect(button('增加一分钟').disabled).toBe(true);
    await render(<TimerControl timer={timerState({ durationMs: 5900000, remainingMs: 5970000, deadline: Date.now() + 5970000 })} canEdit busy={false} onAction={onAction} />);
    expect(button('增加一分钟').disabled).toBe(true); expect(button('减少一分钟').disabled).toBe(false);
    await render(<TimerControl timer={timerState({ remainingMs: 60000, deadline: Date.now() + 60000 })} canEdit busy={false} onAction={onAction} />);
    expect(button('减少一分钟').disabled).toBe(true);
  });

  it('restarts naturally ended timers with their shared duration and returns to idle after the reference linger', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T10:00:00Z')); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const onAction = vi.fn(), timer = timerState({ durationMs: 91000, remainingMs: 2000, deadline: Date.now() + 2000 });
    await render(<TimerControl timer={timer} canEdit busy={false} onAction={onAction} />);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(host.querySelector('[aria-label="剩余时间"]')?.textContent).toBe('00:00'); expect(button('开始').disabled).toBe(false);
    await click('开始'); expect(onAction).toHaveBeenLastCalledWith('start', undefined);
    await act(async () => vi.advanceTimersByTime(2500));
    expect(timerInput('计时分钟').value).toBe('01'); expect(timerInput('计时秒数').value).toBe('31'); expect(host.querySelector('[aria-label="计时状态"]')?.textContent).toBe('待开始');
  });

  it('updates the real deadline and gives viewers no timer mutation controls', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const timer = timerState({ durationMs: 2000, deadline: Date.now() + 2000, remainingMs: 2000 }), onAction = vi.fn();
    await render(<TimerControl timer={timer} canEdit={false} busy={false} onAction={onAction} />);
    await act(async () => vi.advanceTimersByTime(2000));
    expect(host.querySelector('[aria-label="剩余时间"]')?.textContent).toBe('00:00');
    expect(host.textContent).toContain('已结束');
    expect(host.querySelector('[aria-label="暂停"]')).toBeNull(); expect(host.querySelector('[aria-label="增加一分钟"]')).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps the full timer visible during canvas work without taking focus (paused=%s)', async paused => {
    const onAction = vi.fn(), onSelect = vi.fn();
    const example = (timer: RoomTimer | null) => <><button onClick={onSelect}>选择画布元素</button><input aria-label="画布输入" /><TimerControl timer={timer} canEdit busy={false} onAction={onAction} /></>;
    await render(example(null));
    const canvasInput = host.querySelector<HTMLInputElement>('[aria-label="画布输入"]')!;
    canvasInput.focus();
    await render(example(timerState({ paused, deadline: paused ? null : Date.now() + 125000 })));
    expect(host.querySelector('[role="dialog"][aria-label="共享计时器"]')).not.toBeNull();
    expect(document.activeElement).toBe(canvasInput);
    expect(button('共享计时器').textContent).toBe('');
    await click('选择画布元素');
    expect(onSelect).toHaveBeenCalledOnce();
    await act(async () => canvasInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(host.querySelector('.studio-timer-layout')).not.toBeNull();
    expect(document.activeElement).toBe(canvasInput);
    expect(onAction).not.toHaveBeenCalled();
    await click('共享计时器');
    expect(host.querySelector('.studio-timer-layout')).toBeNull();
    await click('共享计时器');
    expect(host.querySelector('.studio-timer-layout')).not.toBeNull();
  });
});

describe('non-modal editor popover', () => {
  it('keeps inside clicks inside when the anchor and an initially open popover mount together', async () => {
    const onClose = vi.fn(), onInside = vi.fn();
    function InitialPopover() { const anchor = useRef<HTMLButtonElement>(null); return <div><button ref={anchor}>触发点</button><EditorPopover title="初始浮层" anchorRef={anchor} onClose={onClose}><button onClick={onInside}>浮层操作</button></EditorPopover></div>; }
    await render(<InitialPopover />); await click('浮层操作');
    expect(onInside).toHaveBeenCalledOnce(); expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"]')?.parentElement).toBe(host.querySelector('.studio'));
  });
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

  it('clamps a narrow viewport, flips above a low anchor and follows scroll until that anchor is hidden', async () => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    let top = 560;
    const rect = (left: number, y: number, width: number, height: number): DOMRect => ({ left, top: y, right: left + width, bottom: y + height, x: left, y, width, height, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) { return this.classList.contains('studio-editor-popover') ? rect(0, 0, 376, 300) : this.tagName === 'BUTTON' && this.textContent === '打开' ? rect(360, top, 32, 32) : rect(0, 0, 0, 0); });
    try {
      await render(<Example />); await click('打开');
      const popover = host.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(popover.style.left).toBe('12px'); expect(popover.style.top).toBe('248px'); expect(popover.classList.contains('is-above')).toBe(true);
      top = 150; await act(async () => document.dispatchEvent(new Event('scroll')));
      expect(popover.style.top).toBe('192px'); expect(popover.classList.contains('is-above')).toBe(false);
      top = 650; await act(async () => document.dispatchEvent(new Event('scroll')));
      expect(host.querySelector('[role="dialog"]')).toBeNull();
    } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.width }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.height }); }
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
