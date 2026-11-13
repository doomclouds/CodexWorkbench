import type { ReactElement, ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ReaderMark } from '../src/contracts/reader';

const harness = vi.hoisted(() => ({ states: [] as any[], stateIndex: 0, refs: [] as { current: any }[], refIndex: 0, layouts: [] as (() => void)[], effects: [] as (() => void)[], events: new Map<string, (event: any) => void>() }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: any) => { const index = harness.stateIndex++; if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial; return [harness.states[index], (next: any) => { harness.states[index] = typeof next === 'function' ? next(harness.states[index]) : next; }]; },
  useRef: (initial: any) => { const index = harness.refIndex++; return harness.refs[index] ??= { current: initial === null ? { getBoundingClientRect: () => ({ width: 310, height: 280 }), contains: () => false } : initial }; },
  useLayoutEffect: (effect: () => void) => harness.layouts.push(effect), useEffect: (effect: () => void) => harness.effects.push(effect),
}));
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }));
import { MarkPopover } from '../src/app/pdf/MarkPopover';

afterEach(() => { harness.states = []; harness.refs = []; harness.layouts = []; harness.effects = []; harness.events.clear(); vi.unstubAllGlobals(); });
function find(node: ReactNode, predicate: (node: ReactElement<Record<string, any>>) => boolean): ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== 'object' || !('props' in node)) return;
  const element = node as ReactElement<Record<string, any>>; return predicate(element) ? element : find(element.props.children, predicate);
}
const mark = (id: string): ReaderMark => ({ id, kind: 'highlight', page: 7, space: 'pt', rects: [], quote: `source ${id}`, note: '', comment: `saved ${id}` });
function setup(overrides: Record<string, unknown> = {}) {
  const addEventListener = (name: string, callback: (event: any) => void) => { harness.events.set(name, callback); };
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800, addEventListener, removeEventListener: vi.fn() });
  vi.stubGlobal('document', { body: {}, addEventListener, removeEventListener: vi.fn() });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const drafts = new Map<string, string>(), onSelect = vi.fn(), onClose = vi.fn(), onSave = vi.fn(async () => {}), onActiveChange = vi.fn();
  const props = { marks: [mark('a'), mark('b')], anchor: { isConnected: true, getBoundingClientRect: () => ({ left: 510, top: 274, right: 532, bottom: 296 }), focus: vi.fn(), contains: () => false } as unknown as HTMLElement, viewport: { clientWidth: 600, clientHeight: 780, getBoundingClientRect: () => ({ left: 10, top: 20, right: 610, bottom: 800 }), addEventListener, removeEventListener: vi.fn() } as unknown as HTMLElement, sourceBounds: () => ({ left: 50, top: 300, right: 500, bottom: 350 }), textBounds: () => [{ left: 10, top: 20, right: 610, bottom: 800 }], drafts, onSelect, onClose, onSave, onActiveChange, ...overrides };
  const render = () => { harness.stateIndex = 0; harness.refIndex = 0; harness.layouts = []; harness.effects = []; return MarkPopover(props) as ReactElement<{ style: { left: number; top: number } }>; };
  return { props, drafts, onSelect, onClose, onSave, onActiveChange, render };
}

test('dense text opens inline and only an explicit full editor action selects the mark', () => {
  const ctx = setup(); let view = ctx.render(); harness.layouts[0]();
  expect(ctx.onSelect).not.toHaveBeenCalled(); view = ctx.render();
  expect(view.props.style.left).toBeGreaterThanOrEqual(18); expect(view.props.style.top + 280).toBeLessThanOrEqual(792);
  find(view, node => node.type === 'button' && node.props.children === '在批注面板编辑')!.props.onClick();
  expect(ctx.onSelect).toHaveBeenCalledWith(ctx.props.marks[0], undefined);
});

test('close and adjacent selection keep per-mark drafts, and full editing receives the current draft', () => {
  const ctx = setup(); let view = ctx.render();
  find(view, node => node.type === 'textarea')!.props.onChange({ target: { value: 'unsaved a' } });
  expect(ctx.drafts.get('a')).toBe('unsaved a'); view = ctx.render();
  find(view, node => node.type === 'select')!.props.onChange({ target: { value: 'b' } }); view = ctx.render();
  expect(find(view, node => node.type === 'textarea')!.props.value).toBe('saved b'); expect(ctx.onActiveChange).toHaveBeenCalledWith('b');
  find(view, node => node.type === 'select')!.props.onChange({ target: { value: 'a' } }); view = ctx.render();
  expect(find(view, node => node.type === 'textarea')!.props.value).toBe('unsaved a');
  find(view, node => node.props['aria-label'] === '关闭页内批注')!.props.onClick(); expect(ctx.onClose).toHaveBeenCalledOnce();
  expect(ctx.drafts.get('a')).toBe('unsaved a');
  find(view, node => node.type === 'button' && node.props.children === '在批注面板编辑')!.props.onClick(); expect(ctx.onSelect).toHaveBeenCalledWith(ctx.props.marks[0], 'unsaved a');
  harness.states = []; harness.refs = []; view = ctx.render(); expect(find(view, node => node.type === 'textarea')!.props.value).toBe('unsaved a');
});

test('save failure retains draft and Escape consumes the key before closing the preview', async () => {
  const ctx = setup({ onSave: vi.fn(async () => { throw new Error('write failed'); }) }); let view = ctx.render();
  find(view, node => node.type === 'textarea')!.props.onChange({ target: { value: 'keep me' } }); view = ctx.render();
  find(view, node => node.type === 'button' && node.props.className === 'primary')!.props.onClick(); await Promise.resolve(); view = ctx.render();
  expect(ctx.drafts.get('a')).toBe('keep me'); expect(find(view, node => node.props.role === 'alert')!.props.children).toBe('write failed');
  harness.effects[0](); const event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() }; harness.events.get('keydown')!(event);
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(event.stopImmediatePropagation).toHaveBeenCalledOnce(); expect(ctx.onClose).toHaveBeenCalledOnce(); expect(ctx.drafts.get('a')).toBe('keep me');
});

test('outside dismissal preserves the draft and only successful save clears it', async () => {
  vi.stubGlobal('Node', class {}); const ctx = setup(); let view = ctx.render();
  find(view, node => node.type === 'textarea')!.props.onChange({ target: { value: 'new comment' } }); view = ctx.render(); harness.effects[0]();
  harness.events.get('pointerdown')!({ target: new Node() }); expect(ctx.onClose).toHaveBeenCalledOnce(); expect(ctx.drafts.get('a')).toBe('new comment');
  const save = find(view, node => node.type === 'button' && node.props.className === 'primary')!;
  save.props.onClick(); save.props.onClick(); await Promise.resolve();
  expect(ctx.onSave).toHaveBeenCalledOnce(); expect(ctx.onSave).toHaveBeenCalledWith(ctx.props.marks[0], 'new comment'); expect(ctx.drafts.has('a')).toBe(false);
});
