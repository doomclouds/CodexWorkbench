import type { FilePickerCancelResult, FilePickerResult } from '../contracts/picker';

type PickerRpc = (name: string, args: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
interface PendingPicker {
  requestId: string;
  cancellation?: Promise<void>;
  cancellationAttempted: boolean;
}

/** Each instance belongs to one App. Cancellation never targets another App's IDs. */
export function createPickerClient(rpc: PickerRpc, newId: () => string = () => crypto.randomUUID()) {
  const pending = new Map<string, PendingPicker>();

  function cancel(picker: PendingPicker): Promise<void> {
    if (picker.cancellation) return picker.cancellation;
    picker.cancellationAttempted = true;
    const attempt = (async () => {
      // This is a separate request, deliberately without the aborted chooser signal.
      const result = await rpc('file_picker_cancel', { requestId: picker.requestId }) as FilePickerCancelResult;
      if (result?.closed !== true || result.requestId !== picker.requestId) throw new Error('未能确认系统选择器已关闭，请重试。');
      pending.delete(picker.requestId);
    })();
    picker.cancellation = attempt;
    void attempt.catch(() => { if (picker.cancellation === attempt) picker.cancellation = undefined; });
    return attempt;
  }

  async function pick(args: Record<string, unknown>, options: { signal?: AbortSignal } = {}): Promise<FilePickerResult> {
    options.signal?.throwIfAborted();
    const picker: PendingPicker = { requestId: newId(), cancellationAttempted: false };
    pending.set(picker.requestId, picker);
    const abort = () => { void cancel(picker).catch(() => {}); };
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      return await rpc('file_picker', { ...args, requestId: picker.requestId }, options) as FilePickerResult;
    } catch (error) {
      // A transport rejection does not prove that the native helper has stopped.
      void cancel(picker).catch(() => {});
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (!picker.cancellationAttempted) pending.delete(picker.requestId);
    }
  }

  async function cancelAll(): Promise<void> {
    await Promise.all([...pending.values()].map(cancel));
  }

  return { pick, cancelAll };
}
