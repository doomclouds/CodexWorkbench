import type { McpRestoredView } from './context.js';

export type McpStudioLocation =
  | { readonly kind: 'workbench' }
  | { readonly kind: 'whiteboard'; readonly boardId: string }
  | { readonly kind: 'recycle-bin' };

type Listener = () => void;

function sameLocation(first: McpStudioLocation, second: McpStudioLocation) {
  if (first.kind === 'whiteboard' && second.kind === 'whiteboard') {
    return first.boardId === second.boardId;
  }

  return first.kind === second.kind;
}

export function createMcpNavigation(readOpeningId: () => string | number | undefined) {
  let location: McpStudioLocation = { kind: 'workbench' };
  let writtenLocally = false;
  let openingId: string | number | undefined;
  let restoredView: McpRestoredView | undefined;
  const listeners = new Set<Listener>();

  function setLocation(next: McpStudioLocation) {
    if (!sameLocation(location, next)) {
      location = next;
      for (const listener of listeners) {
        listener();
      }
    }
  }

  return {
    read: () => location,
    readBoardView: () => restoredView,
    write(next: McpStudioLocation) {
      openingId ??= readOpeningId();
      writtenLocally = true;
      restoredView = undefined;
      location = next;
    },
    restore(view: McpRestoredView) {
      openingId ??= readOpeningId();
      writtenLocally = true;
      restoredView = view;
      setLocation({ kind: 'whiteboard', boardId: view.boardId });
    },
    discardRestoredView(boardId: string) {
      if (restoredView?.boardId !== boardId) {
        return false;
      }

      restoredView = undefined;
      setLocation({ kind: 'workbench' });

      return true;
    },
    subscribe(listener: Listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    applyHostLocation(boardId: string | undefined, id: string | number | undefined) {
      const differentCall = id !== undefined && openingId !== undefined && id !== openingId;
      if (id !== undefined) {
        openingId = id;
      }
      if (writtenLocally && !differentCall) {
        return false;
      }

      const next: McpStudioLocation = boardId
        ? { kind: 'whiteboard', boardId }
        : { kind: 'workbench' };
      writtenLocally = false;
      restoredView = undefined;
      setLocation(next);

      return true;
    },
  };
}
