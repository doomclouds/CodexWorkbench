import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  BoardSuggestion,
  SuggestionAppliedReceipt,
  SuggestionPreviewFrame,
  SuggestionService,
} from '../../src/data/suggestions/index.js';
import { BoardSuggestionsSurface } from '../../src/surfaces/board-suggestions/index.js';
import type { BoardSuggestionsSurfaceProps } from '../../src/surfaces/board-suggestions/index.js';
import { createControlFixture } from '../support/render-control.js';

const boardId = 'active-board';
const proposalId = 'visible-suggestion';
const optionId = 'proposal-option';
const commandId = 'review-once';
const proposal: BoardSuggestion = {
  proposalId,
  sourceId: 'frozen-source',
  observation: '移动选区内的小卡片。',
  proposalVersion: 0n,
  expiresAtMillis: 1_800_000_000_000n,
  options: [{ optionId, label: '移动右侧卡片', description: '保持其他内容原样。' }],
  activeOptionIds: [],
  rejected: false,
};
const changes = { revision: 6n, objects: [], removedIds: [], order: [], payloads: [] };
const previewFrame: SuggestionPreviewFrame = { boardId, proposalId, optionId, changes };
const applied: SuggestionAppliedReceipt = { boardId, commandId, kind: 'applied', ...changes };
const attachedReference = {
  sourceId: 'frozen-source',
  capturedBoardRevision: 5n,
  targetsBoardRevision: 5n,
  targets: [
    {
      objectId: 'selected-one',
      kind: 'shape',
      geometryVersion: 0n,
      geometry: { x: 10, y: 20, width: 100, height: 50, rotation: 0 },
    },
  ],
};

let view: ReturnType<typeof createControlFixture>;
let anchor: HTMLButtonElement;

beforeEach(() => {
  view = createControlFixture();
  anchor = document.createElement('button');
  document.body.append(anchor);
});

afterEach(() => {
  view.dispose();
  anchor.remove();
});

function suggestionService() {
  return {
    createReviewSource: vi.fn<SuggestionService['createReviewSource']>(async () => ({
      boardId,
      ...attachedReference,
      objectIds: ['selected-one'],
      feedbackThreadId: 'from-thread',
    })),
    listSuggestions: vi.fn<SuggestionService['listSuggestions']>(async () => ({
      proposals: [proposal],
    })),
    previewSuggestion: vi.fn<SuggestionService['previewSuggestion']>(async () => ({
      kind: 'preview',
      frame: previewFrame,
    })),
    acceptSuggestion: vi.fn<SuggestionService['acceptSuggestion']>(async () => applied),
    rejectSuggestion: vi.fn<SuggestionService['rejectSuggestion']>(async () => ({
      ...proposal,
      rejected: true,
    })),
    getAcceptReceipt: vi.fn<SuggestionService['getAcceptReceipt']>(async () => undefined),
  };
}

function render(service: SuggestionService, options: Partial<BoardSuggestionsSurfaceProps> = {}) {
  const onApplied = vi.fn<BoardSuggestionsSurfaceProps['onApplied']>();
  const defaultProps = {
    anchor,
    boardId,
    revision: 5n,
    service,
    createCommandId: () => commandId,
    onApplied,
    onRequestClose: vi.fn(),
    restoreFocus: vi.fn(),
    renderPreview: () => <div>此区域只读</div>,
    ...options,
  };

  function rerender(next: Partial<BoardSuggestionsSurfaceProps> = {}) {
    view.render(<BoardSuggestionsSurface {...defaultProps} {...next} />);
  }

  rerender();

  return { onApplied, rerender };
}

function action(label: string): HTMLButtonElement {
  const target = [...view.host.querySelectorAll('button')].find(
    (button) =>
      button.getAttribute('aria-label') === label || button.textContent?.startsWith(label),
  );

  if (!target) {
    throw new Error('Missing suggestion action ' + label);
  }

  return target;
}

async function click(label: string) {
  await act(async () => action(label).click());
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

it('shows a newly arrived private suggestion without closing the active panel', async () => {
  const service = suggestionService();
  service.listSuggestions.mockResolvedValueOnce({ proposals: [] });
  const { rerender } = render(service, { updateKey: 'instance:0' });
  await settle();
  expect(view.host.textContent).toContain('暂无私人建议');
  rerender({ updateKey: 'instance:1' });
  await settle();
  expect(view.host.textContent).toContain(proposal.observation);
  expect(service.listSuggestions).toHaveBeenCalledTimes(2);
});

it('previews an inactive option only while hovered, then applies it on click', async () => {
  const service = suggestionService();
  const renderPreview = vi.fn(() => <div>此区域只读</div>);
  const { onApplied } = render(service, { renderPreview });
  await settle();
  const option = action('移动右侧卡片');
  expect(option.getAttribute('aria-pressed')).toBe('false');
  await act(async () => {
    option.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  expect(service.previewSuggestion).toHaveBeenCalledOnce();
  expect(service.acceptSuggestion).not.toHaveBeenCalled();
  expect(renderPreview).toHaveBeenCalledWith(previewFrame);
  expect(view.host.querySelector('[aria-label="只读方案预览"]')).not.toBeNull();

  await act(async () => {
    option.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  });
  expect(view.host.querySelector('[aria-label="只读方案预览"]')).toBeNull();
  await click('移动右侧卡片');
  expect(service.acceptSuggestion.mock.calls[0]?.[0]).toEqual({
    boardId,
    proposalId,
    optionId,
    expectedProposalVersion: 0n,
    commandId,
  });
  expect(onApplied).toHaveBeenCalledExactlyOnceWith(applied);
});

it('dismisses an applied suggestion card without a change to the underlying board', async () => {
  const service = suggestionService();
  service.listSuggestions
    .mockResolvedValueOnce({ proposals: [{ ...proposal, activeOptionIds: [optionId] }] })
    .mockResolvedValueOnce({ proposals: [] });
  const { onApplied } = render(service);
  await settle();

  expect(action('移动右侧卡片').getAttribute('aria-pressed')).toBe('true');
  await click('清除建议，保留已应用内容');
  expect(service.rejectSuggestion.mock.calls[0]?.[0]).toEqual({
    boardId,
    proposalId,
    expectedProposalVersion: 0n,
    commandId,
  });
  expect(service.acceptSuggestion).not.toHaveBeenCalled();
  expect(onApplied).not.toHaveBeenCalled();
  expect(view.host.textContent).toContain('已清除建议，保留已应用内容');
  expect(view.host.querySelector('.board-suggestion-card')).toBeNull();
});

it('withdraws an active option with the latest version and keeps the option reusable', async () => {
  const service = suggestionService();
  service.listSuggestions
    .mockResolvedValueOnce({
      proposals: [{ ...proposal, proposalVersion: 2n, activeOptionIds: [optionId] }],
    })
    .mockResolvedValueOnce({ proposals: [{ ...proposal, proposalVersion: 3n }] });
  const { onApplied } = render(service);
  await settle();
  await act(async () => action('移动右侧卡片').focus());
  expect(service.previewSuggestion).not.toHaveBeenCalled();

  await click('移动右侧卡片');

  expect(service.acceptSuggestion.mock.calls[0]?.[0]).toMatchObject({
    optionId,
    expectedProposalVersion: 2n,
    commandId,
  });
  expect(onApplied).toHaveBeenCalledExactlyOnceWith(applied);
  expect(action('移动右侧卡片').getAttribute('aria-pressed')).toBe('false');
  expect(action('移动右侧卡片').disabled).toBe(false);
  expect(view.host.textContent).toContain('已撤回方案并保存白板');
});

it('retains the original acceptance after closing the notes outlet and recovers it from the receipt', async () => {
  const service = suggestionService();
  service.acceptSuggestion.mockRejectedValueOnce(new Error('连接中断'));
  service.getAcceptReceipt.mockResolvedValueOnce(undefined).mockResolvedValueOnce(applied);
  const inline = {
    outlet: null,
    previewHost: null,
    showCards: true,
    onCardsVisibleChange: vi.fn<(visible: boolean) => void>(),
  };
  const { onApplied, rerender } = render(service, { anchor: null, inline });
  const outlet = document.createElement('div');
  view.host.append(outlet);
  rerender({ inline: { ...inline, outlet } });
  await settle();
  await click('移动右侧卡片');
  expect(view.host.textContent).toContain('审阅结果待确认');

  rerender({ inline });
  expect(outlet.childElementCount).toBe(0);
  rerender({ inline: { ...inline, outlet } });
  await settle();
  await click('核对原回执');
  expect(service.acceptSuggestion).toHaveBeenCalledOnce();
  expect(service.getAcceptReceipt.mock.calls.map(([board, command]) => [board, command])).toEqual([
    [boardId, commandId],
    [boardId, commandId],
  ]);
  expect(onApplied).toHaveBeenCalledExactlyOnceWith(applied);
});

it('reports a conflicting preview and updates the list without making an edit', async () => {
  const service = suggestionService();
  service.previewSuggestion.mockResolvedValueOnce({ kind: 'conflict', revision: 7n });
  const { onApplied } = render(service);
  await settle();
  await act(async () => action('移动右侧卡片').focus());

  expect(view.host.textContent).toContain('白板或建议已更新');
  expect(service.listSuggestions).toHaveBeenCalledTimes(2);
  expect(service.acceptSuggestion).not.toHaveBeenCalled();
  expect(onApplied).not.toHaveBeenCalled();
});

it('sends only the frozen reference after an explicit attachment action', async () => {
  const service = suggestionService();
  const onAttachSource = vi.fn<NonNullable<BoardSuggestionsSurfaceProps['onAttachSource']>>();
  render(service, { selection: ['selected-one'], feedbackThreadId: 'from-thread', onAttachSource });
  await settle();
  expect(service.createReviewSource).not.toHaveBeenCalled();
  expect(onAttachSource).not.toHaveBeenCalled();

  await click('附加选区');
  expect(service.createReviewSource.mock.calls[0]?.[0]).toEqual({
    boardId,
    commandId,
    origin: { kind: 'selection', objectIds: ['selected-one'] },
    expectedBoardRevision: 5n,
  });
  expect(onAttachSource).toHaveBeenCalledExactlyOnceWith(attachedReference);
});

it('reuses the frozen reference if the host attachment failed after capture', async () => {
  const service = suggestionService();
  const onAttachSource = vi.fn<NonNullable<BoardSuggestionsSurfaceProps['onAttachSource']>>();
  onAttachSource.mockRejectedValueOnce(new Error('宿主不可用'));
  render(service, { feedbackThreadId: 'from-thread', onAttachSource });
  await settle();
  await click('附加批注');
  expect(service.createReviewSource.mock.calls[0]?.[0]).toMatchObject({
    origin: { kind: 'feedback', threadId: 'from-thread' },
  });
  expect(view.host.textContent).toContain('附加未确认');

  await click('重试附加');
  expect(service.createReviewSource).toHaveBeenCalledOnce();
  expect(onAttachSource.mock.calls).toEqual([[attachedReference], [attachedReference]]);
});
