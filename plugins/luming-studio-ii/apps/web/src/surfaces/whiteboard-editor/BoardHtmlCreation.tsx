import { useState } from 'react';
import type { BoardEditReceipt } from '../../data/whiteboard/index.js';
import type { CanvasViewport } from '../../ui/domain/canvas/index.js';
import { HtmlSourceDialog, type EmbedSourceDraft } from '../../ui/domain/objects/embed/index.js';
import type { WhiteboardEditorFeatures } from './board-features.js';
import type { useGeometryEdits } from './geometry-session.js';

type GeometryEditing = ReturnType<typeof useGeometryEdits>;
type AppliedEdit = Extract<BoardEditReceipt, { kind: 'applied' }>;

const initialTitle = 'HTML 图解';
const insertionMargin = 80;

export function useBoardHtmlCreation() {
  const [draft, setDraft] = useState<EmbedSourceDraft>();
  const [submitted, setSubmitted] = useState(false);

  function handleOpen() {
    setDraft({ title: initialTitle, html: '' });
    setSubmitted(false);
  }

  function handleClose() {
    setDraft(undefined);
    setSubmitted(false);
  }

  function complete(receipt: AppliedEdit, ids: readonly string[]) {
    if (receipt.objects.some(({ id, kind }) => kind === 'html' && ids.includes(id))) {
      handleClose();
    }
  }

  function save(geometry: GeometryEditing, viewport: CanvasViewport, canInsert: boolean) {
    if (submitted && geometry.state.kind === 'unknown') {
      geometry.retryEdit();
      return;
    }
    if (!canInsert || !draft?.html.trim()) {
      return;
    }

    setSubmitted(true);
    geometry.handleEdit({
      kind: 'create',
      interactionId: 'create-html',
      object: {
        kind: 'html',
        label: draft.title.trim() || initialTitle,
        geometry: {
          x: (insertionMargin - viewport.x) / viewport.zoom,
          y: (insertionMargin - viewport.y) / viewport.zoom,
          width: 1440,
          height: 1120,
          rotation: 0,
        },
        metadata: { html: draft.html },
      },
    });
  }

  return { draft, submitted, handleOpen, handleClose, setDraft, save, complete };
}

interface BoardHtmlCreationProps {
  readonly creation: ReturnType<typeof useBoardHtmlCreation>;
  readonly geometry: GeometryEditing;
  readonly viewport: CanvasViewport;
  readonly canInsert: boolean;
  readonly readHtmlSource?: WhiteboardEditorFeatures['readHtmlSource'];
  readonly onRestoreFocus: () => void;
}

export function BoardHtmlCreation({
  creation,
  geometry,
  viewport,
  canInsert,
  readHtmlSource,
  onRestoreFocus,
}: BoardHtmlCreationProps) {
  const { draft, submitted } = creation;
  if (!draft) {
    return null;
  }

  const { state } = geometry;
  const busy = state.kind === 'saving' || state.kind === 'checking';
  const error = submitted && 'detail' in state ? state.detail : undefined;

  return (
    <HtmlSourceDialog
      mode="create"
      draft={draft}
      saving={submitted && busy}
      retryOriginal={submitted && state.kind === 'unknown'}
      error={error}
      readHtmlSource={readHtmlSource}
      onChange={creation.setDraft}
      onClose={creation.handleClose}
      onSave={() => creation.save(geometry, viewport, canInsert)}
      onRestoreFocus={onRestoreFocus}
    />
  );
}
