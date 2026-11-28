import { useEffectEvent, useLayoutEffect, useState } from 'react';
import type { LinkCanvasViewProps } from './canvas-extension.js';
import { LinkDialog, type LinkDraft } from './LinkDialog.js';
import { LinkObject } from './LinkObject.js';

interface OpenLink {
  readonly request: number;
  readonly version: number;
  readonly draft: LinkDraft;
}

const minimumTextSize = { width: 32, height: 12, font: 8 };
const defaultLinkFont = 17;

function visibleText({ geometry, zoom, expanded, focusedReading }: LinkCanvasViewProps) {
  const dimensionsFit =
    geometry.width * zoom >= minimumTextSize.width &&
    geometry.height * zoom >= minimumTextSize.height;
  const textFits = dimensionsFit && defaultLinkFont * zoom >= minimumTextSize.font;

  return Boolean(textFits || expanded || focusedReading);
}

function linkAddress(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  if ('href' in value && typeof value.href === 'string') {
    return value.href;
  }
}

export function LinkView(props: LinkCanvasViewProps) {
  const { object, payload, interactive, editRequest, readOnly, request, onRetentionChange } = props;
  const href = linkAddress(payload?.value);
  const [handled, setHandled] = useState<number>();
  const [editor, setEditor] = useState<OpenLink>();
  const retain = useEffectEvent((retained: boolean) => onRetentionChange?.(retained));
  const writable = !readOnly;
  const open = editor !== undefined;
  const reportEditing = useEffectEvent(() => {
    props.onEditingChange?.(true);

    return () => props.onEditingChange?.(false);
  });
  useLayoutEffect(() => {
    if (open && writable) {
      return reportEditing();
    }
  }, [open, writable]);

  if (editRequest !== handled) {
    setHandled(editRequest);
    if (writable && payload && editRequest !== undefined) {
      setEditor({
        request: editRequest,
        version: payload.version,
        draft: { title: object.label, href: href ?? '' },
      });
    }
  }

  useLayoutEffect(() => {
    if (open) {
      retain(true);
      return () => retain(false);
    }
  }, [open]);

  function handleClose() {
    setEditor(undefined);
  }

  async function handleSave(draft: LinkDraft) {
    if (!editor || !writable) {
      return false;
    }

    const result = await request({
      name: 'link.commit',
      expectedVersion: editor.version,
      value: draft,
    });

    if (!result.ok) {
      throw new Error(result.message);
    }

    return true;
  }

  return (
    <>
      <LinkObject
        label={object.label}
        href={href}
        interactive={interactive}
        showDetails={visibleText(props)}
      />
      {editor && (
        <LinkDialog
          key={editor.request}
          initial={editor.draft}
          readOnly={!writable}
          onClose={handleClose}
          onSave={handleSave}
        />
      )}
    </>
  );
}
