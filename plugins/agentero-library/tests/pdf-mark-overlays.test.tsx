import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import type { ReaderMark } from '../src/contracts/reader';

const harness = vi.hoisted(() => ({ stateIndex: 0, page: undefined as any }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const index = harness.stateIndex++; return [index === 1 ? harness.page : initial, vi.fn()]; },
  useRef: (current: unknown) => ({ current }), useMemo: (compute: () => unknown) => compute(), useEffect: vi.fn(),
}));
vi.mock('../src/app/pdf-runtime', () => ({ pdfjs: {} }));
import { PageView } from '../src/app/pdf/PageView';

afterEach(() => { harness.stateIndex = 0; });
const mark = (id: string): ReaderMark => ({ id, kind: 'highlight', page: 1, space: 'pt', rects: [{ x: 10, y: 20, w: 100, h: 12 }, { x: 10, y: 45, w: 100, h: 12 }], quote: 'synthetic source', note: '', comment: `comment ${id}` });
function page(marks: ReaderMark[], selectedMark: string | null = null) {
  harness.page = { rotate: 0, userUnit: 1, view: [0, 0, 600, 800], getViewport: () => ({ width: 600, height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800 - y] }) };
  return renderToStaticMarkup(<PageView document={{} as any} number={1} active scale={1} rotation={0} tone="white" estimate={{ width: 600, height: 800 }} viewportRef={{ current: null }} marks={marks} selectedMark={selectedMark} cards={false} crop={false} onReady={vi.fn()} onMark={vi.fn()} onDestination={vi.fn()} onExternal={vi.fn()} onVisual={vi.fn()} onRendered={vi.fn()} />);
}

test('saved duplicate records share one fill path and active source has no leaf rectangle outlines', () => {
  const html = page([mark('a'), mark('b')], 'b');
  const overlay = html.match(/<svg class="pdf-mark-overlay"[\s\S]*?<\/svg>/)![0];
  expect(overlay.match(/fill-opacity="0.35"/g)).toHaveLength(1);
  expect(overlay).toContain('class="pdf-active-mark-source" d="M10 32h100 M10 57h100" fill="none"');
  expect(overlay).not.toContain('stroke="#fcd34d"');
});

test('comment pin is a dialogue bubble with a separate grouped-count badge', () => {
  const html = page([mark('a'), mark('b')]);
  expect(html).toContain('lucide-message-circle'); expect(html).toContain('class="pdf-mark-pin-count" aria-hidden="true">2</span>');
  expect(html).toContain('aria-expanded="false"'); expect(html).not.toContain('>•</button>');
});
