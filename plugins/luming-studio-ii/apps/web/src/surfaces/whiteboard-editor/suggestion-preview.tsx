import {
  projectBoardChanges,
  type WhiteboardPayloadResult,
  type WhiteboardReadyState,
} from '../../data/whiteboard/index.js';
import { StatePanel } from '../../ui/base/index.js';
import type { BoardSuggestionPreviewChanges } from './board-features.js';
import { renderBoardHistoryCanvas } from './HistoryCanvasView.js';

function unavailable(id: string): WhiteboardPayloadResult {
  return { kind: 'unavailable', id, reason: 'notFound' };
}

function ignoreSelection() {
  return undefined;
}

export function renderSuggestionPreview(
  key: string,
  state: WhiteboardReadyState,
  changes: BoardSuggestionPreviewChanges,
) {
  if (state.scene.revision !== changes.revision) {
    return <StatePanel kind="error" title="白板已更新" detail="请重新预览所选建议。" />;
  }

  const prepared = projectBoardChanges(state.scene, changes);
  if (!prepared) {
    return <StatePanel kind="error" title="无法显示方案预览" />;
  }

  const scene = { ...prepared, canEdit: false };
  const visible = new Map(scene.objects.map((item) => [item.id, item.payloadVersion]));
  const replacements = new Map(
    changes.payloads.map((result) => [
      result.kind === 'loaded' ? result.payload.id : result.id,
      result,
    ]),
  );

  function loadPayloads(ids: readonly string[], signal?: AbortSignal) {
    signal?.throwIfAborted();
    const results = ids.map((id): WhiteboardPayloadResult => {
      const changed = replacements.get(id);
      if (changed) {
        return changed;
      }

      const body = state.payloads.get(id);

      return body && body.version === visible.get(id)
        ? { kind: 'loaded', payload: body }
        : unavailable(id);
    });

    return Promise.resolve(results);
  }

  return (
    <div key={key} className="whiteboard-editor__history-canvas">
      {renderBoardHistoryCanvas({
        scene,
        loadPayloads,
        selection: changes.objects.map(({ id }) => id),
        onSelectionChange: ignoreSelection,
      })}
    </div>
  );
}
