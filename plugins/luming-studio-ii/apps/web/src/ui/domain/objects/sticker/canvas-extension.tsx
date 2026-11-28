import { useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { StatusText } from '../../../base/index.js';
import type { CanvasObjectExtension, CanvasObjectViewProps } from '../../canvas/index.js';
import { stickerDefinition } from './sticker-catalog.js';
import { StickerObject } from './StickerObject.js';

export interface StickerCanvasValue {
  readonly id?: string;
  readonly fallback?: string;
}

interface StickerDraft {
  readonly editRequest: number;
  readonly expectedVersion: number;
  readonly initialText: string;
}

interface StickerEditorProps {
  readonly draft: StickerDraft;
  readonly readOnly: boolean;
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

function LegacyStickerEditor({
  draft,
  readOnly,
  request,
  onRetentionChange,
  onClose,
}: StickerEditorProps) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [text, setText] = useState(draft.initialText);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const retain = useEffectEvent((retained: boolean) => onRetentionChange?.(retained));

  useLayoutEffect(() => {
    retain(true);
    input.current?.focus({ preventScroll: true });
    input.current?.select();

    return () => retain(false);
  }, []);

  function handleSave() {
    if (pending.current || readOnly) {
      return;
    }

    if (text === draft.initialText) {
      onClose();
      return;
    }

    pending.current = true;
    setBusy(true);
    setMessage('');
    request({
      name: 'sticker.select',
      expectedVersion: draft.expectedVersion,
      value: { fallback: text },
    })
      .then((result) => {
        if (result.ok) {
          onClose();
        } else {
          setMessage(result.message);
        }
      })
      .finally(() => {
        pending.current = false;
        setBusy(false);
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : '保存贴纸文字失败。');
      });
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (pending.current || event.nativeEvent.isComposing || event.key === 'Process') {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      handleSave();
    }
  }

  return (
    <div className="luming-sticker-editor" data-canvas-native="">
      <input
        ref={input}
        type="text"
        aria-label="编辑文字"
        value={text}
        readOnly={busy || readOnly}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={handleKey}
        onBlur={handleSave}
      />
      {message && <StatusText message={message} tone="error" announcement="assertive" />}
    </div>
  );
}

function StickerView({
  object,
  payload,
  readOnly,
  editRequest,
  request,
  onRetentionChange,
}: CanvasObjectViewProps) {
  const { id: storedId, fallback } = stickerValue(payload?.value);
  const id = payload ? storedId : readText(object.metadata?.stickerId);
  const text = fallback ?? object.label;
  const graphic = stickerDefinition(id);
  const canOpenLegacy = !graphic && !readOnly;
  const [seen, setSeen] = useState<number>();
  const [draft, setDraft] = useState<StickerDraft>();

  if (seen !== editRequest) {
    setSeen(editRequest);
    if (canOpenLegacy && payload && editRequest !== undefined) {
      setDraft({ editRequest, expectedVersion: payload.version, initialText: text });
    }
  }
  if (draft && graphic) {
    setDraft(undefined);
  }

  if (draft && !graphic) {
    return (
      <LegacyStickerEditor
        key={draft.editRequest}
        draft={draft}
        readOnly={readOnly}
        request={request}
        onRetentionChange={onRetentionChange}
        onClose={() => setDraft((current) => (current === draft ? undefined : current))}
      />
    );
  }

  return <StickerObject id={id} fallback={text} />;
}

export const stickerExtension = {
  kind: 'sticker',
  blocksPlacement: false,
  capabilities: { move: true, resize: true, rotate: true, connect: false, content: 'passive' },
  placement: { kind: 'sticker', label: '贴纸', width: 64, height: 64 },
  View: StickerView,
} satisfies CanvasObjectExtension;
