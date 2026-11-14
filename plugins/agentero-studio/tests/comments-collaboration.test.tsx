// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { StudioService } from '../src/core/service.js';
import { CommentThread, type RunCommentAction } from '../src/app/shared/comments/CommentThread.js';
import type { Actor, Feedback } from '../src/contracts/studio.js';

const author: Actor = { id: 'author', name: 'Author', kind: 'human', role: 'commenter' };
let service: StudioService, directory: string, artifactId: string, initial: Feedback;
const views: { root: Root; host: HTMLDivElement }[] = [];
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  directory = await mkdtemp(join(tmpdir(), 'studio-comments-ui-'));
  service = new StudioService({ dataRoot: directory });
  artifactId = (await service.execute('artifact_manage', { action: 'create' })).artifact.id;
  initial = (await service.execute('artifact_feedback', { artifactId, action: 'create', text: 'Original' }, author)).feedback[0];
});
afterEach(async () => {
  for (const view of views.splice(0)) { await act(async () => view.root.unmount()); view.host.remove(); }
  vi.restoreAllMocks(); await service.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected test directory');
  await rm(directory, { recursive: true, force: true });
});
function createView(reply = '', intercept?: (item: Feedback) => Promise<void>) {
  const host = document.createElement('div'); host.className = 'studio'; document.body.append(host);
  const root = createRoot(host); views.push({ root, host });
  let refresh!: (item: Feedback) => void;
  let currentActor = author;
  const attached = vi.fn(async () => {});
  const action = vi.fn<RunCommentAction>(async (name, item, args) => {
    const result = await service.execute('artifact_feedback', { artifactId, action: name, feedbackId: item.id, ...args }, currentActor);
    const next = result.feedback.find((entry: Feedback) => entry.id === item.id) as Feedback;
    await intercept?.(next);
    refresh(next); return next;
  });
  function Thread({ actor }: { actor: Actor }) {
    const [item, setItem] = useState(initial), [text, setText] = useState(reply); refresh = setItem;
    return <CommentThread feedback={item} actor={actor} busy={false} onAction={action} onAttach={attached} replyText={text} onReplyTextChange={setText} />;
  }
  return { host, action, attached, refresh: async (item: Feedback) => { await act(async () => refresh(item)); }, render: async (actor = author) => { currentActor = actor; await act(async () => root.render(<Thread actor={actor} />)); } };
}
function button(host: HTMLElement, label: string) { const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(value => value.getAttribute('aria-label') === label || value.textContent?.trim() === label); if (!node) throw new Error(`Missing button: ${label}`); return node; }
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function change(node: HTMLTextAreaElement, text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, text); node.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function submit(form: HTMLFormElement) { await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
async function finish(view: ReturnType<typeof createView>) { await act(async () => { await view.action.mock.results.at(-1)!.value.catch(() => {}); }); }

it('retries a real committed reply with the same ID after a deferred lost ACK and attaches nothing by default', async () => {
  let rejectAck!: () => void, count = 0;
  const view = createView('Reply draft', async () => { if (++count === 1) await new Promise<void>((_resolve, reject) => { rejectAck = () => reject(new Error('响应丢失')); }); });
  await view.render();
  await submit(view.host.querySelector<HTMLFormElement>('.studio-reply-form')!);
  await vi.waitFor(() => expect(rejectAck).toBeTypeOf('function'));
  const first = view.action.mock.calls[0]![2]!;
  expect(first).toEqual({ text: 'Reply draft', replyId: expect.any(String) });
  expect(view.host.querySelector('textarea')?.disabled).toBe(true);
  await act(async () => rejectAck()); await finish(view);
  expect(view.host.querySelector('textarea')?.value).toBe('Reply draft');
  expect(view.host.querySelector('[role=alert]')?.textContent).toBe('响应丢失');
  await submit(view.host.querySelector<HTMLFormElement>('.studio-reply-form')!); await finish(view);
  expect(view.action.mock.calls[1]![2]).toEqual(first);
  expect((await service.store.read(artifactId)).feedback[0]!.replies).toHaveLength(1);
  expect(view.host.querySelector('textarea')?.value).toBe('');
  expect(view.attached).not.toHaveBeenCalled();
});

it('allocates a different reply ID after the user changes failed text', async () => {
  const view = createView('First draft');
  view.action.mockRejectedValueOnce(new Error('网络未发送'));
  await view.render();
  await submit(view.host.querySelector<HTMLFormElement>('.studio-reply-form')!); await finish(view);
  const firstId = view.action.mock.calls[0]![2]!.replyId;
  await change(view.host.querySelector('textarea')!, 'Second draft');
  await submit(view.host.querySelector<HTMLFormElement>('.studio-reply-form')!); await finish(view);
  expect(view.action.mock.calls[1]![2]).toEqual({ text: 'Second draft', replyId: expect.any(String) });
  expect(view.action.mock.calls[1]![2]!.replyId).not.toBe(firstId);
  expect((await service.store.read(artifactId)).feedback[0]!.replies.map(reply => reply.text)).toEqual(['Second draft']);
});

it('preserves a second window edit and its original base after a real same-author conflict and remote refresh', async () => {
  const first = createView(), second = createView(); await first.render(); await second.render();
  for (const view of [first, second]) { await click(button(view.host, '备注操作')); await click(button(view.host, '编辑')); }
  await change(first.host.querySelector('textarea')!, 'Window A'); await change(second.host.querySelector('textarea')!, 'Window B');
  await submit(first.host.querySelector<HTMLFormElement>('.studio-comment-edit')!); await finish(first);
  const shared = (await service.execute('artifact_feedback', { artifactId, action: 'list' }, author)).feedback[0] as Feedback;
  await second.refresh(shared);
  await submit(second.host.querySelector<HTMLFormElement>('.studio-comment-edit')!); await finish(second);
  expect(second.host.querySelector('textarea')?.value).toBe('Window B');
  expect(second.host.querySelector('[role=alert]')?.textContent).toContain('其他窗口修改');
  expect(second.action.mock.calls[0]![2]).toEqual({ text: 'Window B', expectedText: 'Original' });
  await submit(second.host.querySelector<HTMLFormElement>('.studio-comment-edit')!); await finish(second);
  expect(second.action.mock.calls[1]![2]!.expectedText).toBe('Original');
  expect((await service.store.read(artifactId)).feedback[0]!.text).toBe('Window A');
});

it('keeps edit and reply drafts read-only after author downgrade and rejects stale form submissions', async () => {
  const view = createView('Unsent reply'); await view.render();
  await click(button(view.host, '备注操作')); await click(button(view.host, '编辑'));
  await change(view.host.querySelector('textarea')!, 'Unsent edit');
  await view.render({ ...author, role: 'viewer' });
  expect(view.host.querySelector('textarea')?.value).toBe('Unsent edit');
  expect(view.host.querySelector('textarea')?.readOnly).toBe(true);
  expect(button(view.host, '保存').disabled).toBe(true);
  expect(view.host.querySelector('[aria-label=备注操作]')).toBeNull();
  await submit(view.host.querySelector<HTMLFormElement>('.studio-comment-edit')!);
  expect(view.action).not.toHaveBeenCalled();
  await click(button(view.host, '取消'));
  expect(view.host.querySelector('textarea')?.value).toBe('Unsent reply');
  expect(view.host.querySelector('textarea')?.readOnly).toBe(true);
  expect(view.host.querySelector('[aria-label=发送回复]')).toBeNull();
  await submit(view.host.querySelector<HTMLFormElement>('.studio-reply-form')!);
  expect(view.action).not.toHaveBeenCalled();
});

it('disables an already-open delete confirmation after an author viewer downgrade', async () => {
  const view = createView(); await view.render();
  await click(button(view.host, '备注操作')); await click(button(view.host, '删除备注线程'));
  await view.render({ ...author, role: 'viewer' });
  expect(button(view.host, '删除').disabled).toBe(true);
  await click(button(view.host, '删除'));
  expect(view.action).not.toHaveBeenCalled();
  expect((await service.store.read(artifactId)).feedback).toHaveLength(1);
});

it('names the processor and lets a human owner explicitly clear its marker without offering another agent a takeover', async () => {
  const processor: Actor = { id: 'agent-a', name: 'Agent A', kind: 'agent', role: 'owner' };
  const processing = (await service.execute('artifact_feedback', { artifactId, feedbackId: initial.id, action: 'processing' }, processor)).feedback[0] as Feedback;
  const owner = createView(); await owner.render(service.owner); await owner.refresh(processing);
  expect(owner.host.querySelector('.studio-feedback-status')?.textContent).toBe('Agent A 正在处理');
  await click(button(owner.host, '备注操作'));
  expect(button(owner.host, '重新打开备注').title).toContain('仅清除处理标记');
  expect(button(owner.host, '重新打开备注').title).toContain('不会因此中断');
  const other = createView(); await other.render({ ...processor, id: 'agent-b', name: 'Agent B' }); await other.refresh(processing);
  expect(other.host.querySelector('[aria-label=解决]')).toBeNull();
  await click(button(other.host, '备注操作'));
  expect([...other.host.querySelectorAll('button')].some(node => node.textContent?.includes('重新打开'))).toBe(false);
  await click(button(owner.host, '重新打开备注')); await finish(owner);
  expect(owner.action).toHaveBeenCalledExactlyOnceWith('reopen', processing, undefined);
  const shared = (await service.store.read(artifactId)).feedback[0]!;
  expect(shared.status).toBe('open'); expect(shared.processingBy).toBeUndefined();
});
