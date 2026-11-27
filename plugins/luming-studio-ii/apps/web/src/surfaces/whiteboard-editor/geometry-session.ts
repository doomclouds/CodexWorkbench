import { useEffect, useRef, useState } from 'react';
import type {
  BoardEditReceipt,
  BoardEditRejection,
  EditBoardGeometryCommand,
  EditBoardGeometryOperation,
  WhiteboardEditService,
} from '../../data/whiteboard/index.js';
import {
  expandCanvasSelection,
  type CanvasEditIntent,
  type CanvasObject,
} from '../../ui/domain/canvas/index.js';
import {
  geometryOperation,
  pasteOperation,
  selectionForOperation,
  selectionOperation,
  type BoardClipboardSelection,
  type GeometrySelectionAction,
} from './geometry-commands.js';

type GeometryService = Pick<WhiteboardEditService, 'editGeometry' | 'getReceipt'>;
type AppliedEdit = Extract<BoardEditReceipt, { kind: 'applied' }>;
type ConflictEdit = Extract<BoardEditReceipt, { kind: 'conflict' }>;

interface GeometryOptions {
  readonly boardId: string;
  readonly revision: bigint;
  readonly canEdit: boolean;
  readonly createCommandId: () => string;
  readonly service: GeometryService | undefined;
  readonly objectsById: ReadonlyMap<string, CanvasObject>;
  readonly payloadVersion: (objectId: string) => bigint | undefined;
  readonly onApplied: (receipt: AppliedEdit, selection?: readonly string[]) => void;
  readonly onConflict: (receipt: ConflictEdit) => void;
}

interface PendingEdit {
  readonly command: EditBoardGeometryCommand;
  readonly controller: AbortController;
  readonly edits: readonly CanvasEditIntent[];
}

type GeometryState =
  | { readonly kind: 'idle' | 'saved' }
  | { readonly kind: 'saving' | 'checking'; readonly edit: PendingEdit }
  | { readonly kind: 'unknown'; readonly edit: PendingEdit; readonly detail: string }
  | { readonly kind: 'rejected' | 'conflict'; readonly detail: string };

type GeometryAttempt = { readonly receipt: BoardEditReceipt } | { readonly detail: string };

const noReceipt = '服务端暂无这次编辑的回执。';
const emptyEdits: readonly CanvasEditIntent[] = [];
const rejectionDetails: Readonly<Record<BoardEditRejection, string>> = {
  forbidden: '当前没有编辑权限。',
  invalidEdit: '服务端拒绝了这次编辑。',
  objectNotFound: '目标对象已不存在。',
  geometryLocked: '选区或关联对象已锁定。',
  commandIdReuse: '原命令 ID 已被不同的请求使用。',
  unsupportedKind: '当前对象不支持此编辑。',
  versionUnavailable: '请求的版本已不可用。',
  tooLarge: '这次编辑超出白板允许的范围。',
  invalidImage: '图片内容无法使用。',
  invalidVideo: '视频内容无法使用。',
  unknown: '服务端拒绝了这次编辑。',
};

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败。';
}

async function readReceipt(
  service: GeometryService,
  { command, controller }: PendingEdit,
  submissionError?: string,
): Promise<GeometryAttempt> {
  const prefix = submissionError ? submissionError + ' ' : '';
  try {
    const receipt = await service.getReceipt(command.boardId, command.commandId, controller.signal);

    return receipt ? { receipt } : { detail: prefix + noReceipt };
  } catch (error) {
    return { detail: prefix + '查询回执失败。' + errorDetail(error) };
  }
}

async function submit(service: GeometryService, edit: PendingEdit): Promise<GeometryAttempt> {
  try {
    return { receipt: await service.editGeometry(edit.command, edit.controller.signal) };
  } catch (error) {
    const detail = errorDetail(error);

    return edit.controller.signal.aborted ? { detail } : readReceipt(service, edit, detail);
  }
}

export function useGeometryEdits({
  boardId,
  revision,
  canEdit,
  createCommandId,
  service,
  objectsById,
  payloadVersion,
  onApplied,
  onConflict,
}: GeometryOptions) {
  const [state, setState] = useState<GeometryState>({ kind: 'idle' });
  const pending = useRef<PendingEdit | undefined>(undefined);
  const running = useRef(false);

  useEffect(
    () => () => {
      pending.current?.controller.abort();
      pending.current = undefined;
      running.current = false;
    },
    [],
  );

  function complete(edit: PendingEdit, attempt: GeometryAttempt) {
    if (pending.current !== edit) {
      return;
    }

    running.current = false;
    if ('detail' in attempt) {
      setState({ kind: 'unknown', edit, detail: attempt.detail });
      return;
    }

    pending.current = undefined;
    const { receipt } = attempt;
    switch (receipt.kind) {
      case 'applied':
        setState({ kind: 'saved' });
        onApplied(receipt, selectionForOperation(edit.command.operation));
        break;
      case 'conflict':
        setState({ kind: 'conflict', detail: '白板已被其他操作更新，请重新选择对象。' });
        onConflict(receipt);
        break;
      case 'rejected':
        setState({ kind: 'rejected', detail: rejectionDetails[receipt.reason] });
        break;
    }
  }

  function run(edit: PendingEdit, kind: 'saving' | 'checking') {
    if (!service || running.current || pending.current !== edit) {
      return;
    }

    running.current = true;
    setState({ kind, edit });
    const attempt = kind === 'saving' ? submit(service, edit) : readReceipt(service, edit);
    return attempt
      .then((result) => {
        complete(edit, result);
        return result;
      })
      .catch((error: unknown) => {
        if (pending.current === edit) {
          complete(edit, { detail: errorDetail(error) });
          return;
        }

        setState({ kind: 'rejected', detail: '同步白板失败。' + errorDetail(error) });
      });
  }

  function start(
    makeOperation: (commandId: string) => EditBoardGeometryOperation | undefined,
    edits: readonly CanvasEditIntent[],
  ) {
    if (!canEdit || !service || pending.current) {
      return;
    }

    try {
      const commandId = createCommandId();
      const operation = makeOperation(commandId);
      if (!operation) {
        setState({ kind: 'rejected', detail: '当前选区无法执行此编辑。' });
        return;
      }

      const edit = {
        command: { boardId, commandId, operation },
        controller: new AbortController(),
        edits,
      };
      pending.current = edit;
      return run(edit, 'saving');
    } catch (error) {
      setState({ kind: 'rejected', detail: errorDetail(error) });
    }
  }

  function submitEdit(intent: CanvasEditIntent) {
    if (intent.kind !== 'move') {
      return start((commandId) => geometryOperation(intent, commandId), [intent]);
    }
  }

  function reportEditFailure(error: unknown) {
    setState({ kind: 'rejected', detail: errorDetail(error) });
  }

  function handleEdit(intent: CanvasEditIntent) {
    submitEdit(intent)?.catch(reportEditFailure);
  }

  function handleSelectionAction(action: GeometrySelectionAction, ids: readonly string[]) {
    const expand =
      action.kind === 'duplicate' ||
      action.kind === 'arrange' ||
      action.kind === 'group' ||
      action.kind === 'ungroup' ||
      action.kind === 'createSection';
    const targets = expand ? expandCanvasSelection([...objectsById.values()], ids) : ids;

    start(
      (commandId) =>
        selectionOperation(action, targets, objectsById, revision, commandId, payloadVersion),
      emptyEdits,
    )?.catch(reportEditFailure);
  }

  function handlePaste(source: BoardClipboardSelection) {
    start((commandId) => pasteOperation(source, commandId), emptyEdits)?.catch(reportEditFailure);
  }

  function retryWithReceipt() {
    if (canEdit && pending.current) {
      return run(pending.current, 'saving');
    }
  }

  function retryEdit() {
    retryWithReceipt()?.catch(reportEditFailure);
  }

  function checkReceipt() {
    if (pending.current) {
      run(pending.current, 'checking')?.catch(reportEditFailure);
    }
  }

  return {
    state,
    pendingEdits: 'edit' in state ? state.edit.edits : emptyEdits,
    hasPendingEdit: 'edit' in state,
    handleEdit,
    submitEdit,
    reportEditFailure,
    handleSelectionAction,
    handlePaste,
    retryEdit,
    retryWithReceipt,
    checkReceipt,
    canRetry: canEdit && Boolean(service),
  };
}
