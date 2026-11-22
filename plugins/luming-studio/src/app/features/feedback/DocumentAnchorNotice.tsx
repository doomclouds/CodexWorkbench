import type { Anchor, BoardElement } from '../../../contracts/studio.js';
import { documentAnchorState } from '../../../contracts/document.js';
import type { StudioDocument } from '../../product-contract.js';

export default function DocumentAnchorNotice({
  anchor,
  document,
}: {
  anchor: Anchor;
  document: StudioDocument | null;
}) {
  if (anchor.coordinateSpace !== 'document') {
    return null;
  }

  const elements =
    document && 'elements' in document && Array.isArray(document.elements)
      ? (document.elements as BoardElement[])
      : [];
  const state = documentAnchorState(
    anchor,
    elements.find((element) => element.id === anchor.elementIds?.[0]),
  );

  if (state === 'current') {
    return null;
  }

  return (
    <p className="studio-comment-source-warning" role="status">
      {state === 'missing'
        ? '来源段落已删除，冻结原文仍可读取。'
        : '来源原文已有变化，请核对备注保存的版本。'}
    </p>
  );
}
