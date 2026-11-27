const storagePrefix = 'luming-studio-ii:board-draft:v1:';

function draftPrefix(scope: string): string {
  return storagePrefix + encodeURIComponent(scope) + ':';
}

export function createBoardDraftStorage(createId: () => string) {
  return {
    createId,
    list(scope: string): readonly { id: string; data: string }[] {
      const storage = window.localStorage;
      const prefix = draftPrefix(scope);
      const matches: { id: string; data: string }[] = [];
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key?.startsWith(prefix)) {
          const data = storage.getItem(key);
          if (data !== null) {
            matches.push({ id: key.slice(prefix.length), data });
          }
        }
      }

      return matches;
    },
    write(scope: string, id: string, data: string) {
      window.localStorage.setItem(draftPrefix(scope) + id, data);
    },
    remove(scope: string, id: string) {
      window.localStorage.removeItem(draftPrefix(scope) + id);
    },
  };
}
