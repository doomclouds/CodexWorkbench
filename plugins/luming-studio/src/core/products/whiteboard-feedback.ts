import { documentBlockText, flattenDocumentBlocks } from '../../contracts/document.js';
import { isCommentPin, type Anchor, type BoardElement } from '../../contracts/studio.js';
import { isTodoId, normalizeTodoItems, type TodoItem } from '../../contracts/todo.js';
import { copy, finite, object, safeId, same, StudioError } from '../shared/common.js';
import type { Snapshot, UnitClock } from '../shared/model.js';
import type { SourceSnapshot, WhiteboardContent } from './whiteboard.js';

export function htmlSource(
  snapshots: readonly Snapshot<WhiteboardContent>[],
  regionId: string,
  requested?: unknown,
) {
  for (const snapshot of requested === undefined ? snapshots.slice(0, 1) : snapshots) {
    const region = snapshot.content.elements.find(
      (item) => item.id === regionId && typeof item.html === 'string',
    );

    if (region && (requested === undefined || (region.sourceRevision ?? 1) === requested)) {
      return { region, snapshot };
    }
  }

  throw new StudioError('NOT_FOUND', 'HTML 区域或对应的源码版本不存在。');
}

function validateAnchorShape(anchor: Anchor): void {
  const { pin, elementIds, coordinateSpace } = anchor;
  if (pin !== undefined) {
    const compatiblePin =
      isCommentPin(pin) &&
      (pin.coordinateSpace === 'board' || pin.coordinateSpace === coordinateSpace);

    if (!compatiblePin) {
      throw new StudioError('INVALID_ARGUMENT', '备注气泡位置无效。');
    }
  }
  if (
    elementIds !== undefined &&
    (!Array.isArray(elementIds) || elementIds.some((id) => typeof id !== 'string'))
  ) {
    throw new StudioError('INVALID_ARGUMENT', '备注元素定位无效。');
  }
  if (
    coordinateSpace !== undefined &&
    !['board', 'element', 'html', 'document', 'todo'].includes(coordinateSpace)
  ) {
    throw new StudioError('INVALID_ARGUMENT', '备注坐标空间无效。');
  }
}

function validRelativeCoordinates(anchor: Anchor): boolean {
  return ![anchor.x, anchor.y].some((value) => value !== undefined && (value < 0 || value > 1));
}

function validateAnchorGeometry(anchor: Anchor): void {
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    if (anchor[key] !== undefined) {
      finite(anchor[key], 0);
    }
  }

  if ((anchor.w ?? 0) < 0 || (anchor.h ?? 0) < 0) {
    throw new StudioError('INVALID_ARGUMENT', '备注范围尺寸不能为负数。');
  }
  if (
    anchor.coordinateSpace === 'element' &&
    (!anchor.elementIds?.length || !validRelativeCoordinates(anchor))
  ) {
    throw new StudioError('INVALID_ARGUMENT', '对象备注需要定位对象，且相对坐标须在 0 到 1 之间。');
  }
  if (anchor.coordinateSpace === 'html' && !anchor.regionId) {
    throw new StudioError('INVALID_ARGUMENT', 'HTML 备注需要区域 ID。');
  }
}

function validateDocumentAnchor(
  anchor: Anchor,
  versions: Record<string, number> | undefined,
): Record<string, number> | undefined {
  const { elementIds, blockIds, sourceVersion } = anchor;
  const validCount = Array.isArray(blockIds) && blockIds.length > 0 && blockIds.length <= 100;
  const validBlock = (id: unknown) =>
    typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(id);

  if (elementIds?.length !== 1 || !validCount || !blockIds.every(validBlock)) {
    throw new StudioError('INVALID_ARGUMENT', '文档备注需要一个文档及实际段落 ID。');
  }
  if (sourceVersion === undefined) {
    return versions;
  }
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1) {
    throw new StudioError('INVALID_ARGUMENT', '文档来源版本无效。');
  }

  const id = elementIds[0]!;
  if (versions && versions[id] !== sourceVersion) {
    throw new StudioError('INVALID_ARGUMENT', '文档来源版本与选区版本不一致。');
  }

  return versions || { [id]: sourceVersion };
}

function validateTodoAnchor(
  anchor: Anchor,
  versions: Record<string, number> | undefined,
): Record<string, number> {
  const { elementIds, regionId, itemId, sourceVersion } = anchor;
  const validTarget = elementIds?.length === 1 && regionId === undefined && isTodoId(itemId);
  if (!validTarget || !validRelativeCoordinates(anchor)) {
    throw new StudioError(
      'INVALID_ARGUMENT',
      '任务备注需要一个清单和实际任务行 ID，行内坐标须在 0 到 1 之间。',
    );
  }
  if (sourceVersion === undefined || !Number.isSafeInteger(sourceVersion) || sourceVersion < 1) {
    throw new StudioError('INVALID_ARGUMENT', '任务行备注需要有效的来源版本。');
  }

  const id = elementIds[0]!;
  if (versions && versions[id] !== sourceVersion) {
    throw new StudioError('INVALID_ARGUMENT', '任务行来源版本与选区版本不一致。');
  }

  return versions || { [id]: sourceVersion };
}

function validateHtmlAnchor(anchor: Anchor): void {
  const { sourceRevision, regionId, targetIds } = anchor;
  if (sourceRevision !== undefined) {
    if (!Number.isInteger(sourceRevision) || sourceRevision < 1 || !regionId) {
      throw new StudioError('INVALID_ARGUMENT', '备注源码版本无效。');
    }
  }
  if (targetIds !== undefined) {
    const invalidId = (id: unknown) =>
      typeof id !== 'string' || id.length > 160 || /[\u0000-\u001f]/.test(id);

    if (!Array.isArray(targetIds) || targetIds.length > 100 || targetIds.some(invalidId)) {
      throw new StudioError('INVALID_ARGUMENT', 'HTML 备注目标无效。');
    }
  }

  for (const [key, limit] of [
    ['quote', 4000],
    ['excerpt', 16000],
    ['selector', 1200],
  ] as const) {
    const text = anchor[key];
    if (text !== undefined && (typeof text !== 'string' || text.length > limit)) {
      throw new StudioError('INVALID_ARGUMENT', '备注来源文字无效或过长。');
    }
  }
}

function selectVersionedElement(
  id: string,
  version: number,
  snapshots: readonly Snapshot<WhiteboardContent>[],
  sourceRevision?: number,
): BoardElement {
  let selected: BoardElement | undefined;
  let ambiguous = false;
  for (const snapshot of snapshots) {
    const candidate = snapshot.content.elements.find(
      (element) => element.id === id && element.version === version,
    );
    const matchesSource =
      sourceRevision === undefined || candidate?.sourceRevision === sourceRevision;

    if (!candidate || !matchesSource) {
      continue;
    }

    if (selected && !same(selected, candidate)) {
      ambiguous = true;
    }

    selected = candidate;
  }

  if (!selected || ambiguous) {
    throw new StudioError('CONFLICT', '原选区的对象版本已不可用，请重新选择目标后保存备注。', {
      elementId: id,
      version,
    });
  }

  return selected;
}

function selectFeedbackElements(
  anchor: Anchor,
  snapshots: readonly Snapshot<WhiteboardContent>[],
  versions?: Record<string, number>,
): BoardElement[] {
  const ids = [
    ...new Set([
      ...(anchor.regionId !== undefined ? [safeId(anchor.regionId, '区域 ID')] : []),
      ...(anchor.elementIds ?? []).map((id) => safeId(id, '元素 ID')),
    ]),
  ];

  if (
    versions &&
    (ids.some((id) => !Object.hasOwn(versions, id)) ||
      Object.keys(versions).some((id) => !ids.includes(id)))
  ) {
    throw new StudioError('INVALID_ARGUMENT', '备注选区需要提供全部目标对象的版本。');
  }

  const current = snapshots[0]!;
  if (ids.some((id) => !current.content.elements.some((element) => element.id === id))) {
    throw new StudioError('NOT_FOUND', '备注定位的对象已不存在。');
  }

  const source = anchor.regionId
    ? htmlSource(snapshots, anchor.regionId, anchor.sourceRevision).snapshot
    : current;

  return ids.map((id) => {
    if (versions) {
      const sourceRevision = id === anchor.regionId ? anchor.sourceRevision : undefined;

      return selectVersionedElement(id, versions[id]!, snapshots, sourceRevision);
    }

    return (
      source.content.elements.find((element) => element.id === id) ??
      current.content.elements.find((element) => element.id === id)!
    );
  });
}

const normalizeQuote = (value: string) => value.replace(/\s+/g, ' ').trim();

function confirmDocumentSelection(anchor: Anchor, element: BoardElement): void {
  if (element.type !== 'document' || !element.document) {
    throw new StudioError('INVALID_ARGUMENT', '备注目标不是文档区域。');
  }

  const blocks = flattenDocumentBlocks(element.document.blocks);
  const selected = anchor.blockIds!.map((id) => blocks.find((block) => block.id === id));
  if (selected.some((block) => !block)) {
    throw new StudioError('CONFLICT', '原选区的段落已不可用，请重新选择。');
  }
  if (
    anchor.quote &&
    !normalizeQuote(selected.map((block) => documentBlockText(block!)).join('\n')).includes(
      normalizeQuote(anchor.quote),
    )
  ) {
    throw new StudioError('CONFLICT', '选中文字不属于所提供的文档段落版本。');
  }

  anchor.sourceVersion = element.version;
}

function confirmTodoSelection(anchor: Anchor, element: BoardElement): TodoItem {
  if (element.type !== 'todo') {
    throw new StudioError('INVALID_ARGUMENT', '备注目标不是任务清单。');
  }

  const item = normalizeTodoItems(element.data?.items).find(
    (candidate) => candidate.id === anchor.itemId,
  );

  if (
    !item ||
    (anchor.quote && !normalizeQuote(item.text).includes(normalizeQuote(anchor.quote)))
  ) {
    throw new StudioError('CONFLICT', '选中的任务行或原文字不属于所提供的来源版本。');
  }

  anchor.sourceVersion = element.version;

  return item;
}

function confirmReferencedIncarnations(
  elements: readonly BoardElement[],
  coordinateSpace: Anchor['coordinateSpace'],
  clocks: Record<string, UnitClock> | undefined,
): void {
  if (
    coordinateSpace !== 'element' &&
    coordinateSpace !== 'document' &&
    coordinateSpace !== 'todo'
  ) {
    return;
  }

  for (const element of elements) {
    if (element.version < (clocks?.[element.id]?.incarnationStart ?? 1)) {
      throw new StudioError('CONFLICT', '原选区属于已删除的对象，请重新选择目标后保存备注。', {
        elementId: element.id,
        version: element.version,
      });
    }
  }
}

function feedbackSource(
  artifactId: string,
  feedbackId: string,
  element: BoardElement,
  todoItem: TodoItem | undefined,
): SourceSnapshot {
  if (typeof element.html === 'string') {
    const sourceRevision = Number(element.sourceRevision ?? 1);

    return {
      artifactId,
      feedbackId,
      element: copy(element),
      html: element.html,
      regionId: element.id,
      sourceRevision,
      version: sourceRevision,
    };
  }

  return {
    artifactId,
    feedbackId,
    elementId: element.id,
    element: todoItem ? { ...copy(element), data: { items: [todoItem] } } : copy(element),
    version: element.version,
  };
}

export function snapshotFeedback(
  artifactId: string,
  feedbackId: string,
  snapshots: readonly Snapshot<WhiteboardContent>[],
  value: unknown,
  versions?: Record<string, number>,
  clocks?: Record<string, UnitClock>,
) {
  const anchor: Anchor = object(value) ? copy(value) : {};
  validateAnchorShape(anchor);
  validateAnchorGeometry(anchor);

  let selectedVersions = versions;
  if (anchor.coordinateSpace === 'document') {
    selectedVersions = validateDocumentAnchor(anchor, versions);
  }
  if (anchor.coordinateSpace === 'todo') {
    selectedVersions = validateTodoAnchor(anchor, versions);
  }

  validateHtmlAnchor(anchor);
  const elements = selectFeedbackElements(anchor, snapshots, selectedVersions);

  if (anchor.coordinateSpace === 'document') {
    confirmDocumentSelection(anchor, elements[0]!);
  }

  const todoItem =
    anchor.coordinateSpace === 'todo' ? confirmTodoSelection(anchor, elements[0]!) : undefined;
  confirmReferencedIncarnations(elements, anchor.coordinateSpace, clocks);

  return {
    anchor,
    versions: Object.fromEntries(elements.map((element) => [element.id, element.version])),
    sources: elements.map((element) => feedbackSource(artifactId, feedbackId, element, todoItem)),
  };
}
