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
  const listeners = new Set<Listener>();

  return {
    read: () => location,
    write(next: McpStudioLocation) {
      openingId ??= readOpeningId();
      writtenLocally = true;
      location = next;
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
      if (!sameLocation(location, next)) {
        location = next;
        for (const listener of listeners) {
          listener();
        }
      }

      return true;
    },
  };
}
