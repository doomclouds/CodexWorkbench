import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import OperationNotice, { OperationNoticeTarget } from '../../src/app/shared/OperationNotice';

let editor: HTMLDivElement;
let notices: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  editor = document.createElement('div');
  notices = document.createElement('div');
  document.body.append(editor, notices);
  root = createRoot(editor);
});

afterEach(async () => {
  await act(async () => root.unmount());
  editor.remove();
  notices.remove();
  vi.unstubAllGlobals();
});

function button(label: string) {
  const found = [...notices.querySelectorAll('button')].find(
    (node) => (node.getAttribute('aria-label') || node.textContent) === label,
  );
  expect(found).toBeDefined();

  return found!;
}

it('routes independent save notices to the top and preserves the matching recovery action after closing', async () => {
  const retryCanvas = vi.fn();
  const retryDocument = vi.fn();
  await act(async () =>
    root.render(
      <OperationNoticeTarget.Provider value={notices}>
        <OperationNotice
          source="画布"
          message="画布保存暂时失败"
          closeLabel="关闭画布保存通知"
          actions={
            <button type="button" onClick={retryCanvas}>
              重试画布保存
            </button>
          }
        />
        <OperationNotice
          source="文档"
          message="同步服务暂时不可用"
          closeLabel="关闭文档保存通知"
          actions={
            <button type="button" onClick={retryDocument}>
              重试文档保存
            </button>
          }
        />
      </OperationNoticeTarget.Provider>,
    ),
  );
  expect(editor.querySelector('[role="alert"]')).toBeNull();
  expect(notices.querySelectorAll('[role="alert"]')).toHaveLength(2);
  await act(async () => button('关闭文档保存通知').click());
  expect(notices.querySelectorAll('[role="alert"]')).toHaveLength(1);
  expect(notices.textContent).not.toContain('同步服务暂时不可用');
  expect(retryCanvas).not.toHaveBeenCalled();
  expect(retryDocument).not.toHaveBeenCalled();
  await act(async () => button('查看文档通知').click());
  await act(async () => button('重试文档保存').click());
  expect(retryDocument).toHaveBeenCalledOnce();
  expect(retryCanvas).not.toHaveBeenCalled();
});

it('removes the previous board notice and its buttons when the editor scope changes', async () => {
  const retry = vi.fn();
  const render = (key: string, failed: boolean) =>
    root.render(
      <OperationNoticeTarget.Provider value={notices}>
        <div key={key}>
          {failed && (
            <OperationNotice
              source="画布"
              message="旧白板写入失败"
              actions={
                <button type="button" onClick={retry}>
                  重试原操作
                </button>
              }
            />
          )}
        </div>
      </OperationNoticeTarget.Provider>,
    );
  await act(async () => render('a', true));
  expect(notices.textContent).toContain('旧白板写入失败');
  await act(async () => render('b', false));
  expect(notices.childElementCount).toBe(0);
  expect(retry).not.toHaveBeenCalled();
});
