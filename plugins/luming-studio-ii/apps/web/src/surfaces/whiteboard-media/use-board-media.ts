import { useEffect, useRef, useState, type RefObject } from 'react';

import type { BoardEditReceipt, WhiteboardPoint } from '../../data/whiteboard/index.js';
import type { CanvasViewport } from '../../ui/domain/canvas/index.js';
import {
  matchesMediaReceipt,
  mediaError,
  rejectedMediaMessage,
  worldGeometry,
  type AttachMediaCommand,
  type BoardMediaState,
  type PendingMedia,
} from './board-media-state.js';
import type {
  PreparedBoardMedia,
  UploadBoardMedia,
  WhiteboardMediaSurfaceProps,
} from './contracts.js';

interface MediaActivity {
  readonly controller: AbortController;
  image?: PreparedBoardMedia;
  saving?: AbortController;
}

interface MediaFile {
  readonly file: File;
  readonly point?: WhiteboardPoint;
  readonly viewport: CanvasViewport;
}

const maximumBatchFiles = 12;
const placementOffset = 24;

function disposeActivity(activity: RefObject<MediaActivity | undefined>) {
  const current = activity.current;
  activity.current = undefined;
  current?.controller.abort();
  current?.saving?.abort();
  current?.image?.dispose();
}

interface SavingResult {
  readonly receipt?: BoardEditReceipt;
  readonly notice?: string;
}

type SaveAction = 'attach' | 'check' | 'retry';

async function readMediaReceipt(
  service: WhiteboardMediaSurfaceProps['service'],
  command: AttachMediaCommand,
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

    if ('mediaType' in command) {
      return { receipt: await service.attachVideo?.(command, signal) };
    }

    return { receipt: await service.attachImage(command, signal) };
  } catch (error) {
    const label = 'mediaType' in command ? '视频' : '图片';

    return { notice: mediaError(error, '暂时无法确认' + label + '是否保存。') };
  }
}

function wantsVideo(file: File) {
  return file.type.startsWith('video/') || /\.(?:mp4|webm|mov)$/iu.test(file.name);
}

export function useBoardMedia({
  boardId,
  viewport,
  createCommandId,
  service,
  prepareImage,
  prepareVideo,
  placementPoint,
  onApplied,
  onExitPlacement,
}: Omit<WhiteboardMediaSurfaceProps, 'renderTools' | 'canEdit' | 'paused' | 'onUploadReady'>) {
  const [state, setState] = useState<BoardMediaState>({ kind: 'idle' });
  const activity = useRef<MediaActivity | undefined>(undefined);
  const queued = useRef<MediaFile[]>([]);

  useEffect(() => () => disposeActivity(activity), []);

  function dismiss() {
    const wasPlacing = state.kind === 'placing';
    disposeActivity(activity);
    queued.current = [];
    setState({ kind: 'idle' });

    if (wasPlacing) {
      onExitPlacement?.();
    }
  }

  async function choose(entry: MediaFile) {
    const { file, point } = entry;
    disposeActivity(activity);
    const current: MediaActivity = { controller: new AbortController() };
    activity.current = current;
    setState({ kind: 'reading' });

    const video = wantsVideo(file);
    try {
      const prepare = video ? prepareVideo : prepareImage;
      if (!prepare || (video && !service.attachVideo)) {
        throw new Error('当前白板无法上传视频。');
      }

      const image = await prepare(file, current.controller.signal);
      if (activity.current !== current) {
        image.dispose();
        return;
      }

      current.image = image;
      if (point) {
        await attach(image, point, entry.viewport);
      } else {
        setState({ kind: 'placing', image });
      }
    } catch (error) {
      if (activity.current !== current) {
        return;
      }

      disposeActivity(activity);
      const fallback = video ? '无法读取该视频。' : '无法读取这张图片。';
      setState({ kind: 'readFailed', message: mediaError(error, fallback) });
    }
  }

  function startQueued() {
    const next = queued.current.shift();
    if (next) {
      choose(next).catch(reportActionFailure);
    }
  }

  function upload(files: Parameters<UploadBoardMedia>[0], point = placementPoint?.()) {
    if (activity.current || !files.length) {
      return;
    }

    queued.current = files.slice(0, maximumBatchFiles).map((file, index) => {
      const offset = index * placementOffset * viewport.zoom;

      return { file, viewport, point: point && { x: point.x + offset, y: point.y + offset } };
    });
    startQueued();
  }

  function resolveSaving(pending: PendingMedia, result: SavingResult) {
    const { receipt } = result;
    const label = 'mediaType' in pending.command ? '视频' : '图片';
    if (!receipt || !matchesMediaReceipt(pending.command, receipt)) {
      setState({
        ...pending,
        kind: 'uncertain',
        message: result.notice ?? label + '保存结果还未确认。',
      });

      return;
    }

    if (receipt.kind !== 'applied') {
      setState({ ...pending, kind: 'rejected', message: rejectedMediaMessage(receipt, label) });
      return;
    }

    disposeActivity(activity);
    setState({ kind: 'idle' });
    onApplied(receipt);
    startQueued();
  }

  async function save(pending: PendingMedia, action: SaveAction) {
    const current = activity.current;
    if (!current || current.image !== pending.image || current.saving) {
      return;
    }

    const attempt = new AbortController();
    current.saving = attempt;
    setState({ ...pending, kind: 'saving' });
    const result = await readMediaReceipt(service, pending.command, attempt.signal, action);

    if (activity.current !== current || current.saving !== attempt) {
      return;
    }

    current.saving = undefined;
    resolveSaving(pending, result);
  }

  async function attach(
    image: PreparedBoardMedia,
    point: WhiteboardPoint,
    placementViewport = viewport,
  ) {
    const base = {
      boardId,
      commandId: createCommandId(),
      objectId: createCommandId(),
      displayName: image.displayName,
      geometry: worldGeometry(image, point, placementViewport),
      content: image.content,
    };
    const command = 'mediaType' in image ? { ...base, mediaType: image.mediaType } : base;

    onExitPlacement?.();
    await save({ image, command }, 'attach');
  }

  async function insert(point: WhiteboardPoint) {
    if (state.kind === 'placing' && !activity.current?.saving) {
      await attach(state.image, point);
    }
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
    queued.current = [];
    setState({ kind: 'readFailed', message: mediaError(error, '无法完成媒体操作。') });
  }

  return {
    state,
    dismiss,
    reposition,
    stopWaiting,
    upload,
    insert: (point: WhiteboardPoint) => {
      insert(point).catch(reportActionFailure);
    },
    recoverSave: (action: 'check' | 'retry') => {
      recoverSave(action).catch(reportActionFailure);
    },
  };
}
