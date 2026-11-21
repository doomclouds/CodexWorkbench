export interface NativeIssue {
  type: string;
  message: string;
  ids: string[];
}

function intersectsViewport(rect: DOMRect, viewport: DOMRect): boolean {
  const crossesHorizontal = rect.right > viewport.left && rect.left < viewport.right;
  const crossesVertical = rect.bottom > viewport.top && rect.top < viewport.bottom;
  const hasArea = Boolean(rect.width && rect.height);

  return hasArea && crossesHorizontal && crossesVertical;
}

function inkExceedsBox(ink: DOMRect, box: DOMRect): boolean {
  const outsideHorizontal = ink.left < box.left - 1 || ink.right > box.right + 1;
  const outsideVertical = ink.top < box.top - 1 || ink.bottom > box.bottom + 1;

  return outsideHorizontal || outsideVertical;
}

function measureInk(node: HTMLElement): DOMRect | undefined {
  const range = node.ownerDocument.createRange();
  range.selectNodeContents(node);
  if (typeof range.getBoundingClientRect !== 'function') {
    return undefined;
  }

  const rect = range.getBoundingClientRect();

  return rect.width > 0 && rect.height > 0 ? rect : undefined;
}

function hasScrollOverflow(node: HTMLElement) {
  const hasViewport = node.clientWidth > 0 && node.clientHeight > 0;
  const exceedsViewport =
    node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1;

  return hasViewport && exceedsViewport;
}

function inkExceedsOwner(node: HTMLElement, owner: HTMLElement, ink?: DOMRect): boolean {
  const positionIndependent =
    node.classList.contains('studio-section-title') ||
    owner.classList.contains('studio-canvas-arrow');

  if (!ink || positionIndependent) {
    return false;
  }

  const bounds = owner.getBoundingClientRect();

  return bounds.width > 0 && bounds.height > 0 && inkExceedsBox(ink, bounds);
}

function measureVisibleText(
  node: HTMLElement,
  owner: HTMLElement,
  visible: DOMRect,
  id: string,
): NativeIssue | undefined {
  if (node.querySelector('textarea') || !node.textContent?.trim()) {
    return undefined;
  }

  const rect = node.getBoundingClientRect();
  if (!intersectsViewport(rect, visible)) {
    return undefined;
  }

  const computed = node.ownerDocument.defaultView?.getComputedStyle(node);
  if (computed?.display === 'none' || computed?.visibility === 'hidden') {
    return undefined;
  }

  const ink = measureInk(node);
  if (inkExceedsOwner(node, owner, ink)) {
    return { type: 'native-text-out-of-bounds', message: '可见文字超出了对象边界。', ids: [id] };
  }
  if (hasScrollOverflow(node) || (ink && inkExceedsBox(ink, rect))) {
    return { type: 'native-text-overflow', message: '可见文字超出了可用显示范围。', ids: [id] };
  }

  return undefined;
}

export function measureNativeIssues(viewport: HTMLElement): NativeIssue[] {
  const visible = viewport.getBoundingClientRect();
  if (visible.width <= 0 || visible.height <= 0) {
    return [];
  }

  const issues: NativeIssue[] = [];
  const seen = new Set<string>();
  for (const node of viewport.querySelectorAll<HTMLElement>(
    '.studio-element-text, .studio-section-title, .studio-board-table td, .studio-board-table th, .studio-link-card strong, .studio-link-card span, .studio-arrow-label',
  )) {
    const owner = node.closest<HTMLElement>('[data-element-id]');
    const id = owner?.dataset.elementId;
    if (!owner || !id || seen.has(id)) {
      continue;
    }

    const issue = measureVisibleText(node, owner, visible, id);
    if (!issue) {
      continue;
    }

    seen.add(id);
    issues.push(issue);
    if (issues.length === 5) {
      break;
    }
  }

  return issues;
}
