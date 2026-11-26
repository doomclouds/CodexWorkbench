import { useEffect, useRef, useState, type RefObject } from 'react';

import type {
  AttachBoardImageCommand,
  BoardEditReceipt,
  WhiteboardPoint,
} from '../../data/whiteboard/index.js';
import {
  matchesImageReceipt,
  mediaError,
  rejectedImageMessage,
  worldGeometry,
  type BoardMediaState,
} from './board-media-state.js';
import type { PreparedBoardImage, WhiteboardMediaSurfaceProps } from './contracts.js';

interface MediaActivity {
  readonly controller: AbortController;
  image?: PreparedBoardImage;
  saving?: AbortController;
}

function disposeActivity(activity: RefObject<MediaActivity | undefined>) {
  const current = activity.current;
  activity.current = undefined;
  current?.controller.abort();
  current?.saving?.abort();
  current?.image?.dispose();
}

type Pending = { readonly image: PreparedBoardImage; readonly command: AttachBoardImageCommand };

interface SavingResult {
  readonly receipt?: BoardEditReceipt;
  readonly notice?: string;
}

type SaveAction = 'attach' | 'check' | 'retry';

async function readImageReceipt(
  service: WhiteboardMediaSurfaceProps['service'],
  command: AttachBoardImageCommand,
  signal: AbortSignal,
  action: SaveAction,
): Promise<SavingResult> {
  try {
    if (action !== 'attach') {
      const receipt = await service.getReceipt(command.boardId, command.commandId, signal);

      if (receipt) {
        return { receipt };
      }
      if (action === 'check') {
        return { notice: '尚未查到保存记录，可以用原请求重试。' };
      }
    }

    return { receipt: await service.attachImage(command, signal) };
  } catch (error) {
    return { notice: mediaError(error, '暂时无法确认图片是否保存。') };
  }
}

export function useBoardMedia({
  boardId,
  viewport,
  createCommandId,
  service,
  prepareImage,
  onApplied,
  onExitPlacement,
}: Omit<WhiteboardMediaSurfaceProps, 'renderTools' | 'canEdit' | 'paused'>) {
  const [state, setState] = useState<BoardMediaState>({ kind: 'idle' });
  const activity = useRef<MediaActivity | undefined>(undefined);

  useEffect(() => () => disposeActivity(activity), []);

  function dismiss() {
    const wasPlacing = state.kind === 'placing';
    disposeActivity(activity);
    setState({ kind: 'idle' });

    if (wasPlacing) {
      onExitPlacement?.();
    }
  }

  async function choose(file: File) {
    disposeActivity(activity);
    const current: MediaActivity = { controller: new AbortController() };
    activity.current = current;
    setState({ kind: 'reading' });

    try {
      const image = await prepareImage(file, current.controller.signal);
      if (activity.current !== current) {
        image.dispose();
        return;
      }

      current.image = image;
      setState({ kind: 'placing', image });
    } catch (error) {
      if (activity.current !== current) {
        return;
      }

      disposeActivity(activity);
      setState({ kind: 'readFailed', message: mediaError(error, '无法读取这张图片。') });
    }
  }

  function resolveSaving(pending: Pending, result: SavingResult) {
    const { receipt } = result;
    if (!receipt || !matchesImageReceipt(pending.command, receipt)) {
      setState({
        ...pending,
        kind: 'uncertain',
        message: result.notice ?? '图片保存结果还未确认。',
      });

      return;
    }

    if (receipt.kind !== 'applied') {
      setState({ ...pending, kind: 'rejected', message: rejectedImageMessage(receipt) });
      return;
    }

    disposeActivity(activity);
    setState({ kind: 'idle' });
    onApplied(receipt);
  }

  async function save(pending: Pending, action: SaveAction) {
    const current = activity.current;
    if (!current || current.image !== pending.image || current.saving) {
      return;
    }

    const attempt = new AbortController();
    current.saving = attempt;
    setState({ ...pending, kind: 'saving' });
    const result = await readImageReceipt(service, pending.command, attempt.signal, action);

    if (activity.current !== current || current.saving !== attempt) {
      return;
    }

    current.saving = undefined;
    resolveSaving(pending, result);
  }

  async function insert(point: WhiteboardPoint) {
    if (state.kind !== 'placing' || activity.current?.saving) {
      return;
    }

    const { image } = state;
    const command = {
      boardId,
      commandId: createCommandId(),
      objectId: createCommandId(),
      displayName: image.displayName,
      geometry: worldGeometry(image, point, viewport),
      content: image.content,
    };

    onExitPlacement?.();
    await save({ image, command }, 'attach');
  }

  async function recoverSave(action: 'check' | 'retry') {
    if (state.kind === 'uncertain') {
      await save(state, action);
    }
  }

  function stopWaiting() {
    const current = activity.current;
    if (state.kind !== 'saving' || !current?.saving) {
      return;
    }

    current.saving.abort();
    current.saving = undefined;
    setState({ ...state, kind: 'uncertain', message: '已停止等待。可以核对原请求的保存结果。' });
  }

  function reposition() {
    if (state.kind === 'rejected') {
      setState({ kind: 'placing', image: state.image });
    }
  }

  function reportActionFailure(error: unknown) {
    disposeActivity(activity);
    setState({ kind: 'readFailed', message: mediaError(error, '无法完成图片操作。') });
  }

  return {
    state,
    dismiss,
    reposition,
    stopWaiting,
    choose: (file: File) => {
      choose(file).catch(reportActionFailure);
    },
    insert: (point: WhiteboardPoint) => {
      insert(point).catch(reportActionFailure);
    },
    recoverSave: (action: 'check' | 'retry') => {
      recoverSave(action).catch(reportActionFailure);
    },
  };
}
