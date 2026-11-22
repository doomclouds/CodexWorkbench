import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  Board,
  BoardElement,
  CollaborationRoom,
  StudioClient,
} from '../../../../../contracts/studio.js';
import { newClientId } from '../../../../shared/client-id.js';
import { encodeGestureFrame, type NativeGesture } from '../../../../shared/useNativeGestureSync.js';
import { makeElement, type Point } from '../scene/canvas-model.js';
import type { ContentTask, NativeContentQueue } from '../sync/content-queue.js';
import { measureMedia, readMediaSource } from './media-source.js';

interface MediaUploadBatch {
  id: string;
  scope: string;
  artifactId: string;
  baseRevision: number;
  intent: number;
  files: File[];
  position: Point;
  placeholders: BoardElement[];
  elements: BoardElement[];
  phase: 'uploading' | 'queued' | 'failed';
  referenceQueued: boolean;
  error?: string;
  frame: number;
  sequence: number;
  abort: AbortController;
}

export type MediaUploadView = Pick<
  MediaUploadBatch,
  'id' | 'files' | 'phase' | 'error' | 'placeholders' | 'elements'
>;

interface CanvasMediaOptions {
  client: StudioClient;
  author: string;
  scope: string;
  canEdit: boolean;
  room?: CollaborationRoom;
  queue: Pick<NativeContentQueue, 'tasks' | 'retry' | 'enqueue' | 'discardFor'>;
  getBoard: () => Board;
  getIntent: () => number;
  preparePlacement: () => Promise<boolean>;
  selectPlaced: (ids: string[]) => void;
  setError: (message: string) => void;
  notify: (message: string) => void;
  formatError: (failure: unknown) => string;
  reportFailure: (failure: unknown) => void;
}

function offsetPosition(position: Point, index: number): Point {
  return { x: position.x + index * 32, y: position.y + index * 32 };
}

function batchView(batch: MediaUploadBatch): MediaUploadView {
  const { id, files, phase, error, placeholders, elements } = batch;

  return { id, files, phase, error, placeholders, elements };
}

function isBatchAdd(task: ContentTask, batch: MediaUploadBatch) {
  return task.operations.some(
    (operation) =>
      operation.op === 'add' &&
      batch.elements.some((element) => element.id === (operation.id ?? operation.element?.id)),
  );
}

function hasBatchKey(task: ContentTask, elements: BoardElement[]) {
  return task.keys.some((id) => elements.some((element) => element.id === id));
}

function selectFromReceipt(batch: MediaUploadBatch, receipt: Board, getBoard: () => Board) {
  const loaded = getBoard();
  const canonical = loaded.artifact.revision > receipt.artifact.revision ? loaded : receipt;

  return batch.elements
    .map((element) => element.id)
    .filter((id) => canonical.elements.some((element) => element.id === id));
}

function uploadMessages(batch: MediaUploadBatch, end: boolean, cancelled: boolean) {
  const gesture: NativeGesture = {
    id: batch.id,
    operationId: batch.id,
    origin: 'create',
    baseRevision: batch.baseRevision,
    kind: 'upload',
    elements: batch.placeholders.map((placeholder, index) => batch.elements[index] ?? placeholder),
    ...(end && !cancelled ? { storedIds: batch.elements.map((element) => element.id) } : {}),
  };
  const messages = cancelled
    ? []
    : encodeGestureFrame(gesture, ++batch.frame, () => ++batch.sequence);

  if (end || cancelled) {
    messages.push({
      id: batch.id,
      operationId: batch.id,
      origin: 'create',
      baseRevision: batch.baseRevision,
      seq: ++batch.sequence,
      phase: 'end',
      frame: batch.frame,
      kind: 'upload',
      cancelled,
      storedIds: gesture.storedIds ?? [],
    });
  }

  return messages;
}

export function useCanvasMediaUpload({
  client,
  author,
  scope,
  canEdit,
  room,
  queue,
  getBoard,
  getIntent,
  preparePlacement,
  selectPlaced,
  setError,
  notify,
  formatError,
  reportFailure,
}: CanvasMediaOptions) {
  const inputRef = useRef<HTMLInputElement>(null);
  const batchRef = useRef<MediaUploadBatch | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const current = useRef({ scope, canEdit, room });
  const [view, setView] = useState<MediaUploadView | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  useLayoutEffect(() => {
    current.current = { scope, canEdit, room };
  }, [scope, canEdit, room]);

  const publish = useCallback(
    (batch: MediaUploadBatch, end = false, cancelled = false) => {
      const active = current.current;
      if (!active.canEdit || batch.scope !== active.scope || !active.room) {
        return;
      }

      for (const message of uploadMessages(batch, end, cancelled)) {
        void active.room
          .send('upload', message)
          .then((accepted) => {
            if (!accepted && batch.scope === current.current.scope) {
              notify('上传预览暂不可用，媒体保存后会同步。');
            }
          })
          .catch((failure) => {
            if (batch.scope === current.current.scope) {
              notify(`上传预览暂不可用，媒体保存后会同步。${formatError(failure)}`);
            }
          });
      }
    },
    [current, notify, formatError],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const batch = batchRef.current;
      if (batch) {
        batch.abort.abort();
        publish(batch, false, true);
      }
    };
  }, [publish]);

  const activeId = view?.phase !== 'failed' ? view?.id : undefined;
  useEffect(() => {
    if (!activeId || !canEdit || !room) {
      return;
    }

    const timer = setInterval(() => {
      const batch = batchRef.current;
      if (batch && batch.phase !== 'failed') {
        publish(batch);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [activeId, canEdit, room, publish]);

  function finish(batch: MediaUploadBatch, receipt?: Board) {
    if (batchRef.current !== batch) {
      return;
    }

    publish(batch, Boolean(receipt), !receipt);
    batchRef.current = null;
    busy.current = false;
    setView(null);
    setUploading(false);
    setUploadError('');

    const currentIntent = batch.scope === current.current.scope && batch.intent === getIntent();
    if (receipt && currentIntent) {
      const ids = selectFromReceipt(batch, receipt, getBoard);
      if (ids.length) {
        selectPlaced(ids);
      }
    }
  }

  function queueChanged() {
    const batch = batchRef.current;
    if (
      batch?.referenceQueued &&
      !queue.tasks.some((task) => hasBatchKey(task, batch.placeholders))
    ) {
      finish(batch);
    }
  }

  function queueAccepted(task: ContentTask, board: Board) {
    const batch = batchRef.current;
    if (!batch?.referenceQueued || !isBatchAdd(task, batch)) {
      return;
    }

    if (
      batch.elements.every((element) => board.elements.some((saved) => saved.id === element.id))
    ) {
      finish(batch, board);
    }
  }

  function attach(batch: MediaUploadBatch) {
    batch.phase = 'queued';
    batch.referenceQueued = true;
    setView(batchView(batch));
    const failed = queue.tasks.find((task) => task.state === 'failed' && isBatchAdd(task, batch));
    const pending = failed
      ? queue.retry(failed.id)
      : queue.enqueue(
          getBoard(),
          batch.elements.map((element) => ({ op: 'add', id: element.id, element })),
          '添加媒体',
          undefined,
          true,
          undefined,
          batch.id,
        );
    setUploading(false);

    return pending;
  }

  async function uploadAndAttach(batch: MediaUploadBatch, live: () => boolean) {
    for (let index = batch.elements.length; index < batch.files.length; index++) {
      const file = batch.files[index]!;
      if (!live()) {
        return;
      }
      if (!current.current.canEdit) {
        throw new Error('当前为只读，媒体草稿已保留。恢复编辑权限后可重试。');
      }

      const src = await readMediaSource(file, client, batch.artifactId, author, batch.abort.signal);
      if (!live()) {
        return;
      }

      const dimensions = await measureMedia(file, src, client, (failure) => {
        if (live()) {
          notify(`无法读取图片尺寸，已采用默认大小。${formatError(failure)}`);
        }
      });

      if (!live()) {
        return;
      }

      batch.elements.push(
        makeElement('image', offsetPosition(batch.position, index), {
          id: batch.placeholders[index]!.id,
          text: file.name,
          ...dimensions,
        }),
      );
      setView(batchView(batch));
      publish(batch);
    }
    if (!live()) {
      return;
    }
    if (!current.current.canEdit) {
      throw new Error('当前为只读，已上传的媒体仍未加入白板。恢复编辑权限后可重试。');
    }

    return attach(batch);
  }

  async function run(batch: MediaUploadBatch) {
    const active = current.current;
    if (busy.current || !active.canEdit || batch.scope !== active.scope) {
      return;
    }

    busy.current = true;
    setUploadError('');
    setError('');
    const live = () =>
      mounted.current && batchRef.current === batch && batch.scope === current.current.scope;
    batch.phase = batch.elements.length < batch.files.length ? 'uploading' : 'queued';
    batch.error = undefined;
    setUploading(batch.phase === 'uploading');
    setView(batchView(batch));
    publish(batch);
    try {
      const receipt = await uploadAndAttach(batch, live);
      if (!live()) {
        return;
      }

      if (!receipt) {
        const failed = queue.tasks.find(
          (task) => task.state === 'failed' && hasBatchKey(task, batch.elements),
        );

        throw failed?.failure ?? new Error('媒体尚未加入白板，草稿已保留。');
      }

      finish(batch, receipt.board);
    } catch (failure) {
      if (!live()) {
        return;
      }

      batch.phase = 'failed';
      batch.error = formatError(failure);
      setView(batchView(batch));
      setUploadError(batch.error);
      publish(batch, false, true);
    } finally {
      if (live()) {
        busy.current = false;
        setUploading(false);
      }
    }
  }

  async function upload(files: FileList | File[] | null, position: Point) {
    if (!files?.length || !current.current.canEdit) {
      return;
    }

    const selected = [...files].slice(0, 12);
    if (batchRef.current) {
      setError('当前媒体尚未加入白板，请先完成重试或移除这份上传草稿。');
      return;
    }
    if (!(await preparePlacement())) {
      return;
    }

    const board = getBoard();
    const batch: MediaUploadBatch = {
      id: newClientId('upload'),
      scope,
      artifactId: board.artifact.id,
      baseRevision: board.artifact.revision,
      intent: getIntent(),
      files: selected,
      position: { ...position },
      placeholders: selected.map((file, index) =>
        makeElement('image', offsetPosition(position, index), { w: 360, h: 240, text: file.name }),
      ),
      elements: [],
      phase: 'uploading',
      referenceQueued: false,
      frame: 0,
      sequence: 0,
      abort: new AbortController(),
    };
    batchRef.current = batch;
    await run(batch);
  }

  function pickFiles() {
    inputRef.current?.click();
  }

  function retry() {
    const batch = batchRef.current;
    if (batch) {
      run(batch).catch(reportFailure);
    }
  }

  function discard() {
    const batch = batchRef.current;
    if (!batch) {
      return;
    }

    batch.abort.abort();
    queue.discardFor(batch.placeholders.map((placeholder) => placeholder.id));
    finish(batch);
    setError('');
  }

  return {
    view,
    uploading,
    uploadError,
    inputRef,
    upload,
    pickFiles,
    retry,
    discard,
    queueChanged,
    queueAccepted,
  };
}
