import { describe, expect, it, vi } from 'vitest';
import { createPickerClient } from '../src/app/picker-client';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const one = '7b0378f0-5bb5-4bb9-9000-000000000001';
const two = '7b0378f0-5bb5-4bb9-9000-000000000002';
const cancelled = { cancelled: true, paths: [] };

describe('App-owned chooser lifecycle', () => {
  it('assigns fresh IDs centrally and forgets completed or user-cancelled choosers', async () => {
    const rpc = vi.fn(async () => cancelled);
    const newId = vi.fn().mockReturnValueOnce(one).mockReturnValueOnce(two);
    const client = createPickerClient(rpc, newId);
    await client.pick({ mode: 'open-file', requestId: 'caller-cannot-choose-another-app-id' });
    await client.pick({ mode: 'save-file', defaultPath: '论文.pdf' });
    await client.cancelAll();
    expect(rpc.mock.calls).toEqual([
      ['file_picker', { mode: 'open-file', requestId: one }, {}],
      ['file_picker', { mode: 'save-file', defaultPath: '论文.pdf', requestId: two }, {}],
    ]);
  });

  it('sends independent cancellation even when the host does not forward the chooser signal', async () => {
    const selection = deferred<unknown>(); const acknowledgement = deferred<unknown>();
    const rpc = vi.fn((name: string) => name === 'file_picker' ? selection.promise : acknowledgement.promise);
    const client = createPickerClient(rpc, () => one);
    const controller = new AbortController();
    const result = client.pick({ mode: 'open-directory' }, { signal: controller.signal });
    controller.abort();
    expect(rpc.mock.calls[1]).toEqual(['file_picker_cancel', { requestId: one }]);
    let closed = false;
    const close = client.cancelAll().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
    acknowledgement.resolve({ requestId: one, closed: true });
    await close; expect(closed).toBe(true);
    selection.resolve(cancelled); await result;
    await client.cancelAll(); expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('retains failed cancellation for a retry and never acknowledges a mismatched request', async () => {
    const selection = deferred<unknown>();
    const rpc = vi.fn(async (name: string) => {
      if (name === 'file_picker') return selection.promise;
      return rpc.mock.calls.filter(call => call[0] === 'file_picker_cancel').length === 1
        ? { requestId: two, closed: true } : { requestId: one, closed: true };
    });
    const client = createPickerClient(rpc, () => one);
    const result = client.pick({ mode: 'open-file' });
    await expect(client.cancelAll()).rejects.toThrow('未能确认系统选择器已关闭');
    await client.cancelAll();
    selection.resolve(cancelled); await result;
    expect(rpc.mock.calls.filter(call => call[0] === 'file_picker_cancel')).toHaveLength(2);
  });

  it('keeps retryable IDs after local RPC abort rather than assuming the native process exited', async () => {
    const selection = deferred<unknown>();
    let attempts = 0;
    const rpc = vi.fn(async (name: string) => {
      if (name === 'file_picker') return selection.promise;
      if (++attempts === 1) throw new Error('host temporarily unavailable');
      return { requestId: one, closed: true };
    });
    const client = createPickerClient(rpc, () => one);
    const result = client.pick({ mode: 'open-file' }).catch(error => error);
    selection.reject(new Error('local request aborted'));
    expect((await result).message).toBe('local request aborted');
    await vi.waitFor(() => expect(attempts).toBe(1));
    await client.cancelAll();
    expect(attempts).toBe(2);
  });

  it('cancels only this App IDs and coalesces overlapping close and teardown requests', async () => {
    const selection = deferred<unknown>(); const acknowledgement = deferred<unknown>();
    const rpc = vi.fn((name: string, args: Record<string, unknown>) => name === 'file_picker' ? selection.promise : acknowledgement.promise.then(() => ({ requestId: args.requestId, closed: true })));
    const first = createPickerClient(rpc, () => one);
    const second = createPickerClient(rpc, () => two);
    const firstResult = first.pick({ mode: 'open-file' }); const secondResult = second.pick({ mode: 'save-file' });
    const close = first.cancelAll(); const teardown = first.cancelAll();
    expect(rpc.mock.calls.filter(call => call[0] === 'file_picker_cancel')).toEqual([['file_picker_cancel', { requestId: one }]]);
    acknowledgement.resolve(undefined); await Promise.all([close, teardown]);
    await second.cancelAll();
    expect(rpc.mock.calls.filter(call => call[0] === 'file_picker_cancel').map(call => call[1].requestId)).toEqual([one, two]);
    selection.resolve(cancelled); await Promise.all([firstResult, secondResult]);
  });

  it('does not send a chooser when its caller was already aborted', async () => {
    const rpc = vi.fn(async () => cancelled); const client = createPickerClient(rpc, () => one);
    const controller = new AbortController(); controller.abort();
    await expect(client.pick({ mode: 'open-file' }, { signal: controller.signal })).rejects.toThrow();
    await client.cancelAll(); expect(rpc).not.toHaveBeenCalled();
  });
});
