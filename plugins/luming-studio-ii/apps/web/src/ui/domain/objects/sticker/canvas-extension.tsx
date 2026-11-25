import { useEffect, useRef, useState } from 'react';
import { Dialog, StatusText } from '../../../base/index.js';
import type { CanvasObjectExtension, CanvasObjectViewProps } from '../../canvas/index.js';
import type { StickerPreset } from './sticker-catalog.js';
import { StickerObject } from './StickerObject.js';
import { StickerPalette } from './StickerPalette.js';

export interface StickerCanvasValue {
  readonly id?: string;
  readonly fallback?: string;
}

interface StickerDraft {
  readonly editRequest: number;
  readonly expectedVersion: number;
}

interface StickerEditorProps {
  readonly draft: StickerDraft;
  readonly selected?: string;
  readonly request: CanvasObjectViewProps['request'];
  readonly onRetentionChange?: CanvasObjectViewProps['onRetentionChange'];
  readonly onClose: () => void;
}

function readText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stickerValue(value: unknown): StickerCanvasValue {
  if (value === null || typeof value !== 'object') {
    return {};
  }

  return {
    id: 'id' in value ? readText(value.id) : undefined,
    fallback: 'fallback' in value ? readText(value.fallback) : undefined,
  };
}

function StickerEditor({
  draft,
  selected,
  request,
  onRetentionChange,
  onClose,
}: StickerEditorProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(false);

  useEffect(() => {
    onRetentionChange?.(true);

    return () => onRetentionChange?.(false);
  }, [onRetentionChange]);

  function handleClose() {
    if (!pending.current) {
      onClose();
    }
  }

  async function save(sticker: StickerPreset) {
    if (pending.current) {
      return;
    }

    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      const receipt = await request({
        name: 'sticker.select',
        expectedVersion: draft.expectedVersion,
        value: { id: sticker.id },
      });

      if (receipt.ok) {
        onClose();
      } else {
        setMessage(receipt.message);
      }
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : '更换贴纸失败。');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="luming-sticker-edit-layer" data-canvas-native="">
      <Dialog
        open
        title="贴纸库"
        closeLabel="关闭贴纸库"
        dismissPolicy={{ escape: !busy }}
        onRequestClose={handleClose}
      >
        <StickerPalette
          selectedId={selected}
          onSelect={(sticker) => void save(sticker)}
          disabled={busy}
        />
        {message && <StatusText message={message} tone="error" announcement="assertive" />}
      </Dialog>
    </div>
  );
}

function StickerView({
  object,
  payload,
  readOnly,
  locked,
  editRequest,
  request,
  onRetentionChange,
}: CanvasObjectViewProps) {
  const { id, fallback } = stickerValue(payload?.value);
  const canEdit = !readOnly && !locked && payload !== undefined;
  const [seen, setSeen] = useState<number>();
  const [draft, setDraft] = useState<StickerDraft>();
  if (seen !== editRequest) {
    setSeen(editRequest);
    if (canEdit && editRequest !== undefined) {
      setDraft({ editRequest, expectedVersion: payload.version });
    }
  }
  if (draft && !canEdit) {
    setDraft(undefined);
  }

  return (
    <>
      <StickerObject id={id} fallback={fallback ?? object.label} />
      {draft && canEdit && (
        <StickerEditor
          key={draft.editRequest}
          draft={draft}
          selected={id}
          request={request}
          onRetentionChange={onRetentionChange}
          onClose={() => setDraft((current) => (current === draft ? undefined : current))}
        />
      )}
    </>
  );
}

export const stickerExtension = {
  kind: 'sticker',
  blocksPlacement: false,
  capabilities: { move: true, resize: true, rotate: true, connect: false, content: 'passive' },
  placement: { kind: 'sticker', label: '贴纸', width: 64, height: 64 },
  View: StickerView,
} satisfies CanvasObjectExtension;
