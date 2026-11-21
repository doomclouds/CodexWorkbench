import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_ACTOR, type Feedback } from '../../src/contracts/studio.js';
import {
  CommentClusters,
  overlappingCommentGroups,
} from '../../src/app/shared/comments/CommentClusters.js';

const entry = (id: string, extra: Partial<Feedback> = {}): Feedback => ({
  id,
  artifactId: 'board',
  type: 'comment',
  anchor: { x: 1, y: 1 },
  author: LOCAL_ACTOR,
  text: '备注 ' + id,
  status: 'open',
  createdAt: '',
  updatedAt: '',
  replies: [],
  ...extra,
});
const box = (left: number, top: number, width = 28, height = 28) =>
  new DOMRect(left, top, width, height);
const footprint = (id: string, x: number, y: number) => ({ id, rect: box(x, y) });
const alice = { ...LOCAL_ACTOR, id: 'alice', name: 'Alice Lee' };
const lin = { ...LOCAL_ACTOR, id: 'lin', name: '林悦' };
const notes = [
  entry('a', { author: lin }),
  entry('b', { author: alice, status: 'resolved' }),
  entry('c', { author: lin }),
];

describe('comment footprint groups', () => {
  it('groups overlaps transitively in source order and separates touching edges', () => {
    const pins = [
      footprint('c', 40, 20),
      footprint('a', 0, 20),
      footprint('b', 20, 20),
      footprint('right', 68, 20),
      footprint('below', 0, 48),
    ];
    expect(overlappingCommentGroups(pins).map((group) => group.map((pin) => pin.id))).toEqual([
      ['c', 'a', 'b'],
    ]);
  });

  it('groups coincident pins and leaves a different row alone', () => {
    expect(
      overlappingCommentGroups([
        footprint('a', 58, 60),
        footprint('b', 58, 60),
        footprint('c', 58, 100),
      ]).map((group) => group.length),
    ).toEqual([2]);
  });
});

let host: HTMLDivElement;
let root: Root;
let positions: Map<string, DOMRect>;
let scroller: DOMRect;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  positions = new Map([
    ['a', box(90, 100)],
    ['b', box(100, 104)],
    ['c', box(270, 220)],
  ]);
  scroller = box(20, 20, 500, 300);
  frames = new Map();
  let nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);

    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames.delete(id);
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('studio-canvas-viewport')) {
      return box(20, 20, 500, 300);
    }
    if (this.classList.contains('studio-document-scroll')) {
      return scroller;
    }
    if (this.dataset.feedbackPin) {
      return positions.get(this.dataset.feedbackPin) ?? box(0, 0, 0, 0);
    }

    return box(70, 60, 60, 28);
  });
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    const rect = this.getBoundingClientRect();
    const values = rect.width > 0 && rect.height > 0 ? [rect] : [];

    return Object.assign(values, { item: (index: number) => values[index] ?? null });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type SelectCluster = Parameters<typeof CommentClusters>[0]['onSelect'];

function Harness({
  active,
  enabled = true,
  onSelect = () => {},
  children,
}: {
  active?: string;
  enabled?: boolean;
  onSelect?: SelectCluster;
  children?: React.ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);

  return (
    <div className="studio">
      <div className="studio-whiteboard">
        <div className="studio-canvas-viewport" ref={viewport}>
          <button data-feedback-pin="a">原备注 a</button>
          <div className="studio-document-scroll">
            <button data-feedback-pin="b" inert>
              原备注 b
            </button>
          </div>
          <button data-feedback-pin="c">原备注 c</button>
          {children}
          {enabled && (
            <CommentClusters
              containerRef={viewport}
              activities={notes}
              activeFeedbackId={active}
              onSelect={onSelect}
            />
          )}
        </div>
      </div>
    </div>
  );
}

async function render(props?: Parameters<typeof Harness>[0]) {
  await act(async () => root.render(<Harness {...props} />));
}

async function paint() {
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) {
      callback(0);
    }
  });
}

const pin = (id: string) =>
  host.querySelector<HTMLButtonElement>('[data-feedback-pin="' + id + '"]')!;
const capsule = () => host.querySelector<HTMLButtonElement>('button[data-comment-cluster]');

describe('comment cluster overlay', () => {
  it('uses the original tip to open an individual note and keeps it in place until closed', async () => {
    const selected = vi.fn();
    await render({ onSelect: selected });
    await paint();
    expect(capsule()?.textContent).toContain('2 条');
    expect(pin('a').hasAttribute('data-comment-clustered')).toBe(true);
    expect(pin('a').hasAttribute('inert')).toBe(true);
    expect(pin('b').hasAttribute('data-comment-clustered')).toBe(true);
    expect(pin('c').hasAttribute('data-comment-clustered')).toBe(false);

    await act(async () => capsule()!.click());
    const row = host.querySelector<HTMLButtonElement>('[data-comment-cluster-member="b"]')!;
    expect(row.textContent).toContain('Alice Lee');
    expect(row.textContent).toContain('已解决');
    await act(async () => row.click());
    expect(selected).toHaveBeenCalledExactlyOnceWith(notes[1], { x: 100, y: 132 });

    await render({ active: 'b' });
    await paint();
    expect(capsule()).toBeNull();
    expect(pin('a').hasAttribute('data-comment-clustered')).toBe(true);
    expect(pin('b').hasAttribute('data-comment-clustered')).toBe(false);
    expect(pin('b').hasAttribute('inert')).toBe(true);
    expect(pin('b').getBoundingClientRect()).toEqual(box(100, 104));

    await render();
    await paint();
    expect(capsule()).not.toBeNull();
    await render({ enabled: false });
    expect(pin('a').hasAttribute('inert')).toBe(false);
    expect(pin('b').hasAttribute('inert')).toBe(true);
    expect(pin('b').hasAttribute('data-comment-clustered')).toBe(false);
  });

  it('uses clipped footprints and coalesces movement, scroll and resize into one frame', async () => {
    positions.set('a', box(65, 32));
    positions.set('b', box(67, 45));
    scroller = box(20, 62, 500, 300);
    await render();
    await paint();
    expect(capsule()).toBeNull();

    scroller = box(20, 55, 500, 300);
    const scroll = host.querySelector('.studio-document-scroll')!;
    await act(async () => {
      scroll.dispatchEvent(new Event('scroll'));
      scroll.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
    });
    expect(frames.size).toBe(1);
    await paint();
    expect(capsule()).not.toBeNull();

    positions.set('b', box(67, 5));
    await act(async () => scroll.dispatchEvent(new Event('scroll')));
    await paint();
    expect(capsule()).toBeNull();
    expect(pin('a').hasAttribute('inert')).toBe(false);
  });

  it('places Escape focus back on the originating cluster without selecting a note', async () => {
    const selected = vi.fn();
    await render({ onSelect: selected });
    await paint();
    const trigger = capsule()!;
    trigger.focus();
    await act(async () => trigger.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      ),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(selected).not.toHaveBeenCalled();
  });
});
