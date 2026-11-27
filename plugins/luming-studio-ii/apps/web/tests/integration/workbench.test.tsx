import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { StudioApp, type StudioAppProps } from '../../src/app/index.js';
import type { BoardCatalogService, CatalogBoardSummary } from '../../src/data/catalog/index.js';
import { createControlFixture } from '../support/render-control.js';

type CreateCommand = Parameters<BoardCatalogService['createBoard']>[0];
type ListRequest = Parameters<BoardCatalogService['listBoards']>[0];
type VisibilityHandler = (entries: readonly { readonly isIntersecting: boolean }[]) => void;

const existingBoard: CatalogBoardSummary = {
  boardId: 'release-board',
  title: '产品发布工作台',
  pinned: false,
  entryVersion: 1n,
};
const createdBoard: CatalogBoardSummary = {
  ...existingBoard,
  boardId: 'new-board',
  title: '未命名白板',
};
const secondBoard: CatalogBoardSummary = {
  ...existingBoard,
  boardId: 'follow-up-board',
  title: '交付复盘',
};

function observePreviewVisibility() {
  const original = Object.getOwnPropertyDescriptor(window, 'IntersectionObserver');
  const registrations = new Set<VisibilityHandler>();

  class VisibilityObserver {
    private readonly listener: VisibilityHandler;

    constructor(listener: VisibilityHandler) {
      this.listener = listener;
    }

    observe() {
      registrations.add(this.listener);
    }

    disconnect() {
      registrations.delete(this.listener);
    }
  }

  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true,
    value: VisibilityObserver,
  });

  return {
    report(isIntersecting: boolean) {
      for (const listener of registrations) {
        listener([{ isIntersecting }]);
      }
    },
    restore() {
      if (original) {
        Object.defineProperty(window, 'IntersectionObserver', original);
      } else {
        Reflect.deleteProperty(window, 'IntersectionObserver');
      }
    },
  };
}

function click(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll('button')].find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent.trim()) === label,
  );

  if (!button) {
    throw new Error('缺少工作台按钮 ' + label);
  }

  return act(async () => {
    button.click();
  });
}

function enterSearch(host: HTMLElement, query: string) {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="搜索作品名称"]');
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!input || !descriptor?.set) {
    throw new Error('缺少已展开的搜索输入框');
  }

  return act(async () => {
    descriptor.set?.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 210);
    });
  });
}

function catalogFixture(service: BoardCatalogService) {
  const requests: ListRequest[] = [];
  const catalog: BoardCatalogService = {
    ...service,
    listBoards(request) {
      requests.push(request);
      if (request.pinnedOnly) {
        return Promise.resolve({ boards: [] });
      }
      if (request.query || request.cursor) {
        return Promise.resolve({ boards: [secondBoard] });
      }

      return Promise.resolve({ boards: [existingBoard], nextCursor: 'next' });
    },
  };

  return { catalog, requests };
}

function appMock() {
  const attempts: CreateCommand[] = [];
  const lookup: string[] = [];
  const opened: string[] = [];
  let currentBoard: string | undefined;
  const props: StudioAppProps = {
    catalog: {
      listBoards: () => Promise.resolve({ boards: [existingBoard] }),
      createBoard(command) {
        attempts.push(command);
        if (attempts.length === 1) {
          return Promise.reject(new Error('连接中断'));
        }

        return Promise.resolve({
          kind: 'created',
          commandId: command.commandId,
          board: createdBoard,
        });
      },
      getReceipt(commandId) {
        lookup.push(commandId);
        return Promise.resolve(undefined);
      },
    },
    service: {
      getScene(boardId) {
        opened.push(boardId);
        return Promise.resolve({
          boardId,
          title: createdBoard.title,
          revision: 0n,
          canEdit: true,
          objects: [],
        });
      },
      getPayloads: () => Promise.resolve([]),
      moveObjects: ({ boardId, commandId }) =>
        Promise.resolve({ kind: 'rejected', boardId, commandId, reason: 'invalidMove' }),
      getReceipt: () => Promise.resolve(undefined),
    },
    navigation: {
      read: () =>
        currentBoard ? { kind: 'whiteboard', boardId: currentBoard } : { kind: 'workbench' },
      write(location) {
        currentBoard = location.kind === 'whiteboard' ? location.boardId : undefined;
      },
      subscribe: () => () => undefined,
    },
    preferences: {
      layout: 'grid',
      resolvedTheme: 'light',
      rememberLayout: () => undefined,
      rememberTheme: () => undefined,
    },
    createCommandId: () => 'create-release-board',
  };

  return { props, attempts, lookup, opened };
}

describe('legacy Workbench creation through the Studio app', () => {
  it('loads only listed thumbnail revisions and reuses them when returning to the card layout', async () => {
    const { props } = appMock();
    const visibility = observePreviewVisibility();
    const thumbnailRequests: { boardId: string; revision: bigint; trashed: boolean }[] = [];
    const image = 'data:image/svg+xml;base64,PHN2Zy8+';
    const catalog: BoardCatalogService = {
      ...props.catalog,
      listBoards: async () => ({
        boards: [{ ...existingBoard, previewRevision: 2n }, secondBoard],
      }),
      getBoardThumbnail: async (request) => {
        thumbnailRequests.push(request);
        return image;
      },
    };
    const fixture = createControlFixture();

    try {
      await act(async () => fixture.render(<StudioApp {...props} catalog={catalog} />));
      await act(async () => visibility.report(false));
      expect(thumbnailRequests).toEqual([]);
      await act(async () => visibility.report(true));
      expect(fixture.host.querySelector('.studio-workbench-preview img')?.getAttribute('src')).toBe(
        image,
      );
      expect(thumbnailRequests).toEqual([
        { boardId: existingBoard.boardId, revision: 2n, trashed: false },
      ]);

      await click(fixture.host, '切换为列表视图');
      expect(fixture.host.querySelector('.studio-workbench-preview img')).toBeNull();
      await click(fixture.host, '切换为卡片视图');
      await act(async () => visibility.report(true));
      expect(fixture.host.querySelector('.studio-workbench-preview img')?.getAttribute('src')).toBe(
        image,
      );
      expect(thumbnailRequests).toHaveLength(1);
    } finally {
      fixture.dispose();
      visibility.restore();
    }
  });

  it('retries a failed page at the same cursor and preserves rows already read', async () => {
    const { props } = appMock();
    const requests: ListRequest[] = [];
    let failed = false;
    const catalog: BoardCatalogService = {
      ...props.catalog,
      async listBoards(request) {
        requests.push(request);
        if (!request.cursor) {
          return { boards: [existingBoard], nextCursor: 'next' };
        }

        if (!failed) {
          failed = true;
          throw new Error('目录连接中断');
        }

        return { boards: [secondBoard] };
      },
    };
    const fixture = createControlFixture();

    try {
      await act(async () => fixture.render(<StudioApp {...props} catalog={catalog} />));
      await click(fixture.host, '加载更多');
      expect(fixture.host.textContent).toContain('目录连接中断');
      expect(fixture.host.textContent).toContain(existingBoard.title);

      await click(fixture.host, '重试');
      expect(requests.map(({ cursor }) => cursor)).toEqual([undefined, 'next', 'next']);
      expect(fixture.host.textContent).toContain(existingBoard.title);
      expect(fixture.host.textContent).toContain(secondBoard.title);
    } finally {
      fixture.dispose();
    }
  });

  it('opens a confirmed board after checking and retrying the same create command', async () => {
    const { props, attempts, lookup, opened } = appMock();
    const fixture = createControlFixture();
    try {
      await act(async () => {
        fixture.render(<StudioApp {...props} />);
      });

      expect(fixture.host.querySelector('h1')?.textContent).toBe('Luming Studio');
      expect(
        fixture.host.querySelector('button[aria-label="打开白板：产品发布工作台"]'),
      ).not.toBeNull();

      await click(fixture.host, '新建作品');
      await click(fixture.host, '白板');

      expect(opened).toEqual([]);
      expect(lookup).toEqual(['create-release-board']);
      expect(fixture.host.textContent).toContain('创建结果未知');
      expect(
        fixture.host.querySelector<HTMLButtonElement>('button[aria-label="新建白板"]')?.disabled,
      ).toBe(true);

      await click(fixture.host, '重试原创建');

      expect(opened).toEqual(['new-board']);
      expect(attempts).toEqual([
        { commandId: 'create-release-board', title: '未命名白板' },
        { commandId: 'create-release-board', title: '未命名白板' },
      ]);
    } finally {
      fixture.dispose();
    }
  });

  it('keeps search, fixed scope, pagination and display switches in the original controls', async () => {
    const { props } = appMock();
    const { catalog, requests } = catalogFixture(props.catalog);
    const fixture = createControlFixture();
    try {
      await act(async () => {
        fixture.render(<StudioApp {...props} catalog={catalog} />);
      });

      await click(fixture.host, '加载更多');
      expect(requests.at(-1)).toMatchObject({ cursor: 'next', order: 'recent' });
      expect(fixture.host.textContent).toContain('产品发布工作台');
      expect(fixture.host.textContent).toContain('交付复盘');

      await click(fixture.host, '筛选作品');
      await click(fixture.host, '已固定');
      expect(requests.at(-1)).toMatchObject({ order: 'recent', pinnedOnly: true });
      expect(fixture.host.querySelector('h1')?.textContent).toBe('已固定');
      expect(fixture.host.textContent).toContain('还没有固定作品');
      await click(fixture.host, '返回 Luming Studio');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('筛选作品');
      expect(requests.at(-1)?.pinnedOnly).toBeUndefined();

      await click(fixture.host, '搜索作品');
      await enterSearch(fixture.host, '交付');
      expect(requests.at(-1)).toMatchObject({ query: '交付', order: 'recent' });
      expect(fixture.host.textContent).not.toContain('产品发布工作台');

      await click(fixture.host, '切换为列表视图');
      await click(fixture.host, '切换为暗色主题');
      expect(fixture.host.querySelector('.studio-workbench-cards-list')).not.toBeNull();
      expect(
        fixture.host.querySelector('.studio-workbench[data-studio-theme="dark"]'),
      ).not.toBeNull();
    } finally {
      fixture.dispose();
    }
  });
});
