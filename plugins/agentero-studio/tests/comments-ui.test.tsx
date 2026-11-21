import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommentPopover, placeCommentPopover } from '../src/app/shared/comments/CommentPopover';
import { CommentThread, type RunCommentAction } from '../src/app/shared/comments/CommentThread';
import { CommentsPanel } from '../src/app/shared/comments/CommentsPanel';
import {
  commentBoardTip,
  describeCommentTarget,
  documentCommentTip,
  liveCommentPoint,
} from '../src/app/shared/comments/comment-target';
import {
  DEFAULT_STYLE,
  LOCAL_ACTOR,
  type Actor,
  type Anchor,
  type Board,
  type Feedback,
} from '../src/contracts/studio';
import { attachmentStatus, isAttachmentPending } from '../src/app/shared/comments/attachment';

let host: HTMLDivElement;
let root: Root;
const colleague: Actor = { id: 'colleague', name: '同事', kind: 'human', role: 'commenter' };
const feedback: Feedback = {
  id: 'thread',
  artifactId: 'board',
  type: 'comment',
  anchor: { elementIds: ['table'] },
  text: '请补充说明',
  author: colleague,
  status: 'open',
  createdAt: '2026-11-14T01:00:00Z',
  updatedAt: '2026-11-14T01:00:00Z',
  replies: [
    { id: 'reply', author: LOCAL_ACTOR, text: '我来补充', createdAt: '2026-11-14T01:01:00Z' },
  ],
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  host.className = 'studio';
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const action = () => vi.fn<RunCommentAction>(async (_action, item) => item);

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

function button(label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.getAttribute('aria-label') === label || node.textContent?.trim() === label,
  );

  if (!found) {
    throw new Error(`Missing button: ${label}`);
  }

  return found;
}

async function click(node: HTMLElement) {
  await act(async () => {
    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    node.click();
  });
}

async function change(node: HTMLTextAreaElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(node, text);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

function authorSelect() {
  return host.querySelector<HTMLSelectElement>('.studio-comment-author-filter select')!;
}

async function chooseAuthor(name: string) {
  const select = authorSelect();
  const option = [...select.options].find((item) => item.textContent === name);
  if (!option) {
    throw new Error(`Missing author: ${name}`);
  }

  await act(async () => {
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function visibleThreads() {
  return [...host.querySelectorAll('[data-feedback-id]')].map((node) =>
    node.getAttribute('data-feedback-id'),
  );
}

it('lists authors, first messages and reply counts and filters resolved threads through a checkbox', async () => {
  function Panel() {
    const [resolved, setResolved] = useState(false);

    return (
      <CommentsPanel
        feedback={[feedback, { ...feedback, id: 'resolved', status: 'resolved', text: '已经完成' }]}
        actor={LOCAL_ACTOR}
        busy={false}
        showResolved={resolved}
        onShowResolved={setResolved}
        onOpen={() => {}}
        onAction={action()}
        onAttach={async () => {}}
        renderSuggestion={() => null}
      />
    );
  }

  await render(<Panel />);
  expect(host.querySelectorAll('.studio-comment-list-item')).toHaveLength(1);
  expect(host.textContent).toContain('1 条回复');
  expect(host.textContent).not.toContain('添加备注');
  expect(host.querySelector('.studio-comment-list-item time')?.getAttribute('datetime')).toBe(
    feedback.createdAt,
  );
  const option = host.querySelector<HTMLInputElement>('.studio-comment-resolved-filter input')!;
  expect(option.checked).toBe(false);
  await click(option);
  expect(host.querySelectorAll('.studio-comment-list-item')).toHaveLength(2);
});

it('filters by thread author while keeping full numeric names and a separate mine scope', async () => {
  const other: Actor = { ...colleague, id: 'other', name: '10062' };
  const records: Feedback[] = [
    { ...feedback, id: 'colleague-thread' },
    { ...feedback, id: 'mine', author: LOCAL_ACTOR, replies: [] },
    { ...feedback, id: 'numeric', author: other, replies: [] },
  ];
  await render(
    <CommentsPanel
      feedback={records}
      actor={LOCAL_ACTOR}
      busy={false}
      showResolved={false}
      onShowResolved={() => {}}
      onOpen={() => {}}
      onAction={action()}
      onAttach={async () => {}}
      renderSuggestion={() => null}
    />,
  );
  expect(button('全部').getAttribute('aria-pressed')).toBe('true');
  expect(visibleThreads()).toEqual(['colleague-thread', 'mine', 'numeric']);
  await chooseAuthor('10062');
  expect(visibleThreads()).toEqual(['numeric']);
  await click(button('我发起'));
  expect(button('我发起').getAttribute('aria-pressed')).toBe('true');
  expect(authorSelect()).toBeNull();
  expect(visibleThreads()).toEqual(['mine']);
  await click(button('全部'));
  expect(visibleThreads()).toEqual(['numeric']);
  await chooseAuthor('所有作者');
  expect(visibleThreads()).toEqual(['colleague-thread', 'mine', 'numeric']);
});

it('opens a thread in the list and keeps a reply draft after collapse and author filtering', async () => {
  const onAction = action();
  const onAttach = vi.fn(async () => {});
  const own: Feedback = {
    ...feedback,
    id: 'another',
    author: { ...LOCAL_ACTOR, name: '我' },
    replies: [],
  };
  function Panel() {
    const [openFeedbackId, setOpen] = useState<string>();
    const [replyTextById, setReplies] = useState<Record<string, string>>({});

    return (
      <CommentsPanel
        feedback={[feedback, own]}
        actor={LOCAL_ACTOR}
        busy={false}
        showResolved={false}
        onShowResolved={() => {}}
        onOpen={(item) => setOpen(item.id)}
        onAction={onAction}
        onAttach={onAttach}
        renderSuggestion={() => null}
        renderAnchorNotice={(item) => <p data-notice-for={item.id}>原段落已更新</p>}
        openFeedbackId={openFeedbackId}
        onCloseFeedback={() => setOpen(undefined)}
        replyTextById={replyTextById}
        onReplyTextChange={(id, value) => setReplies((previous) => ({ ...previous, [id]: value }))}
      />
    );
  }

  await render(<Panel />);
  const thread = host.querySelector<HTMLElement>('[data-feedback-id="thread"]')!;
  expect(host.querySelector('[data-notice-for]')).toBeNull();
  await act(async () => {
    thread.focus();
    thread.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
  const reply = () =>
    host.querySelector<HTMLTextAreaElement>(
      '[data-feedback-id="thread"] .studio-reply-form textarea',
    )!;
  const attachmentCheckbox = () =>
    host.querySelector<HTMLInputElement>(
      '[data-feedback-id="thread"] .studio-reply-form input[type="checkbox"]',
    )!;
  expect(document.activeElement?.getAttribute('aria-label')).toBe('备注讨论 · 同事');
  expect(host.querySelector('[data-notice-for]')?.getAttribute('data-notice-for')).toBe('thread');
  expect(attachmentCheckbox().checked).toBe(false);
  await change(reply(), '稍后发送的回复');
  await click(button('关闭备注'));
  expect(document.activeElement).toBe(thread);
  expect(host.querySelector('[data-notice-for]')).toBeNull();
  expect(reply()).toBeNull();
  await click(thread);
  expect(reply().value).toBe('稍后发送的回复');
  await chooseAuthor('我');
  expect(visibleThreads()).toEqual(['another']);
  await chooseAuthor('所有作者');
  expect(reply()).toBeNull();
  await click(host.querySelector<HTMLElement>('[data-feedback-id="thread"]')!);
  expect(reply().value).toBe('稍后发送的回复');
  expect(attachmentCheckbox().checked).toBe(false);
  await click(attachmentCheckbox());
  await submit(reply().form!);
  expect(onAction).toHaveBeenCalledWith(
    'reply',
    feedback,
    expect.objectContaining({ text: '稍后发送的回复' }),
  );
  expect(onAttach).toHaveBeenCalledOnce();
  expect(reply().value).toBe('');
  expect(attachmentCheckbox().checked).toBe(false);
});

it('keeps expanded discussions read-only for viewers', async () => {
  await render(
    <CommentsPanel
      feedback={[feedback]}
      actor={{ ...colleague, role: 'viewer' }}
      busy={false}
      showResolved={false}
      onShowResolved={() => {}}
      onOpen={() => {}}
      onAction={action()}
      onAttach={async () => {}}
      renderSuggestion={() => null}
      openFeedbackId={feedback.id}
    />,
  );
  expect(host.textContent).toContain('我来补充');
  expect(host.querySelector('.studio-reply-form')).toBeNull();
  expect(host.querySelector('[aria-label="解决"]')).toBeNull();
  expect(host.textContent).not.toContain('附加到对话');
});

it('matches first-author editing and owner-or-first-author deletion without granting foreign commenter management', async () => {
  const onAction = action();
  await render(
    <CommentThread
      feedback={feedback}
      actor={colleague}
      busy={false}
      onAction={onAction}
      onAttach={async () => {}}
    />,
  );
  await click(button('备注操作'));
  expect(button('编辑')).toBeTruthy();
  expect(button('删除备注线程')).toBeTruthy();
  await render(
    <CommentThread
      key="foreign"
      feedback={feedback}
      actor={{ ...colleague, id: 'other' }}
      busy={false}
      onAction={onAction}
      onAttach={async () => {}}
    />,
  );
  await click(button('备注操作'));
  expect(
    [...host.querySelectorAll('button')].some((node) => node.textContent === '删除备注线程'),
  ).toBe(false);
  expect(host.querySelector('[aria-label=解决]')).toBeNull();
  await render(
    <CommentThread
      key="owner"
      feedback={feedback}
      actor={LOCAL_ACTOR}
      busy={false}
      onAction={onAction}
      onAttach={async () => {}}
    />,
  );
  await click(button('备注操作'));
  expect(button('删除备注线程')).toBeTruthy();
  expect([...host.querySelectorAll('button')].some((node) => node.textContent === '编辑')).toBe(
    false,
  );
});

it('requires inline deletion confirmation and keeps the thread open while operating its portaled menu', async () => {
  const onAction = action();
  const close = vi.fn();
  await render(
    <CommentPopover point={{ x: 200, y: 150 }} onClose={close}>
      <CommentThread
        feedback={feedback}
        actor={LOCAL_ACTOR}
        busy={false}
        onAction={onAction}
        onAttach={async () => {}}
      />
    </CommentPopover>,
  );
  expect(host.querySelector('.studio-comment-target')).toBeNull();
  await click(button('备注操作'));
  await click(button('删除备注线程'));
  expect(close).not.toHaveBeenCalled();
  expect(onAction).not.toHaveBeenCalled();
  await click(button('取消'));
  expect(host.querySelector('[aria-label=删除备注确认]')).toBeNull();
  await click(button('备注操作'));
  await click(button('删除备注线程'));
  await click(button('删除'));
  expect(onAction).toHaveBeenCalledExactlyOnceWith('delete', feedback, undefined);
});

it('edits individual own messages in place and retains an unsuccessful edit', async () => {
  const onAction = action().mockRejectedValueOnce(new Error('保存失败'));
  await render(
    <CommentThread
      feedback={feedback}
      actor={LOCAL_ACTOR}
      busy={false}
      onAction={onAction}
      onAttach={async () => {}}
    />,
  );
  await click(button('回复操作：我'));
  await click(button('编辑回复'));
  await change(host.querySelector<HTMLTextAreaElement>('[aria-label=编辑备注内容]')!, '补充完成');
  await submit(host.querySelector<HTMLFormElement>('.studio-comment-edit')!);
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label=编辑备注内容]')!.value).toBe(
    '补充完成',
  );
  expect(host.querySelector('[role=alert]')?.textContent).toBe('保存失败');
  await submit(host.querySelector<HTMLFormElement>('.studio-comment-edit')!);
  expect(onAction).toHaveBeenLastCalledWith('edit', feedback, {
    text: '补充完成',
    replyId: 'reply',
    expectedText: '我来补充',
  });
  expect(host.querySelector('.studio-comment-edit')).toBeNull();
});

it('offers a reply on resolved threads and retries a failed attachment without posting that reply again', async () => {
  const resolved = { ...feedback, status: 'resolved' as const };
  const onAction = action();
  const attach = vi
    .fn()
    .mockRejectedValueOnce(new Error('宿主暂不可用'))
    .mockResolvedValue(undefined);
  function Thread() {
    const [text, setText] = useState('重新讨论');

    return (
      <CommentThread
        feedback={resolved}
        actor={LOCAL_ACTOR}
        busy={false}
        onAction={onAction}
        onAttach={attach}
        replyText={text}
        onReplyTextChange={setText}
      />
    );
  }

  await render(<Thread />);
  expect(host.querySelector('textarea')?.getAttribute('placeholder')).toBe('回复以重新打开…');
  await click(host.querySelector<HTMLInputElement>('.studio-comment-compose-footer input')!);
  await submit(host.querySelector<HTMLFormElement>('.studio-reply-form')!);
  expect(onAction).toHaveBeenCalledExactlyOnceWith('reply', resolved, {
    text: '重新讨论',
    replyId: expect.any(String),
  });
  expect(button('重试附加回复').disabled).toBe(false);
  await submit(host.querySelector<HTMLFormElement>('.studio-reply-form')!);
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(attach).toHaveBeenCalledTimes(2);
});

it('retries attaching a saved edit without submitting the edit twice', async () => {
  const ownFeedback = { ...feedback, author: LOCAL_ACTOR };
  const onAction = action();
  const attach = vi.fn().mockRejectedValueOnce(new Error('暂不可用')).mockResolvedValue(undefined);
  await render(
    <CommentThread
      feedback={ownFeedback}
      actor={LOCAL_ACTOR}
      busy={false}
      onAction={onAction}
      onAttach={attach}
    />,
  );
  await click(button('备注操作'));
  await click(button('编辑'));
  await change(host.querySelector<HTMLTextAreaElement>('[aria-label=编辑备注内容]')!, '编辑后附加');
  await click(host.querySelector<HTMLInputElement>('.studio-comment-edit input')!);
  await submit(host.querySelector<HTMLFormElement>('.studio-comment-edit')!);
  expect(host.querySelector<HTMLTextAreaElement>('[aria-label=编辑备注内容]')!.disabled).toBe(true);
  await click(button('重试附加'));
  expect(onAction).toHaveBeenCalledExactlyOnceWith('edit', ownFeedback, {
    text: '编辑后附加',
    expectedText: ownFeedback.text,
  });
  expect(attach).toHaveBeenCalledTimes(2);
  expect(host.querySelector('.studio-comment-edit')).toBeNull();
});

it('flips the 330px composer at the viewport edge and tracks a moving live target', async () => {
  const placed = placeCommentPopover(
    { x: 950, y: 700 },
    { width: 330, height: 200 },
    { width: 1000, height: 800 },
  );
  expect(placed.left).toBe(614);
  expect(placed.top).toBe(500);
  const narrow = placeCommentPopover(
    { x: 200, y: 600 },
    { width: 330, height: 200 },
    { width: 400, height: 700 },
  );
  expect(narrow.left).toBe(62);
  expect(narrow.top + 200).toBeLessThan(600 - 28);
  let tick: FrameRequestCallback | undefined;
  let x = 100;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    tick = callback;

    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  await render(
    <CommentPopover draft label="表格" locate={() => ({ x, y: 150 })} onClose={() => {}}>
      输入
    </CommentPopover>,
  );
  const before = host.querySelector<HTMLElement>('.studio-comment-popover')!.style.left;
  x = 300;
  await act(async () => {
    tick?.(1);
  });
  expect(host.querySelector<HTMLElement>('.studio-comment-popover')!.style.left).not.toBe(before);
  const pin = host.querySelector<HTMLElement>('.studio-comment-pin.studio-comment-draft-pin')!;
  expect([pin.style.left, pin.style.top]).toEqual(['300px', '150px']);
  await render(
    <CommentPopover draft showDraftPin={false} locate={() => ({ x, y: 150 })} onClose={() => {}}>
      已保存
    </CommentPopover>,
  );
  expect(host.querySelector('.studio-comment-draft-pin')).toBeNull();
});

it('describes actual table content and resolves saved pin coordinates before stale click fallbacks', () => {
  const board: Board = {
    artifact: {
      id: 'board',
      type: 'whiteboard',
      title: '规划',
      revision: 1,
      createdAt: '',
      updatedAt: '',
      pinned: false,
    },
    style: DEFAULT_STYLE,
    elements: [
      {
        id: 'table',
        type: 'table',
        x: 10,
        y: 20,
        w: 200,
        h: 100,
        version: 1,
        data: {
          rows: [
            ['名称', '说明'],
            ['事项', '需要核对'],
          ],
        },
      },
    ],
  };
  expect(describeCommentTarget(board, { elementIds: ['table'] }, '对象 · table')).toBe(
    '表格，2 行 × 2 列，“名称，说明，事项，需要核对”',
  );
  host.innerHTML = '<span data-feedback-pin="thread"></span>';
  vi.spyOn(host.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
    left: 80,
    top: 90,
    bottom: 118,
    width: 28,
    height: 28,
  } as DOMRect);
  expect(
    liveCommentPoint(host, board, feedback.anchor, { x: 0, y: 0, zoom: 1 }, 'thread', {
      x: 999,
      y: 999,
    }),
  ).toEqual({ x: 80, y: 118 });
  host.innerHTML = '<div class="studio-canvas-viewport"></div>';
  vi.spyOn(host.firstElementChild!, 'getBoundingClientRect').mockReturnValue({
    left: 40,
    top: 60,
  } as DOMRect);
  const anchor = { elementIds: ['table'], coordinateSpace: 'element' as const, x: 0.92, y: 0.16 };
  const first = liveCommentPoint(host, board, anchor, { x: 100, y: 50, zoom: 0.5 })!;
  expect(first.x).toBeCloseTo(237);
  expect(first.y).toBeCloseTo(128);
  const panned = liveCommentPoint(host, board, anchor, { x: 150, y: 80, zoom: 0.5 })!;
  expect(panned.x - first.x).toBe(50);
  expect(panned.y - first.y).toBe(30);
});

it('keeps a canvas tip fixed independently of a moved or removed source target', () => {
  const source = { id: 'table', type: 'table', x: 10, y: 20, w: 200, h: 100, version: 1 } as const;
  const objectAnchor: Anchor = {
    elementIds: [source.id],
    coordinateSpace: 'element',
    x: 0.25,
    y: 0.5,
  };
  const fixedAnchor: Anchor = { ...objectAnchor, pin: { coordinateSpace: 'board', x: 40, y: 80 } };
  expect(commentBoardTip(objectAnchor, [source])).toEqual({ x: 60, y: 70 });
  expect(commentBoardTip(objectAnchor, [{ ...source, x: 120, y: 220 }])).toEqual({
    x: 170,
    y: 270,
  });
  expect(commentBoardTip(fixedAnchor, [{ ...source, x: 120, y: 220 }])).toEqual({ x: 40, y: 80 });
  expect(commentBoardTip(fixedAnchor, [])).toEqual({ x: 40, y: 80 });
});

it('projects a document tip into the actual expanded block and skips a hidden canvas pin', () => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  host.innerHTML =
    '<div class="studio-canvas-viewport"><div data-document-id="doc"><p data-document-block-id="first"></p></div><div class="studio-document-focus" data-document-id="doc"><p data-document-block-id="first"></p></div><span data-feedback-pin="thread"></span></div>';
  const inlineBlock = host.querySelector('[data-document-block-id="first"]')!;
  const focusBlock = host.querySelector('.studio-document-focus [data-document-block-id="first"]')!;
  function setRect(node: Element, rect: DOMRect) {
    vi.spyOn(node, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList);
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(rect);
  }

  setRect(inlineBlock, new DOMRect(20, 40, 200, 30));
  setRect(focusBlock, new DOMRect(40, 120, 300, 60));
  const anchor: Anchor = {
    coordinateSpace: 'document',
    elementIds: ['doc'],
    blockIds: ['first'],
    pin: { coordinateSpace: 'document', x: 0.25, y: 0.75 },
  };
  expect(
    documentCommentTip(host.querySelector<HTMLElement>('[data-document-id="doc"]')!, anchor),
  ).toEqual({ x: 70, y: 62.5 });
  expect(liveCommentPoint(host, null, anchor, undefined, 'thread')).toEqual({ x: 115, y: 165 });
  const board: Board = {
    artifact: {
      id: 'board',
      type: 'whiteboard',
      title: '规划',
      revision: 1,
      createdAt: '',
      updatedAt: '',
      pinned: false,
    },
    style: DEFAULT_STYLE,
    elements: [],
  };
  vi.spyOn(host.firstElementChild!, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 12, 500, 400),
  );
  expect(
    liveCommentPoint(
      host,
      board,
      { ...anchor, pin: { coordinateSpace: 'board', x: 600, y: 800 } },
      { x: 120, y: 33, zoom: 0.5 },
      'thread',
    ),
  ).toEqual({ x: 430, y: 445 });
});

it('shows pending, attaching and successful handoff without conflating them with resolution', async () => {
  const pending: Feedback = {
    ...feedback,
    status: 'pending',
    attachment: {
      requestId: 'request-1',
      contentKey: 'key',
      state: 'pending',
      requestedAt: feedback.createdAt,
      requestedBy: colleague,
    },
  };
  const props = { actor: LOCAL_ACTOR, busy: false, onAction: action(), onAttach: async () => {} };
  await render(<CommentThread {...props} feedback={pending} />);
  expect(host.querySelector('[role=status]')?.textContent).toBe('待附加到对话');
  expect(host.textContent).not.toContain('待房主处理');
  await render(<CommentThread {...props} feedback={pending} attaching />);
  expect(host.querySelector('[role=status]')?.textContent).toBe('附加中…');
  expect(button('备注操作').disabled).toBe(true);
  const attached: Feedback = {
    ...pending,
    status: 'resolved',
    attachment: {
      ...pending.attachment!,
      state: 'attached',
      attachedAt: feedback.updatedAt,
      attachedBy: LOCAL_ACTOR,
    },
  };
  await render(<CommentThread {...props} feedback={attached} />);
  expect(host.querySelector('[role=status]')?.textContent).toBe('已附加到对话');
  expect(host.textContent).toContain('已解决');
  expect(host.querySelector('textarea')?.getAttribute('placeholder')).toBe('回复以重新打开…');
});

it('locks a menu attachment immediately and exposes an explicit retry after host failure', async () => {
  let fail!: () => void;
  const attached = vi.fn<() => Promise<void>>();

  attached
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = () => reject(new Error('当前对话暂不可用'));
        }),
    )
    .mockResolvedValue(undefined);
  await render(
    <CommentThread
      feedback={{ ...feedback, status: 'pending' }}
      actor={LOCAL_ACTOR}
      busy={false}
      onAction={action()}
      onAttach={attached}
    />,
  );
  await click(button('备注操作'));
  const attachButton = button('附加到对话');
  await act(async () => {
    attachButton.click();
    attachButton.click();
  });
  expect(attached).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role=status]')?.textContent).toBe('附加中…');
  await act(async () => fail());
  expect(host.querySelector('[role=alert]')?.textContent).toBe('当前对话暂不可用');
  expect(host.querySelector('[role=status]')?.textContent).toBe('待附加到对话');
  await click(button('重试附加'));
  expect(attached).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role=alert]')).toBeNull();
});

it('keeps unresolved attachment requests visible and puts them first even when their discussion was resolved', async () => {
  const normal = { ...feedback, id: 'newer', createdAt: '2026-11-15T01:00:00Z' };
  const pending: Feedback = {
    ...feedback,
    id: 'pending',
    status: 'resolved',
    attachment: {
      requestId: 'request-1',
      contentKey: 'key',
      state: 'pending',
      requestedAt: feedback.createdAt,
      requestedBy: colleague,
    },
  };
  await render(
    <CommentsPanel
      feedback={[normal, pending]}
      actor={LOCAL_ACTOR}
      busy={false}
      showResolved={false}
      onShowResolved={() => {}}
      onOpen={() => {}}
      onAction={action()}
      onAttach={async () => {}}
      renderSuggestion={() => null}
    />,
  );
  expect(
    [...host.querySelectorAll('[data-feedback-id]')].map((node) =>
      node.getAttribute('data-feedback-id'),
    ),
  ).toEqual(['pending', 'newer']);
  expect(isAttachmentPending(pending)).toBe(true);
  expect(attachmentStatus({ ...feedback, status: 'pending' })).toBe('pending');
  expect(
    isAttachmentPending({ ...pending, attachment: { ...pending.attachment!, state: 'attached' } }),
  ).toBe(false);
});
