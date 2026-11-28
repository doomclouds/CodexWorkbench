import { useEffect, useEffectEvent } from 'react';

interface FeedbackShortcutOptions {
  readonly stage: { readonly current: HTMLDivElement | null };
  readonly anchor?: HTMLElement | null;
  readonly enabled: boolean;
  readonly singleKeys: boolean;
  readonly cancelOutsideCanvas: boolean;
  readonly onBegin: () => void;
  readonly onCancel: () => boolean;
}

const shortcutExclusions =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog[open], [role="dialog"], [role="menu"]';

function inputConsumesShortcut(event: KeyboardEvent) {
  const target = event.target;

  return target instanceof Element && Boolean(target.closest(shortcutExclusions));
}

export function useFeedbackShortcut({
  stage,
  anchor,
  enabled,
  singleKeys,
  cancelOutsideCanvas,
  onBegin,
  onCancel,
}: FeedbackShortcutOptions) {
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      if (onCancel()) {
        event.preventDefault();
      }
      return;
    }

    const modifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
    const queued = event.repeat || event.isComposing;
    const inactive = event.defaultPrevented || modifier || queued;
    if (inactive || event.key !== '9' || !singleKeys) {
      return;
    }

    if (!inputConsumesShortcut(event)) {
      event.preventDefault();
      onBegin();
    }
  });

  useEffect(() => {
    const viewport = stage.current?.parentElement;
    if (!viewport || !enabled) {
      return;
    }

    function handle(event: KeyboardEvent) {
      handleShortcut(event);
    }

    function handleDocumentEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !inputConsumesShortcut(event)) {
        handleShortcut(event);
      }
    }

    viewport.addEventListener('keydown', handle);
    if (anchor && !viewport.contains(anchor)) {
      anchor.addEventListener('keydown', handle);
    }
    if (cancelOutsideCanvas) {
      viewport.ownerDocument.addEventListener('keydown', handleDocumentEscape);
    }

    return () => {
      viewport.removeEventListener('keydown', handle);
      anchor?.removeEventListener('keydown', handle);
      viewport.ownerDocument.removeEventListener('keydown', handleDocumentEscape);
    };
  }, [anchor, cancelOutsideCanvas, enabled, stage]);
}
