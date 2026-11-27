import { useEffect, useRef, useState } from 'react';

export type CopyBoardLink = (
  boardId: string,
  signal: AbortSignal,
) => Promise<'copied' | 'sharingRequired'>;

export interface BoardLinkNotice {
  readonly message: string;
  readonly error: boolean;
}

export function useCopyBoardLink(
  copyLink?: CopyBoardLink,
  onOpenSharing?: (boardId: string) => void,
) {
  const [notice, setNotice] = useState<BoardLinkNotice>();
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController>(undefined);

  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = undefined;
    },
    [],
  );

  function copy(boardId: string) {
    if (!copyLink || pending.current) {
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    pending.current = controller;
    setBusy(true);
    setNotice(undefined);

    copyLink(boardId, signal)
      .then((result) => {
        if (signal.aborted) {
          return;
        }

        if (result === 'copied') {
          setNotice({ message: '链接已复制。', error: false });
        } else if (onOpenSharing) {
          onOpenSharing(boardId);
        } else {
          setNotice({ message: '仅查看链接未启用。请打开白板的分享面板。', error: true });
        }
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          const detail = error instanceof Error ? error.message : '';
          setNotice({ message: '复制链接失败。' + detail, error: true });
        }
      })
      .finally(() => {
        if (pending.current === controller) {
          pending.current = undefined;
          setBusy(false);
        }
      });
  }

  return { notice, copy: copyLink && !busy ? copy : undefined };
}
