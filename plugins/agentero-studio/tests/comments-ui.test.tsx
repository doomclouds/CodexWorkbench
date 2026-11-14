// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommentPopover, placeCommentPopover } from '../src/app/shared/comments/CommentPopover';
import { CommentThread, type RunCommentAction } from '../src/app/shared/comments/CommentThread';
import { CommentsPanel } from '../src/app/shared/comments/CommentsPanel';
import { describeCommentTarget, liveCommentPoint } from '../src/app/shared/comments/comment-target';
import { DEFAULT_STYLE, LOCAL_ACTOR, type Actor, type Board, type Feedback } from '../src/contracts/studio';

let host: HTMLDivElement, root: Root;
const colleague: Actor = { id: 'colleague', name: '同事', kind: 'human', role: 'commenter' };
const feedback: Feedback = { id: 'thread', artifactId: 'board', type: 'comment', anchor: { elementIds: ['table'] }, text: '请补充说明', author: colleague, status: 'open', createdAt: '2026-11-14T01:00:00Z', updatedAt: '2026-11-14T01:00:00Z', replies: [{ id: 'reply', author: LOCAL_ACTOR, text: '我来补充', createdAt: '2026-11-14T01:01:00Z' }] };
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); host.className = 'studio'; document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const action = () => vi.fn<RunCommentAction>(async (_action, item) => item);
async function render(node: ReactNode) { await act(async () => root.render(node)); }
function button(label: string) { const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label); if (!found) throw new Error(`Missing button: ${label}`); return found; }
async function click(node: HTMLElement) { await act(async () => { node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); node.click(); }); }
async function change(node: HTMLTextAreaElement, text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, text); node.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function submit(form: HTMLFormElement) { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }

it('lists authors, first messages and reply counts and filters resolved threads through a menu', async () => {
  function Panel() { const [resolved, setResolved] = useState(false); return <CommentsPanel feedback={[feedback, { ...feedback, id: 'resolved', status: 'resolved', text: '已经完成' }]} actor={LOCAL_ACTOR} busy={false} showResolved={resolved} onShowResolved={setResolved} onOpen={() => {}} onAction={action()} onAttach={async () => {}} renderSuggestion={() => null} />; }
  await render(<Panel />);
  expect(host.querySelectorAll('.studio-comment-list-item')).toHaveLength(1);
  expect(host.textContent).toContain('1 条回复');
  expect(host.textContent).not.toContain('添加备注');
  expect(host.querySelector('.studio-comment-list-item time')?.getAttribute('datetime')).toBe(feedback.createdAt);
  await click(button('筛选备注'));
  const option = host.querySelector<HTMLButtonElement>('[role=menuitemcheckbox]')!;
  expect(option.getAttribute('aria-checked')).toBe('false');
  await click(option);
  expect(host.querySelectorAll('.studio-comment-list-item')).toHaveLength(2);
});

it('matches first-author editing and owner-or-first-author deletion without granting foreign commenter management', async () => {
  const onAction = action();
  await render(<CommentThread feedback={feedback} actor={colleague} busy={false} onAction={onAction} onAttach={async () => {}} />);
  await click(button('备注操作'));
  expect(button('编辑')).toBeTruthy(); expect(button('删除备注线程')).toBeTruthy();
  await render(<CommentThread key="foreign" feedback={feedback} actor={{ ...colleague, id: 'other' }} busy={false} onAction={onAction} onAttach={async () => {}} />);
  await click(button('备注操作'));
  expect([...host.querySelectorAll('button')].some(node => node.textContent === '删除备注线程')).toBe(false);
  expect(host.querySelector('[aria-label=解决]')).toBeNull();
  await render(<CommentThread key="owner" feedback={feedback} actor={LOCAL_ACTOR} busy={false} onAction={onAction} onAttach={async () => {}} />);
  await click(button('备注操作'));
  expect(button('删除备注线程')).toBeTruthy();
  expect([...host.querySelectorAll('button')].some(node => node.textContent === '编辑')).toBe(false);
});

it('requires inline deletion confirmation and keeps the thread open while operating its portaled menu', async () => {
  const onAction = action(), close = vi.fn();
  await render(<CommentPopover point={{ x: 200, y: 150 }} onClose={close}><CommentThread feedback={feedback} actor={LOCAL_ACTOR} busy={false} onAction={onAction} onAttach={async () => {}} /></CommentPopover>);
  expect(host.querySelector('.studio-comment-target')).toBeNull();
  await click(button('备注操作')); await click(button('删除备注线程'));
  expect(close).not.toHaveBeenCalled(); expect(onAction).not.toHaveBeenCalled();
  await click(button('取消')); expect(host.querySelector('[aria-label=删除备注确认]')).toBeNull();
  await click(button('备注操作')); await click(button('删除备注线程')); await click(button('删除'));
  expect(onAction).toHaveBeenCalledExactlyOnceWith('delete', feedback, undefined);
});

it('edits individual own messages in place and retains an unsuccessful edit', async () => {
  const onAction = action().mockRejectedValueOnce(new Error('保存失败'));
  await render(<CommentThread feedback={feedback} actor={LOCAL_ACTOR} busy={false} onAction={onAction} onAttach={async () => {}} />);
  await click(button('回复操作：我')); await click(button('编辑回复'));
  await change(host.querySelector<HTMLTextAreaElement>('[aria-label=编辑备注内容]')!, '补充完成');
  await submit(host.querySelector<HTMLFormElement>('.studio-comment-edit')!);
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label=编辑备注内容]')!.value).toBe('补充完成');
  expect(host.querySelector('[role=alert]')?.textContent).toBe('保存失败');
  await submit(host.querySelector<HTMLFormElement>('.studio-comment-edit')!);
  expect(onAction).toHaveBeenLastCalledWith('edit', feedback, { text: '补充完成', replyId: 'reply', expectedText: '我来补充' });
  expect(host.querySelector('.studio-comment-edit')).toBeNull();
});

it('offers a reply on resolved threads and retries a failed attachment without posting that reply again', async () => {
  const resolved = { ...feedback, status: 'resolved' as const }, onAction = action(), attach = vi.fn().mockRejectedValueOnce(new Error('宿主暂不可用')).mockResolvedValue(undefined);
  function Thread() { const [text, setText] = useState('重新讨论'); return <CommentThread feedback={resolved} actor={LOCAL_ACTOR} busy={false} onAction={onAction} onAttach={attach} replyText={text} onReplyTextChange={setText} />; }
  await render(<Thread />);
  expect(host.querySelector('textarea')?.getAttribute('placeholder')).toBe('回复以重新打开…');
  await click(host.querySelector<HTMLInputElement>('.studio-comment-compose-footer input')!);
  await submit(host.querySelector<HTMLFormElement>('.studio-reply-form')!);
  expect(onAction).toHaveBeenCalledExactlyOnceWith('reply', resolved, { text: '重新讨论', replyId: expect.any(String) });
  expect(button('重试附加回复').disabled).toBe(false);
  await submit(host.querySelector<HTMLFormElement>('.studio-reply-form')!);
  expect(onAction).toHaveBeenCalledTimes(1); expect(attach).toHaveBeenCalledTimes(2);
});

it('retries attaching a saved edit without submitting the edit twice', async () => {
  const ownFeedback = { ...feedback, author: LOCAL_ACTOR }, onAction = action(), attach = vi.fn().mockRejectedValueOnce(new Error('暂不可用')).mockResolvedValue(undefined);
  await render(<CommentThread feedback={ownFeedback} actor={LOCAL_ACTOR} busy={false} onAction={onAction} onAttach={attach} />);
  await click(button('备注操作')); await click(button('编辑'));
  await change(host.querySelector<HTMLTextAreaElement>('[aria-label=编辑备注内容]')!, '编辑后附加');
  await click(host.querySelector<HTMLInputElement>('.studio-comment-edit input')!);
  await submit(host.querySelector<HTMLFormElement>('.studio-comment-edit')!);
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label=编辑备注内容]')!.disabled).toBe(true);
  await click(button('重试附加'));
  expect(onAction).toHaveBeenCalledExactlyOnceWith('edit', ownFeedback, { text: '编辑后附加', expectedText: ownFeedback.text });
  expect(attach).toHaveBeenCalledTimes(2); expect(host.querySelector('.studio-comment-edit')).toBeNull();
});

it('flips the 330px composer at the viewport edge and tracks a moving live target', async () => {
  const placed = placeCommentPopover({ x: 950, y: 700 }, { width: 330, height: 200 }, { width: 1000, height: 800 });
  expect(placed.left).toBe(614); expect(placed.top).toBe(536);
  let tick: FrameRequestCallback | undefined, x = 100;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { tick = callback; return 1; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  await render(<CommentPopover draft label="表格" locate={() => ({ x, y: 150 })} onClose={() => {}}>输入</CommentPopover>);
  const before = host.querySelector<HTMLElement>('.studio-comment-popover')!.style.left;
  x = 300; await act(async () => { tick?.(1); });
  expect(host.querySelector<HTMLElement>('.studio-comment-popover')!.style.left).not.toBe(before);
});

it('describes actual table content and resolves saved pin coordinates before stale click fallbacks', () => {
  const board: Board = { artifact: { id: 'board', type: 'whiteboard', title: '规划', revision: 1, createdAt: '', updatedAt: '', pinned: false }, style: DEFAULT_STYLE, elements: [{ id: 'table', type: 'table', x: 10, y: 20, w: 200, h: 100, version: 1, data: { rows: [['名称', '说明'], ['事项', '需要核对']] } }] };
  expect(describeCommentTarget(board, { elementIds: ['table'] }, '对象 · table')).toBe('表格，2 行 × 2 列，“名称，说明，事项，需要核对”');
  host.innerHTML = '<span data-feedback-pin="thread"></span>';
  vi.spyOn(host.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ left: 80, top: 90, width: 22, height: 22 } as DOMRect);
  expect(liveCommentPoint(host, board, feedback.anchor, { x: 0, y: 0, zoom: 1 }, 'thread', { x: 999, y: 999 })).toEqual({ x: 80, y: 90, width: 22, height: 22 });
  host.innerHTML = '';
});
