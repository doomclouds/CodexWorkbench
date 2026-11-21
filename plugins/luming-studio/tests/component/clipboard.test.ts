import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { copyPlainText } from '../../src/app/clipboard';

const shareLink = 'http://board.example/share';
let dom: JSDOM;

beforeEach(() => {
  dom = new JSDOM(
    '<input id="draft" value="保留我的草稿"><div id="source" contenteditable="true" tabindex="0">原有选区</div>',
  );
  vi.stubGlobal('navigator', dom.window.navigator);
});

afterEach(() => {
  vi.unstubAllGlobals();
  dom.window.close();
});

describe('link clipboard', () => {
  it('writes the link without changing an active selection', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText } });
    const source = dom.window.document.getElementById('source') as HTMLElement;
    source.focus();
    const range = dom.window.document.createRange();
    range.selectNodeContents(source);
    dom.window.getSelection()!.removeAllRanges();
    dom.window.getSelection()!.addRange(range);

    await copyPlainText(shareLink);

    expect(writeText).toHaveBeenCalledWith(shareLink);
    expect(dom.window.document.activeElement).toBe(source);
    expect(dom.window.getSelection()!.toString()).toBe('原有选区');
  });

  it('reports unavailable clipboard access and keeps the draft selection', async () => {
    const draft = dom.window.document.getElementById('draft') as HTMLInputElement;
    draft.focus();
    draft.setSelectionRange(2, 4);

    await expect(copyPlainText(shareLink)).rejects.toThrow('请手动复制');

    expect(dom.window.document.activeElement).toBe(draft);
    expect(draft.value).toBe('保留我的草稿');
    expect(draft.selectionStart).toBe(2);
    expect(draft.selectionEnd).toBe(4);
    expect(dom.window.document.querySelector('textarea')).toBeNull();
  });

  it('preserves the browser error when a write is denied', async () => {
    const denied = new DOMException('Permission denied', 'NotAllowedError');
    Object.defineProperty(dom.window.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(denied) },
    });

    await expect(copyPlainText(shareLink)).rejects.toMatchObject({
      message: expect.stringContaining('请手动复制'),
      cause: denied,
    });
  });
});
