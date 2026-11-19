// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { contrastRatio } from '../src/core/theme.js';
import { type Actor, type Feedback } from '../src/contracts/studio.js';
import { CommentAuthorAvatar, commentAuthorKey, commentAuthorStyle } from '../src/app/shared/comments/comment-author.js';
import { CommentPin } from '../src/app/shared/comments/CommentPin.js';
import { CommentPopover } from '../src/app/shared/comments/CommentPopover.js';
import { CommentThread } from '../src/app/shared/comments/CommentThread.js';
import { PARTICIPANT_COLORS } from '../src/app/shared/presence-members.js';

const lin: Actor = { id: 'guest-lin', name: '林悦', kind: 'human', role: 'commenter' };
const ada: Actor = { id: 'guest-ada', name: 'Ada Liu', kind: 'human', role: 'editor' };
const feedback: Feedback = {
  id: 'thread',
  artifactId: 'board',
  type: 'comment',
  anchor: { x: 100, y: 140 },
  text: '请核对尺寸。',
  author: lin,
  status: 'open',
  createdAt: '2026-11-19T02:00:00Z',
  updatedAt: '2026-11-19T02:01:00Z',
  replies: [{ id: 'reply', author: ada, text: '已核对。', createdAt: '2026-11-19T02:01:00Z' }],
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
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
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

it.each([
  ['林悦', '林'],
  ['𠮷田', '𠮷'],
  ['Ada Liu', 'AL'],
  ['e\u0301lodie Wong', 'E\u0301W'],
])('uses a readable abbreviation without splitting the first grapheme in %s', async (name, initials) => {
  await render(<CommentAuthorAvatar author={{ ...lin, name }} />);
  const avatar = host.querySelector('.studio-comment-avatar')!;
  expect(avatar.textContent).toBe(initials);
  expect(avatar.getAttribute('title')).toBe(name);
});

it.each([
  [{ ...lin, name: ' 10062 ' }, '10062'],
  [{ ...lin, name: '１２３' }, '１２３'],
  [{ ...lin, name: ' ' }, '协作者'],
  [{ ...lin, kind: 'agent' as const, name: '' }, 'Codex'],
])('uses an icon and the full author name for numeric, missing, and agent names', async (author, title) => {
  await render(<CommentAuthorAvatar author={author} />);
  const avatar = host.querySelector('.studio-comment-avatar')!;
  expect(avatar.textContent).toBe('');
  expect(avatar.querySelector('svg')).toBeTruthy();
  expect(avatar.getAttribute('title')).toBe(title);
});

it('derives identity and a readable foreground from the saved author rather than role, name, or presence', () => {
  const renamed = { ...lin, name: '林悦（新昵称）', role: 'editor' as const };
  expect(commentAuthorKey(renamed)).toBe(commentAuthorKey(lin));
  expect(commentAuthorStyle(renamed)).toEqual(commentAuthorStyle(lin));
  expect(commentAuthorKey({ ...lin, id: 'another-guest' })).not.toBe(commentAuthorKey(lin));

  const agent: Actor = { ...lin, id: 'connection-a', presentationId: 'reviewer', kind: 'agent' };
  const reconnected = { ...agent, id: 'connection-b' };
  expect(commentAuthorKey(reconnected)).toBe(commentAuthorKey(agent));
  expect(commentAuthorStyle(reconnected)).toEqual(commentAuthorStyle(agent));
  expect(commentAuthorKey({ ...lin, id: 'reviewer' })).not.toBe(commentAuthorKey(agent));

  const reached = Array.from({ length: PARTICIPANT_COLORS.length }, (_, index) => {
    const style = commentAuthorStyle({ ...agent, presentationId: String.fromCharCode(97 + index) });
    expect(contrastRatio(style.color!, style.backgroundColor!)).toBeGreaterThanOrEqual(4.5);
    return style.backgroundColor;
  });
  expect(new Set(reached)).toEqual(new Set(PARTICIPANT_COLORS));
});

it('keeps the same author and anchor on draft, saved, and resolved pins', async () => {
  const tip = { x: 100, y: 140 };
  await render(<CommentPopover point={tip} draft pinAuthor={lin} onClose={() => {}}>草稿</CommentPopover>);
  const draft = host.querySelector<HTMLElement>('.studio-comment-draft-pin')!;
  const style = { color: draft.style.color, backgroundColor: draft.style.backgroundColor };
  expect(draft.textContent).toBe('林');
  expect([draft.style.left, draft.style.top]).toEqual(['100px', '140px']);

  const onSelect = vi.fn();
  await render(<CommentPin feedback={feedback} left={tip.x} top={tip.y} zoom={2} onSelect={onSelect} />);
  const pin = host.querySelector<HTMLButtonElement>('[data-feedback-pin="thread"]')!;
  expect(pin.textContent).toBe('林');
  expect(pin.title).toContain(lin.name);
  expect(pin.getAttribute('aria-label')).toBe('备注 林悦：请核对尺寸。');
  expect(pin.style.backgroundColor).toBe(style.backgroundColor);
  expect(pin.style.color).toBe(style.color);
  expect([pin.style.left, pin.style.top, pin.style.transform]).toEqual(['100px', '140px', 'scale(0.5) translateY(-100%)']);
  vi.spyOn(pin, 'getBoundingClientRect').mockReturnValue(new DOMRect(tip.x, tip.y - 28, 28, 28));
  await act(async () => pin.click());
  expect(onSelect).toHaveBeenCalledWith(feedback, tip);

  await render(<CommentPin feedback={{ ...feedback, status: 'resolved' }} left={tip.x} top={tip.y} zoom={2} />);
  expect(pin.querySelector('.studio-comment-pin-check')).toBeTruthy();
  expect(pin.getAttribute('aria-label')).toBe('备注 林悦（已解决）：请核对尺寸。');
  expect(pin.style.backgroundColor).toBe(style.backgroundColor);
  expect([pin.style.left, pin.style.top]).toEqual(['100px', '140px']);
});

it('shows separate author marks for a shared thread and its reply', async () => {
  await render(<CommentThread feedback={feedback} actor={ada} busy={false} onAction={async (_action, item) => item} onAttach={async () => {}} />);
  const avatars = [...host.querySelectorAll<HTMLElement>('.studio-comment-avatar')];
  expect(avatars.map(avatar => avatar.textContent)).toEqual(['林', 'AL']);
  expect(avatars.map(avatar => avatar.title)).toEqual([lin.name, ada.name]);
  expect(host.textContent).toContain(ada.name);
  expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(false);
});
