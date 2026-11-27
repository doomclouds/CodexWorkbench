import { act } from 'react';
import { expect, test } from 'vitest';
import { createWhiteboardService } from '../../src/data/whiteboard/index.js';
import {
  WhiteboardEditorSurface,
  type WhiteboardEditorFeatures,
  type WhiteboardEditorSurfaceProps,
} from '../../src/surfaces/whiteboard-editor/index.js';
import { createWhiteboardRpcMock, sampleBoardId } from '../fixtures/whiteboard-rpc.js';
import { createControlFixture } from '../support/render-control.js';

const originalTitle = '一期测试白板';
const view: WhiteboardEditorFeatures['Viewing'] = ({ children }) => <>{children}</>;

type Fixture = ReturnType<typeof createControlFixture>;

interface ChromeOptions {
  readonly writable?: boolean;
  readonly renameBoard?: WhiteboardEditorSurfaceProps['renameBoard'];
  readonly features?: Partial<WhiteboardEditorFeatures>;
}

function find<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error('Missing board chrome control ' + selector);
  }

  return element;
}

function button(root: HTMLElement, label: string): HTMLButtonElement {
  return find(root, `button[aria-label="${label}"]`);
}

function nameField(root: HTMLElement): HTMLInputElement {
  return find(root, 'input[aria-label="白板名称"]');
}

function changeName(input: HTMLInputElement, value: string): void {
  const valueProperty = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!valueProperty?.set) {
    throw new Error('The test environment has no native input value setter.');
  }

  input.focus();
  valueProperty.set.call(input, value);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
}

function press(input: HTMLInputElement, key: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

async function openChrome(
  fixture: Fixture,
  { writable = true, renameBoard, features }: ChromeOptions = {},
) {
  const rpc = createWhiteboardRpcMock({ canEdit: writable });
  let backCount = 0;
  await act(async () => {
    fixture.render(
      <WhiteboardEditorSurface
        boardId={sampleBoardId}
        service={createWhiteboardService(rpc.post)}
        createCommandId={() => 'chrome-command'}
        onBack={() => {
          backCount += 1;
        }}
        renameBoard={renameBoard}
        features={{ Viewing: view, ...features }}
      />,
    );
  });

  return { header: find(fixture.host, 'header.whiteboard-chrome'), backCount: () => backCount };
}

test('edits the inline name on Enter or blur, and discards the draft on Escape', async () => {
  const fixture = createControlFixture();
  const renames: string[][] = [];
  function renameBoard(boardId: string, currentTitle: string, title: string) {
    renames.push([boardId, currentTitle, title]);

    return Promise.resolve();
  }
  try {
    const { header } = await openChrome(fixture, { renameBoard });
    const first = nameField(header);
    expect(first.value).toBe(originalTitle);
    expect(first.readOnly).toBe(false);
    await act(async () => changeName(first, '  已审核白板  '));
    await act(async () => press(first, 'Enter'));
    expect(renames).toEqual([[sampleBoardId, originalTitle, '已审核白板']]);

    const second = nameField(fixture.host);
    await act(async () => changeName(second, '应撤销的草稿'));
    await act(async () => press(second, 'Escape'));
    expect(nameField(fixture.host).value).toBe(originalTitle);
    expect(renames).toHaveLength(1);

    const third = nameField(fixture.host);
    await act(async () => changeName(third, '  通过失焦提交  '));
    await act(async () => third.blur());
    expect(renames.at(-1)).toEqual([sampleBoardId, originalTitle, '通过失焦提交']);
    expect(renames).toHaveLength(2);
  } finally {
    fixture.dispose();
  }
});

test('shows the original title bar actions and places export under the sharing entry', async () => {
  const fixture = createControlFixture();
  try {
    const { header, backCount } = await openChrome(fixture, {
      features: {
        renderExport: () => <div role="status">本地导出已打开</div>,
        renderHistory: ({ anchor }) => anchor && <section aria-label="版本历史面板" />,
        renderFeedback: ({ panelOpen, onUnresolvedChange }) =>
          panelOpen && (
            <section aria-label="备注反馈面板">
              <button
                aria-label="通知有未解决备注"
                type="button"
                onClick={() => onUnresolvedChange?.(true)}
              >
                模拟未解决状态
              </button>
            </section>
          ),
      },
    });
    const controls = [...header.querySelectorAll('button')].map((item) =>
      item.getAttribute('aria-label'),
    );
    expect(controls).toEqual(['返回 Luming Studio', '版本历史', '分享', '备注', '备注列表']);

    const history = button(header, '版本历史');
    await act(async () => history.click());
    expect(history.getAttribute('aria-expanded')).toBe('true');
    await act(async () => history.click());
    expect(history.getAttribute('aria-expanded')).toBe('false');

    const share = button(header, '分享');
    await act(async () => share.click());
    expect(fixture.host.textContent).toContain('本地导出已打开');

    const notes = button(header, '备注列表');
    const annotate = button(header, '备注');
    await act(async () => notes.click());
    expect(notes.getAttribute('aria-expanded')).toBe('true');
    expect(annotate.getAttribute('aria-pressed')).toBe('false');
    await act(async () => button(fixture.host, '通知有未解决备注').click());
    expect(notes.getAttribute('aria-description')).toBe('有未解决备注');
    expect(notes.querySelector('.whiteboard-chrome__comment-dot')).not.toBeNull();
    await act(async () => annotate.click());
    expect(annotate.getAttribute('aria-pressed')).toBe('true');

    await act(async () => button(header, '返回 Luming Studio').click());
    expect(backCount()).toBe(1);
  } finally {
    fixture.dispose();
  }
});

test('keeps the entered board name on failure and retries the same edit', async () => {
  const fixture = createControlFixture();
  const attempts: string[][] = [];
  try {
    const { header } = await openChrome(fixture, {
      renameBoard: (...request) => {
        attempts.push(request);

        return attempts.length === 1
          ? Promise.reject(new Error('名称保存结果尚未确认，请重试查询。'))
          : Promise.resolve();
      },
    });
    const field = nameField(header);
    await act(async () => changeName(field, '  未确认的名称  '));
    await act(async () => field.blur());
    expect(nameField(header).value).toBe('  未确认的名称  ');
    expect(fixture.host.textContent).toContain('名称保存结果尚未确认，请重试查询。');
    await act(async () => {
      field.focus();
      field.blur();
    });
    expect(attempts).toHaveLength(1);

    const retry = find<HTMLButtonElement>(fixture.host, '#whiteboard-rename-failed button');
    expect(retry.textContent).toBe('重试改名');
    await act(async () => retry.click());
    expect(attempts).toEqual([
      [sampleBoardId, originalTitle, '未确认的名称'],
      [sampleBoardId, originalTitle, '未确认的名称'],
    ]);
    expect(fixture.host.querySelector('#whiteboard-rename-failed')).toBeNull();
  } finally {
    fixture.dispose();
  }
});

test('discards the failed board name and its retry action on Escape', async () => {
  const fixture = createControlFixture();
  try {
    const { header } = await openChrome(fixture, {
      renameBoard: () => Promise.reject(new Error('目录名称已被更改。')),
    });
    const field = nameField(header);
    await act(async () => changeName(field, '未确认的名称'));
    await act(async () => press(field, 'Enter'));
    expect(field.value).toBe('未确认的名称');
    await act(async () => {
      field.focus();
      press(field, 'Escape');
    });
    expect(field.value).toBe(originalTitle);
    expect(fixture.host.querySelector('#whiteboard-rename-failed')).toBeNull();
  } finally {
    fixture.dispose();
  }
});

test('leaves history and the discussion list accessible without write access', async () => {
  const fixture = createControlFixture();
  let renameCount = 0;
  function renameBoard() {
    renameCount += 1;

    return Promise.resolve();
  }
  try {
    const { header } = await openChrome(fixture, {
      writable: false,
      renameBoard,
      features: {
        renderHistory: ({ anchor }) => anchor && <section aria-label="版本历史面板" />,
        renderFeedback: ({ panelOpen }) => panelOpen && <section aria-label="备注反馈面板" />,
      },
    });
    expect(nameField(header).readOnly).toBe(true);
    expect(header.querySelector('button[aria-label="返回 Luming Studio"]')).toBeNull();
    expect(header.querySelector('.whiteboard-chrome__guest')).not.toBeNull();
    expect(button(header, '备注').disabled).toBe(true);
    expect(button(header, '备注列表').disabled).toBe(false);
    expect(button(header, '分享').disabled).toBe(true);

    const history = button(header, '版本历史');
    await act(async () => history.click());
    expect(history.getAttribute('aria-expanded')).toBe('true');
    expect(renameCount).toBe(0);
  } finally {
    fixture.dispose();
  }
});
