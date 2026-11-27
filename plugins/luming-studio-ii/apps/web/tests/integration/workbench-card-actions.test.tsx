import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type {
  BoardCatalogService,
  CatalogBoardSummary,
  CatalogManagementService,
} from '../../src/data/catalog/index.js';
import { WorkbenchSurface } from '../../src/surfaces/workbench/index.js';
import { createControlFixture } from '../support/render-control.js';

type ManagementCommand = Parameters<CatalogManagementService['manageBoard']>[0];

const managedBoard: CatalogBoardSummary = {
  boardId: 'release-board',
  title: '交付白板',
  pinned: false,
  entryVersion: 4n,
  canManage: true,
};

const viewOnly: CatalogBoardSummary = {
  ...managedBoard,
  boardId: 'viewer-board',
  title: '只读白板',
  canManage: false,
};

function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
}

function closeModal(this: HTMLDialogElement) {
  this.removeAttribute('open');
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: closeModal, configurable: true },
  });
}

function findButton(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent.trim()) === label,
  );

  if (!button) {
    throw new Error('缺少按钮 ' + label);
  }

  return button;
}

function click(host: HTMLElement, label: string) {
  return act(async () => {
    findButton(host, label).click();
  });
}

async function chooseAction(host: HTMLElement, title: string, action: string) {
  await click(host, '管理作品：' + title);
  await click(host, action);
}

function enterTitle(host: HTMLElement, text: string) {
  const input = host.querySelector<HTMLInputElement>('dialog[open] input');
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!input || !descriptor?.set) {
    throw new Error('缺少重命名输入框');
  }

  return act(async () => {
    descriptor.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function applyChange(board: CatalogBoardSummary, { operation }: ManagementCommand) {
  const updated = { ...board, entryVersion: board.entryVersion + 1n };
  switch (operation.kind) {
    case 'rename':
      return { ...updated, title: operation.title };
    case 'pin':
      return { ...updated, pinned: operation.pinned };
    case 'trash':
    case 'restore':
      return updated;
  }
}

function workbench(loseFirstReply = false) {
  const fixture = createControlFixture();
  const commands: ManagementCommand[] = [];
  const receipts: string[] = [];
  const navigation: string[] = [];
  let board = managedBoard;
  let trashed = false;
  let commandNumber = 0;

  const catalog: BoardCatalogService = {
    listBoards: async () => ({ boards: trashed ? [viewOnly] : [board, viewOnly] }),
    createBoard: async ({ commandId }) => ({ kind: 'rejected', commandId, reason: 'unknown' }),
    getReceipt: async () => undefined,
  };

  const management: CatalogManagementService = {
    listTrashedBoards: async () => ({ boards: [] }),
    async manageBoard(command) {
      commands.push(command);
      if (loseFirstReply && commands.length === 1) {
        throw new Error('连接中断');
      }

      board = applyChange(board, command);
      trashed = command.operation.kind === 'trash';

      return { kind: 'changed', commandId: command.commandId, board };
    },
    purgeBoards: async ({ commandId }) => ({ kind: 'purged', commandId, items: [] }),
    async getReceipt(commandId) {
      receipts.push(commandId);

      return undefined;
    },
  };

  function mount(layout: 'grid' | 'list' = 'grid') {
    return act(async () => {
      fixture.render(
        <WorkbenchSurface
          catalog={catalog}
          createCommandId={() => 'manage-' + ++commandNumber}
          onOpenBoard={() => undefined}
          onOpenTrash={() => navigation.push('trash')}
          management={management}
          preferences={{
            layout,
            resolvedTheme: 'light',
            onLayoutChange: () => undefined,
            onThemeChange: () => undefined,
          }}
        />,
      );
    });
  }

  return { ...fixture, mount, commands, receipts, navigation };
}

describe('Workbench management through the public Surface', () => {
  it('keeps the filter trigger focused on keyboard open and enters the menu with Tab', async () => {
    const fixture = workbench();
    try {
      await fixture.mount();
      const { host } = fixture;
      const filter = findButton(host, '筛选作品');
      await act(async () => filter.focus());

      async function press(target: HTMLElement, key: string) {
        await act(async () => {
          target.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
          );
        });
      }

      await press(filter, 'ArrowDown');
      const recent = findButton(host, '最近作品');
      const trash = findButton(host, '回收站');
      expect(document.activeElement).toBe(filter);
      await press(filter, 'End');
      expect(document.activeElement).toBe(filter);
      await press(filter, 'Tab');
      expect(document.activeElement).toBe(recent);
      await press(recent, 'End');
      expect(document.activeElement).toBe(trash);
      await press(trash, 'Escape');
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(filter);

      await press(filter, 'ArrowDown');
      await press(filter, 'Escape');
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(filter);
    } finally {
      fixture.dispose();
    }
  });

  it('opens the recycle bin from the filter menu and returns focus to its trigger', async () => {
    const fixture = workbench();
    try {
      const { host } = fixture;
      await fixture.mount();
      await click(host, '筛选作品');
      const currentOrder = findButton(host, '最近作品');
      expect(document.activeElement).toBe(currentOrder);
      await act(async () => {
        currentOrder.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      });

      expect(document.activeElement).toBe(findButton(host, '回收站'));
      await click(host, '回收站');
      expect(fixture.navigation).toEqual(['trash']);
      expect(document.activeElement).toBe(findButton(host, '筛选作品'));
    } finally {
      fixture.dispose();
    }
  });

  it('uses the rename dialog, pin and trash actions only for manageable boards', async () => {
    const fixture = workbench();
    try {
      const { host } = fixture;
      await fixture.mount('list');
      expect(host.querySelector('button[aria-label="管理作品：只读白板"]')).toBeNull();
      await chooseAction(host, managedBoard.title, '重命名');
      expect(host.querySelector('dialog[open] h2')?.textContent).toBe('重命名作品');
      await click(host, '取消');
      expect(document.activeElement).toBe(findButton(host, '管理作品：交付白板'));

      await chooseAction(host, managedBoard.title, '重命名');
      await click(host, '关闭弹窗');
      expect(host.querySelector('dialog[open]')).toBeNull();
      expect(document.activeElement).toBe(findButton(host, '管理作品：交付白板'));

      await chooseAction(host, managedBoard.title, '重命名');
      await enterTitle(host, ' 交付计划 ');
      await click(host, '保存');
      expect(fixture.commands[0]).toMatchObject({
        boardId: managedBoard.boardId,
        expectedEntryVersion: 4n,
        operation: { kind: 'rename', title: '交付计划' },
      });
      expect(host.querySelector('dialog[open]')).toBeNull();
      await chooseAction(host, '交付计划', '固定');
      await chooseAction(host, '交付计划', '取消固定');
      await chooseAction(host, '交付计划', '移入回收站');
      expect(fixture.commands.slice(1).map(({ operation }) => operation)).toEqual([
        { kind: 'pin', pinned: true },
        { kind: 'pin', pinned: false },
        { kind: 'trash' },
      ]);
      expect(fixture.commands.map(({ expectedEntryVersion }) => expectedEntryVersion)).toEqual([
        4n,
        5n,
        6n,
        7n,
      ]);
      expect(host.querySelector('button[aria-label="打开白板：交付计划"]')).toBeNull();
      expect(host.textContent).toContain('已移入回收站，可以随时恢复。');
    } finally {
      fixture.dispose();
    }
  });

  it('looks up the original command before offering an explicit retry', async () => {
    const fixture = workbench(true);
    try {
      const { host } = fixture;
      await fixture.mount();
      await chooseAction(host, managedBoard.title, '固定');
      expect(fixture.receipts).toEqual(['manage-1']);
      expect(fixture.commands).toHaveLength(1);
      expect(host.textContent).toContain('操作结果未知');
      expect(findButton(host, '新建白板').disabled).toBe(true);
      await click(host, '重试原操作');

      expect(fixture.commands).toHaveLength(2);
      expect(fixture.commands[1]).toEqual(fixture.commands[0]);
      expect(host.querySelector('[aria-label="已固定"]')).not.toBeNull();
    } finally {
      fixture.dispose();
    }
  });
});
