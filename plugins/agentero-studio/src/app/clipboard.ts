/** Copy from the initiating document, including sandboxed and plain-HTTP pages. */
export async function copyPlainText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  } catch { /* The host may block the asynchronous clipboard API in its iframe. */ }
  const active = document.activeElement;
  const field = active as HTMLInputElement | HTMLTextAreaElement | null;
  const inputSelection = field && typeof field.selectionStart === 'number' ? { start: field.selectionStart, end: field.selectionEnd!, direction: field.selectionDirection ?? undefined } : null;
  const selection = window.getSelection();
  const ranges = selection && !inputSelection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
  const input = document.createElement('textarea');
  input.value = text; input.readOnly = true; input.tabIndex = -1; input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.append(input);
  try {
    input.focus({ preventScroll: true }); input.select();
    if (!document.execCommand?.('copy')) throw new Error('未能复制链接，请重试。');
  } finally {
    input.remove();
    if (active instanceof HTMLElement && active.isConnected) active.focus({ preventScroll: true });
    if (inputSelection && field?.isConnected) field.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction);
    if (selection && ranges.length) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
  }
}
