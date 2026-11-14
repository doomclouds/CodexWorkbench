import { afterEach, describe, expect, it, vi } from 'vitest';
import { feedbackDraft } from '../src/app/bridge';
import { createHostContextUpdater } from '../src/app/host-context';
import { LOCAL_ACTOR, type ArtifactView, type Feedback, type ViewContext } from '../src/contracts/studio';

afterEach(() => { vi.useRealTimers(); });

const context = (selectedIds: string[]): ViewContext => ({ artifactId: 'artifact-one', viewId: 'diagram', selectedIds, viewport: { x: 10, y: 20, zoom: 1.5 } });

describe('Studio host background context', () => {
  it('coalesces selection updates and excludes document data, credentials and arbitrary fields', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => {});
    const updater = createHostContextUpdater(send);
    updater.update(context(['old']));
    updater.update({ ...context(['new', 'new']), html: '<script>private content</script>', token: 'owner-secret', editingIds: ['private-edit'] });
    await vi.advanceTimersByTimeAsync(149);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledExactlyOnceWith({ artifactId: 'artifact-one', viewId: 'diagram', selectedIds: ['new'], selectedCount: 1, viewport: { x: 10, y: 20, zoom: 1.5 } });
    updater.update(context(['new']));
    await vi.advanceTimersByTimeAsync(150);
    expect(send).toHaveBeenCalledTimes(1);
    updater.close();
  });

  it('replaces the current background state when the editor closes', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => {});
    const updater = createHostContextUpdater(send);
    updater.update(context(['selected']));
    await vi.advanceTimersByTimeAsync(150);
    updater.update(null);
    await vi.advanceTimersByTimeAsync(150);
    expect(send).toHaveBeenLastCalledWith({ artifactId: null, viewId: null, selectedIds: [], selectedCount: 0 });
    updater.close();
  });

  it('serializes requests and sends the latest view after a pending acknowledgement', async () => {
    vi.useFakeTimers();
    let acknowledge!: () => void;
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { acknowledge = resolve; })).mockResolvedValue(undefined);
    const updater = createHostContextUpdater(send);
    updater.update(context(['first']));
    await vi.advanceTimersByTimeAsync(150);
    updater.update(context(['second']));
    updater.update(context(['latest']));
    await vi.advanceTimersByTimeAsync(150);
    expect(send).toHaveBeenCalledTimes(1);
    acknowledge();
    await vi.advanceTimersByTimeAsync(150);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0].selectedIds).toEqual(['latest']);
    updater.close();
  });

  it('quietly stops unsupported context updates and cancels teardown timers', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => { throw new Error('Method not found'); });
    const updater = createHostContextUpdater(send);
    updater.update(context(['first']));
    await vi.advanceTimersByTimeAsync(150);
    updater.update(context(['second']));
    await vi.advanceTimersByTimeAsync(150);
    expect(send).toHaveBeenCalledTimes(1);

    const another = createHostContextUpdater(send);
    another.update(context(['pending']));
    another.close();
    await vi.advanceTimersByTimeAsync(150);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

it('attaches generic artifact feedback as a draft that first requests source context', () => {
  const document: ArtifactView = { artifact: { id: 'artifact-one', type: 'future-product', title: '作品', revision: 1, pinned: false, createdAt: '', updatedAt: '' } };
  const feedback: Feedback = { id: 'feedback-one', artifactId: 'artifact-one', type: 'request', text: '请调整布局', anchor: { targetIds: ['node-one'] }, author: LOCAL_ACTOR, status: 'open', createdAt: '', updatedAt: '', replies: [] };
  const draft = feedbackDraft(feedback, document);
  expect(draft._meta['openai/message']).toEqual({ target: 'active', send: false });
  expect(draft.content[1]?.text).toContain('"artifactType":"future-product"');
  expect(draft.content[1]?.text).toContain('artifact_read 的 context 模式');
});
