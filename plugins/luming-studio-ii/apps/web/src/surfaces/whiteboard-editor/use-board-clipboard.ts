import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import {
  expandCanvasSelection,
  type CanvasObject,
  type CanvasPoint,
} from '../../ui/domain/canvas/index.js';
import type { BoardClipboardAccess } from './board-features.js';
import {
  boardClipboardText,
  canvasOwnsClipboard,
  encodeBoardSelection,
  readBoardClipboard,
  readClipboardEvent,
  writeClipboardEvent,
} from './board-clipboard.js';
import type { BoardClipboardSelection, GeometrySelectionAction } from './geometry-commands.js';

interface ClipboardOptions {
  readonly clipboard?: BoardClipboardAccess;
  readonly sourceBoardId: string;
  readonly sourceRevision: bigint;
  readonly objects: readonly CanvasObject[];
  readonly selection: readonly string[];
  readonly active: boolean;
  readonly canEdit: boolean;
  readonly hasLockedSelection: boolean;
  readonly onSelectionAction: (action: GeometrySelectionAction, ids: readonly string[]) => void;
  readonly onObjects: (source: BoardClipboardSelection) => void;
  readonly onText: (text: string) => void;
  readonly onMedia: (files: readonly File[], point?: CanvasPoint) => boolean;
}

const textLimit = 20_000;

export function useBoardClipboard(options: ClipboardOptions) {
  const { clipboard, selection, active, canEdit, hasLockedSelection } = options;
  const canCut = canEdit && !hasLockedSelection;
  const [remembered, setRemembered] = useState<string>();
  const [issue, setIssue] = useState<string>();
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current += 1;
    },
    [],
  );

  function report(error: unknown) {
    setIssue(error instanceof Error ? error.message : '白板剪贴板操作失败。');
  }

  function content(cut: boolean) {
    const { sourceBoardId, sourceRevision, objects } = options;
    const objectIds = expandCanvasSelection(objects, selection, cut ? 'move' : 'copy');

    return encodeBoardSelection({ sourceBoardId, sourceRevision, objectIds });
  }

  function paste(text: string, encoded?: string) {
    const source = readBoardClipboard(text, encoded);
    if (source) {
      options.onObjects(source);
    } else if (text.trim()) {
      options.onText(text.slice(0, textLimit));
    }
  }

  async function menuAction(kind: 'copy' | 'cut' | 'paste') {
    const request = ++latest.current;
    setIssue(undefined);
    if (kind === 'paste') {
      const text = clipboard ? await clipboard.readText() : '';
      if (latest.current === request) {
        paste(text, text ? undefined : remembered);
      }
      return;
    }

    const cut = kind === 'cut';
    if (cut && !canCut) {
      return;
    }

    const value = content(cut);
    await clipboard?.writeText(boardClipboardText(value));
    if (latest.current === request) {
      setRemembered(value);
      if (cut) {
        options.onSelectionAction({ kind: 'delete' }, selection);
      }
    }
  }

  function onCopy(event: ClipboardEvent<HTMLDivElement>, cut = false) {
    const unrestricted = active && (!cut || canCut);
    if (!unrestricted || selection.length === 0 || !canvasOwnsClipboard(event)) {
      return;
    }

    try {
      const value = content(cut);
      writeClipboardEvent(event, value);
      setIssue(undefined);
      setRemembered(value);
      if (cut) {
        options.onSelectionAction({ kind: 'delete' }, selection);
      }
    } catch (error) {
      report(error);
    }
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    if (!canEdit || !canvasOwnsClipboard(event)) {
      return;
    }

    const files = Array.from(event.clipboardData.files);
    if (files.length > 0 && options.onMedia(files)) {
      event.preventDefault();
      return;
    }

    const { text, encoded } = readClipboardEvent(event);
    if (!text.trim() && !encoded) {
      return;
    }

    event.preventDefault();
    try {
      setIssue(undefined);
      paste(text, encoded);
    } catch (error) {
      report(error);
    }
  }

  return {
    issue,
    dismiss: () => setIssue(undefined),
    menu: {
      copy: active
        ? () => {
            void menuAction('copy').catch(report);
          }
        : undefined,
      cut: canCut
        ? () => {
            void menuAction('cut').catch(report);
          }
        : undefined,
      paste:
        canEdit && (clipboard || remembered)
          ? () => {
              void menuAction('paste').catch(report);
            }
          : undefined,
    },
    handlers: {
      onCopy,
      onCut: (event: ClipboardEvent<HTMLDivElement>) => onCopy(event, true),
      onPaste,
    },
  };
}
