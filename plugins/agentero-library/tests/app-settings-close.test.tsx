import type { ReactElement, ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

// Exercise the rendered handler without creating a browser or a native dialog.
const harness = vi.hoisted(() => ({ cancel: vi.fn(), setters: [] as ReturnType<typeof vi.fn>[] }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const set = vi.fn(); harness.setters.push(set);
    return [typeof initial === 'function' ? (initial as () => unknown)() : initial, set];
  },
}));
vi.mock('../src/app/api', () => ({ callTool: vi.fn() }));
vi.mock('../src/app/bridge', () => ({ cancelAppPickers: harness.cancel }));
import { SettingsPanel } from '../src/app/SettingsPanel';

afterEach(() => { harness.cancel.mockReset(); harness.setters.length = 0; });
function find(node: ReactNode, predicate: (node: ReactElement<Record<string, any>>) => boolean): ReactElement<Record<string, any>> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== 'object' || !('props' in node)) return;
  const element = node as ReactElement<Record<string, any>>;
  return predicate(element) ? element : find(element.props.children, predicate);
}

it('Settings close keeps the view mounted until its chooser cancellation ACK', async () => {
  let acknowledge!: () => void;
  harness.cancel.mockImplementation(() => new Promise<void>(resolve => { acknowledge = resolve; }));
  const onClose = vi.fn();
  const view = SettingsPanel({ settings: null, status: null, preview: false, dirty: false, onClose, onSaved: vi.fn() });
  const close = find(view, node => node.props['aria-label'] === '关闭设置')!;
  close.props.onClick(); close.props.onClick();
  expect(harness.cancel).toHaveBeenCalledTimes(1); expect(onClose).not.toHaveBeenCalled();
  acknowledge(); await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

it('failed cancellation preserves Settings, reports the failure and allows close retry', async () => {
  harness.cancel.mockRejectedValueOnce(new Error('temporary disconnect')).mockResolvedValueOnce(undefined);
  const onClose = vi.fn();
  const view = SettingsPanel({ settings: null, status: null, preview: false, dirty: false, onClose, onSaved: vi.fn() });
  const close = find(view, node => node.props['aria-label'] === '关闭设置')!;
  close.props.onClick();
  await vi.waitFor(() => expect(harness.setters.some(set => set.mock.calls.some(([value]) => typeof value === 'string' && value.includes('设置已保留')))).toBe(true));
  expect(onClose).not.toHaveBeenCalled();
  close.props.onClick(); await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(harness.cancel).toHaveBeenCalledTimes(2);
});
