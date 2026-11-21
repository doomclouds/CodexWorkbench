import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import {
  DEFAULT_STYLE,
  type Board,
  type BoardElement,
  type StudioClient,
} from '../src/contracts/studio';
import {
  forgetLibraryPreviews,
  LIBRARY_PREVIEW_FRAME_LIMIT,
  LIBRARY_PREVIEW_LIMIT,
  rememberLibraryPreview,
  useLibraryPreviews,
  type LibraryPreview,
  type LibraryPreviews,
} from '../src/app/library-preview';
import { projectWhiteboardPreview } from '../src/app/products/whiteboard';

const preview: LibraryPreview = { paper: '#fff', frames: [] };

it('bounds the preview cache and evicts the least recently stored board', () => {
  let entries: LibraryPreviews = new Map();
  for (let index = 0; index < LIBRARY_PREVIEW_LIMIT; index++) {
    entries = rememberLibraryPreview(entries, `board-${index}`, preview);
  }
  entries = rememberLibraryPreview(entries, 'board-0', preview);
  entries = rememberLibraryPreview(entries, 'board-new', preview);

  expect(entries.size).toBe(LIBRARY_PREVIEW_LIMIT);
  expect(entries.has('board-0')).toBe(true);
  expect(entries.has('board-1')).toBe(false);
  expect(forgetLibraryPreviews(entries, ['board-new']).has('board-new')).toBe(false);
  expect(entries.has('board-new')).toBe(true);
});

it('copies only bounded fallback geometry and text from a full board', () => {
  const elements: BoardElement[] = Array.from(
    { length: LIBRARY_PREVIEW_FRAME_LIMIT + 5 },
    (_, index) => ({
      id: `shape-${index}`,
      type: 'html',
      x: index,
      y: 0,
      w: 120,
      h: 80,
      version: 0,
      html: '<main>large document</main>'.repeat(300),
      text: '标题'.repeat(500),
    }),
  );
  const stroke: BoardElement = { ...elements[0]!, id: 'ignored-stroke', type: 'stroke' };
  const board: Board = {
    artifact: {
      id: 'shape-board',
      type: 'whiteboard',
      title: '白板',
      revision: 0,
      pinned: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    style: { ...DEFAULT_STYLE },
    elements: [stroke, ...elements],
  };

  const snapshot = projectWhiteboardPreview(board);
  expect(snapshot.frames).toHaveLength(LIBRARY_PREVIEW_FRAME_LIMIT);
  expect(snapshot.frames[0]).toEqual({
    id: 'shape-0',
    x: 0,
    y: 0,
    w: 120,
    h: 80,
    radius: 7,
    fill: '#fff',
    stroke: '#a8b0bd',
    label: '标题'.repeat(14),
  });
  elements[0]!.x = 99;
  board.style.paper = '#000';

  expect(snapshot.frames[0]?.x).toBe(0);
  expect(snapshot.paper).toBe(DEFAULT_STYLE.paper);
});

function CacheFixture({ client, ownerId }: { client: StudioClient; ownerId: string | null }) {
  const { previews, rememberPreview, forgetPreviews } = useLibraryPreviews(client, ownerId);

  return (
    <>
      <output>{previews.size}</output>
      <button onClick={() => rememberPreview('visited', preview)}>存入</button>
      <button onClick={() => forgetPreviews(['visited'])}>移除</button>
    </>
  );
}

it('forgets cached boards on deletion, permission loss, and transport replacement', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const call = async () => {
    throw new Error('Unexpected tool request from preview cache');
  };
  const client: StudioClient = { call, embedded: false };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const show = (ownerId: string | null, transport = client) =>
    act(async () => {
      root.render(<CacheFixture client={transport} ownerId={ownerId} />);
    });
  const click = (index: number) =>
    act(async () => {
      container.querySelectorAll('button')[index]!.click();
    });
  const size = () => container.querySelector('output')?.textContent;
  try {
    await show('me');
    await click(0);
    expect(size()).toBe('1');
    await click(1);
    expect(size()).toBe('0');
    await click(0);
    await show(null);
    expect(size()).toBe('0');
    await click(0);
    expect(size()).toBe('0');
    await show('me');
    expect(size()).toBe('0');
    await click(0);
    await show('me', { call, embedded: false });
    expect(size()).toBe('0');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
