import { useState } from 'react';

export type RenameBoard = (boardId: string, currentTitle: string, title: string) => Promise<void>;

interface BoardTitleOptions {
  readonly boardId: string;
  readonly title: string;
  readonly renameBoard?: RenameBoard;
  readonly onSaved: () => void;
}

export function useBoardTitle({ boardId, title, renameBoard, onSaved }: BoardTitleOptions) {
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  function handleRename(nextTitle: string) {
    if (!renameBoard || saving) {
      return;
    }

    setSaving(true);
    setError(undefined);
    Promise.resolve()
      .then(() => renameBoard(boardId, title, nextTitle))
      .then(onSaved)
      .finally(() => setSaving(false))
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : '重命名失败。'),
      );
  }

  return { error, rename: renameBoard && !saving ? handleRename : undefined };
}
