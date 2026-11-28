import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { StudioApp, type StudioAppProps } from '../../src/app/index.js';
import type {
  CatalogBoardSummary,
  CatalogListRequest,
  CatalogManagementReceipt,
  CatalogManagementService,
  CatalogPurgeItemResult,
  CatalogPurgeRequest,
  TrashedBoardSummary,
} from '../../src/data/catalog/index.js';
import { createControlFixture } from '../support/render-control.js';

type Location = ReturnType<StudioAppProps['navigation']['read']>;

const timestamp = 1_794_657_600_000n;

function showModal(this: HTMLDialogElement) {
  this.open = true;
  this.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}

function closeModal(this: HTMLDialogElement) {
  this.open = false;
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: closeModal, configurable: true },
  });
}

function trashBoard(boardId: string, title: string): TrashedBoardSummary {
  return {
    board: { boardId, title, pinned: false, entryVersion: 2n, canManage: true },
    trashedAtMillis: timestamp,
  };
}

function button(host: HTMLElement, label: string) {
  const target = [...host.querySelectorAll('button')].find(
    (candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent.trim()) === label,
  );

  if (!target) {
    throw new Error('缺少回收站按钮 ' + label);
  }

  return target;
}

function click(host: HTMLElement, label: string) {
  return act(async () => button(host, label).click());
}

function dialog(host: HTMLElement) {
  const target = host.querySelector<HTMLElement>('dialog[open]');
  if (!target) {
    throw new Error('缺少删除确认框');
  }

  return target;
}

function selectAll(host: HTMLElement) {
  const checkbox = host.querySelector<HTMLInputElement>('.studio-recycle-selection input');
  if (!checkbox) {
    throw new Error('缺少全选复选框');
  }

  return act(async () => checkbox.click());
}

function enterSearch(host: HTMLElement, query: string) {
  const field = host.querySelector<HTMLInputElement>('input[aria-label="搜索回收站名称"]');
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!field || !descriptor?.set) {
    throw new Error('缺少已展开的回收站搜索框');
  }

  return act(async () => {
    descriptor.set?.call(field, query);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 210);
    });
  });
}

function recycleApp(entries: readonly TrashedBoardSummary[]) {
  const fixture = createControlFixture();
  const trash = new Map(entries.map((entry) => [entry.board.boardId, entry]));
  const active = new Map<string, CatalogBoardSummary>();
  const purgeRequests: CatalogPurgeRequest[] = [];
  const listRequests: CatalogListRequest[] = [];
  const receiptRequests: string[] = [];
  const receipts = new Map<string, CatalogManagementReceipt>();
  const rejectIds = new Set<string>();
  const locations: Location[] = [];
  let current: Location = { kind: 'recycle-bin' };
  let loseReply = false;
  let loseRead = false;
  let nextRead: Promise<void> | undefined;
  let count = 0;

  function purgeItem({
    boardId,
    expectedEntryVersion,
  }: CatalogPurgeRequest['targets'][number]): CatalogPurgeItemResult {
    const stored = trash.get(boardId);
    if (!stored) {
      return { boardId, deleted: false, reason: 'stateChanged' };
    }
    if (rejectIds.has(boardId) || stored.board.entryVersion !== expectedEntryVersion) {
      return { boardId, deleted: false, reason: 'entryVersionChanged' };
    }

    trash.delete(boardId);

    return { boardId, deleted: true };
  }

  const management: CatalogManagementService = {
    async listTrashedBoards(request) {
      listRequests.push(request);
      if (nextRead) {
        const waiting = nextRead;
        nextRead = undefined;
        await waiting;
      }
      if (loseRead) {
        loseRead = false;
        throw new Error('回收站读取中断。');
      }

      const start = Number(request.cursor ?? 0);
      const matches = [...trash.values()].filter(({ board }) =>
        board.title.includes(request.query),
      );
      const end = start + request.pageSize;

      return {
        boards: matches.slice(start, end),
        nextCursor: end < matches.length ? String(end) : undefined,
      };
    },
    async manageBoard({ commandId, boardId }) {
      const item = trash.get(boardId);
      if (!item) {
        return { kind: 'rejected', commandId, reason: 'stateChanged' };
      }

      const board = { ...item.board, entryVersion: item.board.entryVersion + 1n };
      trash.delete(boardId);
      active.set(boardId, board);

      return { kind: 'changed', commandId, board };
    },
    async purgeBoards(request) {
      purgeRequests.push(request);
      const result = {
        kind: 'purged' as const,
        commandId: request.commandId,
        items: request.targets.map(purgeItem),
      };
      receipts.set(result.commandId, result);
      if (loseReply) {
        loseReply = false;
        throw new Error('响应中断。');
      }

      return result;
    },
    async getReceipt(commandId) {
      receiptRequests.push(commandId);

      return receipts.get(commandId);
    },
  };

  function mount(layout: 'grid' | 'list' = 'grid') {
    const props: StudioAppProps = {
      catalog: {
        listBoards: async () => ({ boards: [...active.values()] }),
        createBoard: async ({ commandId }) => ({ kind: 'rejected', commandId, reason: 'unknown' }),
        getReceipt: async () => undefined,
      },
      catalogManagement: management,
      service: {
        getScene: async (boardId) => ({
          boardId,
          title: '',
          revision: 0n,
          canEdit: true,
          objects: [],
        }),
        getPayloads: async () => [],
        moveObjects: async ({ boardId, commandId }) => ({
          kind: 'rejected',
          boardId,
          commandId,
          reason: 'invalidMove',
        }),
        getReceipt: async () => undefined,
      },
      navigation: {
        read: () => current,
        write(location) {
          current = location;
          locations.push(location);
        },
        subscribe: () => () => undefined,
      },
      preferences: {
        layout,
        resolvedTheme: 'light',
        rememberLayout: () => undefined,
        rememberTheme: () => undefined,
      },
      createCommandId: () => 'recycle-' + ++count,
    };

    return act(async () => fixture.render(<StudioApp {...props} />));
  }

  function interruptReply() {
    loseReply = true;
  }

  function interruptRead() {
    loseRead = true;
  }

  function pauseNextRead() {
    let resume: () => void = () => undefined;
    nextRead = new Promise<void>((resolve) => {
      resume = resolve;
    });

    return resume;
  }

  return {
    ...fixture,
    mount,
    trash,
    active,
    listRequests,
    purgeRequests,
    rejectIds,
    locations,
    receiptRequests,
    interruptReply,
    interruptRead,
    pauseNextRead,
  };
}

describe('recycle bin through the Studio app', () => {
  it.each(['grid', 'list'] as const)(
    'keeps original %s actions and confirms a single deletion',
    async (layout) => {
      const first = trashBoard('remove', '可删除的作品');
      const second = trashBoard('restore', '可以恢复的作品');
      const app = recycleApp([first, second]);

      try {
        await app.mount(layout);
        expect(app.listRequests[0]?.pageSize).toBe(60);
        expect(app.host.querySelector('h1')?.textContent).toBe('回收站');
        expect(
          app.host.querySelector('[aria-label="筛选作品"], [aria-label="新建作品"]'),
        ).toBeNull();
        expect(app.host.querySelectorAll('.studio-recycle-preview')).toHaveLength(
          layout === 'grid' ? 2 : 0,
        );
        expect(button(app.host, '打开白板：可删除的作品').disabled).toBe(true);
        expect(button(app.host, '恢复作品：可以恢复的作品').textContent).toBe('');

        const deleteTrigger = button(app.host, '永久删除作品：可删除的作品');
        expect(deleteTrigger.dataset.tone).toBe('danger');
        expect(button(app.host, '永久删除所选作品').dataset.tone).toBe('danger');
        expect(button(app.host, '清空回收站').dataset.tone).toBe('danger');
        expect(button(app.host, '恢复作品：可以恢复的作品').dataset.tone).toBeUndefined();
        await act(async () => {
          deleteTrigger.focus();
          deleteTrigger.click();
        });
        expect(dialog(app.host).textContent).toContain('永久删除 1 项作品，此操作无法恢复。');
        expect(button(dialog(app.host), '永久删除').dataset.tone).toBe('danger');
        expect(button(dialog(app.host), '取消').dataset.tone).toBeUndefined();
        expect(app.purgeRequests).toEqual([]);
        expect(document.activeElement).toBe(button(dialog(app.host), '关闭弹窗'));
        await click(dialog(app.host), '取消');
        expect(app.trash.size).toBe(2);
        expect(document.activeElement).toBe(deleteTrigger);

        await click(app.host, '永久删除作品：可删除的作品');
        await act(async () => {
          dialog(app.host).dispatchEvent(new Event('cancel', { cancelable: true }));
        });
        expect(app.host.querySelector('dialog[open]')).toBeNull();
        expect(document.activeElement).toBe(deleteTrigger);

        await click(app.host, '永久删除作品：可删除的作品');
        await act(async () => {
          const backdrop = dialog(app.host);
          backdrop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
          backdrop.click();
        });
        expect(app.host.querySelector('dialog[open]')).toBeNull();
        expect(document.activeElement).not.toBe(deleteTrigger);
        expect(app.purgeRequests).toEqual([]);

        await click(app.host, '永久删除作品：可删除的作品');
        await click(dialog(app.host), '永久删除');
        expect(app.purgeRequests[0]?.targets).toEqual([
          { boardId: 'remove', expectedEntryVersion: 2n },
        ]);
        expect(document.activeElement).toBe(button(app.host, '清空回收站'));
        await click(app.host, '恢复作品：可以恢复的作品');
        expect(app.host.textContent).toContain('回收站为空');
        await click(app.host, '返回 Luming Studio II');
        expect(app.locations).toEqual([{ kind: 'workbench' }]);
        expect(app.host.textContent).toContain('可以恢复的作品');
      } finally {
        app.dispose();
      }
    },
  );

  it('keeps selection and clear-all commands within managed boards', async () => {
    const owned = trashBoard('remove', '我的作品');
    const other = trashBoard('readonly', '只读作品');
    const app = recycleApp([owned, { ...other, board: { ...other.board, canManage: false } }]);

    try {
      await app.mount();
      expect(button(app.host, '恢复作品：只读作品').disabled).toBe(true);
      expect(button(app.host, '永久删除作品：只读作品').disabled).toBe(true);
      expect(app.host.querySelector('[aria-label="选择作品：只读作品"]:disabled')).not.toBeNull();

      await selectAll(app.host);
      expect(app.host.textContent).toContain('1 项已选');
      await click(app.host, '清空回收站');
      expect(dialog(app.host).textContent).toContain('永久删除 1 项作品');
      await click(dialog(app.host), '清空回收站');
      expect(app.purgeRequests[0]?.targets).toEqual([
        { boardId: owned.board.boardId, expectedEntryVersion: 2n },
      ]);
      expect(app.trash.has(other.board.boardId)).toBe(true);
    } finally {
      app.dispose();
    }
  });

  it('keeps failed rows selected and retries only the failures', async () => {
    const app = recycleApp([trashBoard('remove', '可删除'), trashBoard('retry', '需要重试')]);
    app.rejectIds.add('retry');

    try {
      await app.mount();
      await selectAll(app.host);
      expect(app.host.textContent).toContain('2 项已选');
      await click(app.host, '永久删除所选作品');
      await click(dialog(app.host), '永久删除');
      expect(app.host.textContent).toContain('1 项作品未删除，已保留选择。');
      expect(app.host.textContent).toContain('1 项已选');
      expect([...app.trash.keys()]).toEqual(['retry']);

      app.rejectIds.clear();
      await click(app.host, '永久删除所选作品');
      await click(dialog(app.host), '永久删除');
      expect(app.purgeRequests.at(-1)?.targets).toEqual([
        { boardId: 'retry', expectedEntryVersion: 2n },
      ]);
      expect(app.host.textContent).toContain('回收站为空');
    } finally {
      app.dispose();
    }
  });

  it('waits for replacement rows before offering permanent deletion of a selection', async () => {
    const app = recycleApp([trashBoard('restore', '待恢复作品'), trashBoard('keep', '保留作品')]);
    try {
      await app.mount();
      await selectAll(app.host);
      const resume = app.pauseNextRead();
      try {
        await click(app.host, '恢复作品：待恢复作品');
        expect(button(app.host, '永久删除所选作品').disabled).toBe(true);
      } finally {
        await act(async () => {
          resume();
        });
      }

      expect(button(app.host, '永久删除所选作品').disabled).toBe(false);
      expect(app.purgeRequests).toEqual([]);
    } finally {
      app.dispose();
    }
  });

  it('shows a retry after a refresh fails while other rows remain', async () => {
    const app = recycleApp([trashBoard('restore', '待恢复作品'), trashBoard('keep', '保留作品')]);
    try {
      await app.mount();
      app.interruptRead();
      await click(app.host, '恢复作品：待恢复作品');
      expect(app.host.querySelector('.studio-recycle-pagination [role="alert"]')?.textContent).toBe(
        '回收站读取中断。',
      );
      expect(button(app.host, '恢复作品：保留作品')).toBeDefined();
      expect(app.trash.has('restore')).toBe(false);

      await click(app.host, '重试');
      expect(app.listRequests).toHaveLength(3);
      expect(app.listRequests.at(-1)).toEqual(app.listRequests.at(-2));
      expect(app.host.textContent).not.toContain('回收站读取中断。');
      expect(button(app.host, '恢复作品：保留作品')).toBeDefined();
    } finally {
      app.dispose();
    }
  });

  it('confirms the whole unfiltered 105-item snapshot and excludes later arrivals', async () => {
    const entries = Array.from({ length: 105 }, (_, index) =>
      trashBoard('trash-' + index, index === 0 ? '唯一匹配的作品' : '作品 ' + index),
    );
    const app = recycleApp(entries);

    try {
      await app.mount();
      await click(app.host, '搜索回收站');
      await enterSearch(app.host, '唯一匹配');
      expect(app.host.querySelectorAll('.studio-recycle-card')).toHaveLength(1);
      await click(app.host, '清空回收站');
      expect(
        app.listRequests
          .filter(({ pageSize }) => pageSize === 100)
          .map(({ query, cursor }) => ({ query, cursor })),
      ).toEqual([
        { query: '', cursor: undefined },
        { query: '', cursor: '100' },
      ]);
      expect(dialog(app.host).textContent).toContain('永久删除 105 项作品');
      expect(app.purgeRequests).toEqual([]);

      app.trash.set('later', trashBoard('later', '确认后移入'));
      app.trash.delete('trash-104');
      await click(dialog(app.host), '清空回收站');
      expect(app.purgeRequests.map(({ targets }) => targets.length)).toEqual([100, 5]);
      expect(
        app.purgeRequests.flatMap(({ targets }) => targets.map(({ boardId }) => boardId)),
      ).toEqual(entries.map(({ board }) => board.boardId));
      expect([...app.trash.keys()]).toEqual(['later']);
      expect(app.host.textContent).toContain('作品已不在回收站。');
      expect(app.host.textContent).toContain('1 项作品未删除。');
      expect(app.host.querySelector('[aria-label="永久删除所选作品"]:not(:disabled)')).toBeNull();
    } finally {
      app.dispose();
    }
  });

  it('looks up the original receipt after a lost purge response', async () => {
    const app = recycleApp([trashBoard('remove', '可删除')]);
    app.interruptReply();

    try {
      await app.mount();
      await click(app.host, '永久删除作品：可删除');
      await click(dialog(app.host), '永久删除');
      expect(app.purgeRequests).toHaveLength(1);
      expect(app.receiptRequests).toEqual([app.purgeRequests[0]?.commandId]);
      expect(app.host.textContent).toContain('已永久删除 1 项作品。');
    } finally {
      app.dispose();
    }
  });
});
