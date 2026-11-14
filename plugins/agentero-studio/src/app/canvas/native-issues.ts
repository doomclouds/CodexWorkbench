export interface NativeIssue { type: string; message: string; ids: string[] }

/** Only report measured, visible native content. No layout engine means no guessed issues. */
export function measureNativeIssues(viewport: HTMLElement): NativeIssue[] {
  const visible = viewport.getBoundingClientRect();
  if (visible.width <= 0 || visible.height <= 0) return [];
  const issues: NativeIssue[] = [], seen = new Set<string>();
  for (const node of viewport.querySelectorAll<HTMLElement>('.studio-element-text, .studio-section-title, .studio-board-table td, .studio-board-table th, .studio-link-card strong, .studio-link-card span, .studio-arrow-label')) {
    const owner = node.closest<HTMLElement>('[data-element-id]'), id = owner?.dataset.elementId;
    if (!id || seen.has(id) || node.querySelector('textarea') || !node.textContent?.trim()) continue;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.right <= visible.left || rect.left >= visible.right || rect.bottom <= visible.top || rect.top >= visible.bottom) continue;
    const computed = viewport.ownerDocument.defaultView?.getComputedStyle(node);
    if (computed?.display === 'none' || computed?.visibility === 'hidden') continue;
    let overflow = node.clientWidth > 0 && node.clientHeight > 0 && (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1);
    // Range measures text ink when a table or flex item grows instead of exposing scroll overflow.
    let outside = false;
    const range = viewport.ownerDocument.createRange(); range.selectNodeContents(node);
    if (typeof range.getBoundingClientRect === 'function') {
      const ink = range.getBoundingClientRect();
      if (ink.width > 0 && ink.height > 0) overflow ||= ink.left < rect.left - 1 || ink.right > rect.right + 1 || ink.top < rect.top - 1 || ink.bottom > rect.bottom + 1;
      if (!node.classList.contains('studio-section-title') && owner && !owner.classList.contains('studio-canvas-arrow')) {
        const box = owner.getBoundingClientRect();
        outside = box.width > 0 && box.height > 0 && ink.width > 0 && ink.height > 0 && (ink.left < box.left - 1 || ink.right > box.right + 1 || ink.top < box.top - 1 || ink.bottom > box.bottom + 1);
      }
    }
    if (overflow || outside) { seen.add(id); issues.push({ type: outside ? 'native-text-out-of-bounds' : 'native-text-overflow', message: outside ? '可见文字超出了对象边界。' : '可见文字超出了可用显示范围。', ids: [id] }); }
    if (issues.length === 5) break;
  }
  return issues;
}
