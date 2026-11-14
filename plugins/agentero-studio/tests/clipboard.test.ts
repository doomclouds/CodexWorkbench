import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { copyPlainText } from '../src/app/clipboard';

let dom: JSDOM;
beforeEach(() => {
  dom = new JSDOM('<input id="draft" value="保留我的草稿"><div id="source" contenteditable="true" tabindex="0">原有选区</div>');
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('navigator', dom.window.navigator); vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
});
afterEach(() => { vi.unstubAllGlobals(); dom.window.close(); });

describe('link clipboard compatibility', () => {
  it('uses the asynchronous clipboard when permission is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    await copyPlainText('http://board.example/share');
    expect(writeText).toHaveBeenCalledWith('http://board.example/share');
    expect(dom.window.document.querySelector('textarea')).toBeNull();
  });
  it.each(['unavailable', 'denied'])('copies when the clipboard API is %s and restores the original focus and selection', async reason => {
    if (reason === 'denied') Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('NotAllowedError')) }, configurable: true });
    const draft = dom.window.document.getElementById('draft') as HTMLInputElement;
    draft.focus(); draft.setSelectionRange(2, 4);
    const execCommand = vi.fn(() => {
      expect((dom.window.document.activeElement as HTMLTextAreaElement).value).toBe('http://board.example/share');
      return true;
    });
    Object.defineProperty(dom.window.document, 'execCommand', { value: execCommand, configurable: true });
    await copyPlainText('http://board.example/share');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(dom.window.document.activeElement).toBe(draft); expect(draft.value).toBe('保留我的草稿');
    expect(draft.selectionStart).toBe(2); expect(draft.selectionEnd).toBe(4);
    expect(dom.window.document.querySelector('textarea')).toBeNull();
  });
  it('preserves a focused contenteditable selection', async () => {
    const source = dom.window.document.getElementById('source') as HTMLElement; source.focus();
    const range = dom.window.document.createRange(); range.selectNodeContents(source);
    dom.window.getSelection()!.removeAllRanges(); dom.window.getSelection()!.addRange(range);
    expect(dom.window.getSelection()!.toString()).toBe('原有选区');
    Object.defineProperty(dom.window.document, 'execCommand', { value: vi.fn(() => true), configurable: true });
    await copyPlainText('http://board.example/share');
    expect(dom.window.document.activeElement).toBe(source);
    expect(dom.window.getSelection()!.toString()).toBe('原有选区');
  });
  it('reports a failed copy and removes its temporary input', async () => {
    Object.defineProperty(dom.window.document, 'execCommand', { value: vi.fn(() => false), configurable: true });
    await expect(copyPlainText('http://board.example/share')).rejects.toThrow('未能复制');
    expect(dom.window.document.querySelector('textarea')).toBeNull();
  });
});
