import { useState } from 'react';

export type RenameBoard = (boardId: string, currentTitle: string, title: string) => Promise<void>;

interface BoardTitleOptions {
  readonly boardId: string;
  readonly title: string;
  readonly renameBoard?: RenameBoard;
  readonly onSaved: () => void;
}

interface TitleDraft {
  readonly sourceTitle: string;
  readonly value: string;
  readonly error?: string;
}

export interface BoardTitleEditor {
  readonly draft: string;
  readonly saving: boolean;
  readonly change: (value: string) => void;
  readonly submit: (retry?: boolean) => void;
  readonly discard: () => void;
}

export function useBoardTitle({ boardId, title, renameBoard, onSaved }: BoardTitleOptions) {
  const [draft, setDraft] = useState<TitleDraft>();
  const [saving, setSaving] = useState(false);

  function submit(retry = false) {
    if (!renameBoard || saving) {
      return;
    }
    if (!draft || (draft.error && !retry)) {
      return;
    }

    const nextTitle = draft.value.trim();
    if (!nextTitle || nextTitle === title) {
      setDraft(undefined);
      return;
    }

    setSaving(true);
    setDraft({ sourceTitle: draft.sourceTitle, value: draft.value });
    Promise.resolve()
      .then(() => renameBoard(boardId, draft.sourceTitle, nextTitle))
      .then(() => {
        setDraft(undefined);
        onSaved();
      })
      .catch((failure: unknown) => {
        const error =
          failure instanceof Error && failure.message ? failure.message : '重命名失败。';
        setDraft({ ...draft, error });
      })
      .finally(() => setSaving(false));
  }

  const editor: BoardTitleEditor | undefined = renameBoard && {
    draft: draft?.value ?? title,
    saving,
    change: (value) => setDraft({ sourceTitle: title, value }),
    submit,
    discard: () => setDraft(undefined),
  };
  const failure = draft?.error && {
    message: draft.error,
    retry: renameBoard ? () => submit(true) : undefined,
  };

  return { editor, failure };
}
