import { useEffect, useRef, useState } from 'react';
import type {
  BoardEditReceipt,
  EditObjectContentCommand,
  WhiteboardEditService,
} from '../../data/whiteboard/index.js';
import type {
  CanvasObjectIntent,
  CanvasObjectKind,
  CanvasObjectReceipt,
} from '../../ui/domain/canvas/index.js';
import { projectEditablePayload } from './canvas-projection.js';
import { isWritableContentKind, readContentEdit } from './content-edit-command.js';

type ContentEditPort = Pick<WhiteboardEditService, 'editContent' | 'getReceipt'>;
type AppliedReceipt = Extract<BoardEditReceipt, { kind: 'applied' }>;
type ConflictReceipt = Extract<BoardEditReceipt, { kind: 'conflict' }>;

interface ContentEditOptions {
  readonly boardId: string;
  readonly service?: ContentEditPort;
  readonly canEdit?: boolean;
  readonly createCommandId: () => string;
  readonly onApplied: (receipt: AppliedReceipt) => void;
  readonly onConflict?: (receipt: ConflictReceipt) => void;
}

interface PendingContentEdit {
  readonly service: ContentEditPort;
  readonly command: EditObjectContentCommand;
  readonly signature: string;
  controller?: AbortController;
}

interface UnknownContentReceipt {
  readonly pending: PendingContentEdit;
  readonly message: string;
}

type ContentAttempt =
  | { readonly kind: 'receipt'; readonly receipt: BoardEditReceipt }
  | { readonly kind: 'unknown'; readonly message: string };

const unknownReceipt = '正文保存结果未知。';
const editUnavailable = '当前对象不可编辑。';
const rejectionMessages = new Map<string, string>([
  ['forbidden', '当前没有编辑权限。'],
  ['invalidEdit', '正文内容无效。'],
  ['objectNotFound', '该对象已不在当前白板。'],
  ['geometryLocked', '该对象已锁定。'],
  ['commandIdReuse', '保存命令已被另一项更改使用。'],
  ['unsupportedKind', '该对象暂不支持正文编辑。'],
  ['tooLarge', '正文超过单次保存的容量。'],
]);

function rejection(message: string): CanvasObjectReceipt {
  return { ok: false, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '请求失败。';
}

function validateReceipt(receipt: BoardEditReceipt, command: EditObjectContentCommand) {
  if (receipt.boardId !== command.boardId || receipt.commandId !== command.commandId) {
    throw new Error('保存回执与本次操作不符。');
  }

  return receipt;
}

async function readReceipt(pending: PendingContentEdit, signal: AbortSignal) {
  const { service, command } = pending;
  const receipt = await service.getReceipt(command.boardId, command.commandId, signal);

  return receipt && validateReceipt(receipt, command);
}

async function submitContent(
  pending: PendingContentEdit,
  retry: boolean,
  signal: AbortSignal,
): Promise<ContentAttempt> {
  const { service, command } = pending;
  if (retry) {
    try {
      const receipt = await readReceipt(pending, signal);
      if (receipt) {
        return { kind: 'receipt', receipt };
      }
    } catch (error) {
      return { kind: 'unknown', message: '查询正文回执失败。' + errorMessage(error) };
    }
  }
  if (signal.aborted) {
    return { kind: 'unknown', message: '正文保存已中止。' };
  }

  try {
    const receipt = await service.editContent(command, signal);

    return { kind: 'receipt', receipt: validateReceipt(receipt, command) };
  } catch (error) {
    const message = unknownReceipt + errorMessage(error);
    if (signal.aborted) {
      return { kind: 'unknown', message };
    }

    try {
      const receipt = await readReceipt(pending, signal);

      return receipt ? { kind: 'receipt', receipt } : { kind: 'unknown', message };
    } catch (lookupError) {
      return {
        kind: 'unknown',
        message: message + '查询正文回执失败。' + errorMessage(lookupError),
      };
    }
  }
}

function payloadForReceipt(
  receipt: Exclude<BoardEditReceipt, { kind: 'rejected' }>,
  command: EditObjectContentCommand,
) {
  const editKind = command.edit.kind;
  const payloadKind = contentPayloadKind(editKind);
  for (const result of receipt.payloads) {
    if (result.kind !== 'loaded') {
      continue;
    }

    const { payload } = result;
    if (payload.id === command.objectId && payload.body.kind === payloadKind) {
      if (receipt.kind === 'applied' && payload.version <= command.expectedPayloadVersion) {
        return undefined;
      }

      const object =
        payloadKind === 'table' ? receipt.objects.find(({ id }) => id === payload.id) : undefined;

      return projectEditablePayload(payload, object);
    }
  }
}

function contentPayloadKind(kind: EditObjectContentCommand['edit']['kind']) {
  if (kind === 'embedSource' || kind === 'embedState') {
    return 'embed';
  }

  return kind === 'crop' ? 'image' : kind;
}

function contentReceipt(
  receipt: BoardEditReceipt,
  command: EditObjectContentCommand,
): CanvasObjectReceipt {
  if (receipt.kind === 'rejected') {
    return rejection(rejectionMessages.get(receipt.reason) ?? '服务端拒绝了这次正文保存。');
  }

  const payload = payloadForReceipt(receipt, command);
  if (receipt.kind === 'conflict') {
    return { ok: false, message: '正文已被其他操作修改。', current: payload, conflict: true };
  }
  if (receipt.detailsExpired && !payload) {
    return { ok: false, message: '原保存已确认，需重新读取最新正文。', conflict: true };
  }

  return payload ? { ok: true, payload } : rejection('保存回执缺少有效正文。');
}

export function useContentEdits({
  boardId,
  service,
  canEdit = true,
  createCommandId,
  onApplied,
  onConflict,
}: ContentEditOptions) {
  const pending = useRef(new Map<string, PendingContentEdit>());
  const [unknownReceipts, setUnknownReceipts] = useState<readonly UnknownContentReceipt[]>([]);

  useEffect(() => {
    const requests = pending.current;

    return () => {
      for (const request of requests.values()) {
        request.controller?.abort();
      }

      requests.clear();
    };
  }, [boardId, service]);

  function clearNotice(request: PendingContentEdit) {
    setUnknownReceipts((receipts) => receipts.filter((entry) => entry.pending !== request));
  }

  function publishUnknown(request: PendingContentEdit, message: string) {
    setUnknownReceipts((receipts) => [
      ...receipts.filter((entry) => entry.pending !== request),
      { pending: request, message },
    ]);

    return rejection(message);
  }

  function complete(request: PendingContentEdit, attempt: ContentAttempt): CanvasObjectReceipt {
    const { objectId } = request.command;
    if (pending.current.get(objectId) !== request) {
      return rejection('该对象的保存已经离开当前视图。');
    }
    if (attempt.kind === 'unknown') {
      return publishUnknown(request, attempt.message);
    }

    const { receipt } = attempt;
    if (receipt.kind === 'applied') {
      onApplied(receipt);
    } else if (receipt.kind === 'conflict') {
      onConflict?.(receipt);
    }

    pending.current.delete(objectId);
    clearNotice(request);

    return contentReceipt(receipt, request.command);
  }

  async function run(request: PendingContentEdit, retry: boolean): Promise<CanvasObjectReceipt> {
    if (!canEdit || pending.current.get(request.command.objectId) !== request) {
      return rejection(editUnavailable);
    }
    if (request.controller) {
      return rejection('正在保存该对象的正文。');
    }

    const controller = new AbortController();
    request.controller = controller;

    try {
      const attempt = await submitContent(request, retry, controller.signal);

      return complete(request, attempt);
    } catch (error) {
      return complete(request, { kind: 'unknown', message: errorMessage(error) });
    } finally {
      request.controller = undefined;
    }
  }

  function canWriteObject(kind: CanvasObjectKind) {
    return Boolean(canEdit && service && isWritableContentKind(kind));
  }

  async function handleObjectIntent(intent: CanvasObjectIntent): Promise<CanvasObjectReceipt> {
    if (!service || !canWriteObject(intent.kind)) {
      return rejection(editUnavailable);
    }

    const { objectId, expectedVersion } = intent;
    const edit = readContentEdit(intent);
    const validVersion = Number.isSafeInteger(expectedVersion) && expectedVersion >= 0;
    if (!objectId || !edit || !validVersion) {
      return rejection('正文更改或版本无效。');
    }

    const signature = JSON.stringify([expectedVersion, edit], (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    const current = pending.current.get(objectId);
    if (current) {
      return current.signature === signature
        ? run(current, true)
        : rejection('此对象还有一条待确认的保存。请先重试原保存。');
    }

    let commandId: string;
    try {
      commandId = createCommandId();
    } catch (error) {
      return rejection(errorMessage(error));
    }

    const command = {
      boardId,
      commandId,
      objectId,
      expectedPayloadVersion: BigInt(expectedVersion),
      edit,
    };
    const request: PendingContentEdit = { service, command, signature };
    pending.current.set(objectId, request);

    return run(request, false);
  }

  const waiting = unknownReceipts.find(
    ({ pending: request }) => request.service === service && request.command.boardId === boardId,
  );

  function retry() {
    if (waiting) {
      run(waiting.pending, true).catch((error: unknown) =>
        publishUnknown(waiting.pending, errorMessage(error)),
      );
    }
  }

  const notice =
    waiting && canEdit ? { kind: 'unknown' as const, message: waiting.message, retry } : undefined;

  return { canWriteObject, handleObjectIntent, notice };
}
