import { useEffect, useRef, useState } from 'react';
import type {
  BoardFeedbackService,
  FeedbackCommand,
  FeedbackOperation,
  FeedbackReceipt,
  FeedbackRejection,
} from '../../data/feedback/index.js';

type AppliedFeedback = Extract<FeedbackReceipt, { readonly kind: 'applied' }>;

interface FeedbackCommandOptions {
  readonly boardId: string;
  readonly service: BoardFeedbackService;
  readonly createCommandId: () => string;
  readonly onApplied: (result: AppliedFeedback, operation: FeedbackOperation) => void;
}

type FeedbackProgress =
  | { readonly kind: 'saving' }
  | { readonly kind: 'unknown'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

const rejectionText: Record<FeedbackRejection, string> = {
  invalidText: '备注内容为空或超过长度上限。',
  invalidAnchor: '备注位置已不可用，请重新选择。',
  targetChanged: '目标位置已变化，请重新选择后再提交。',
  notFound: '此备注或回复已不存在。',
  forbidden: '当前权限无法执行此操作。',
  versionChanged: '其他成员已修改这条备注，请刷新后再编辑。',
  commandIdReuse: '本次操作与已有回执不一致，请重新提交。',
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : '未收到保存确认。';
}

export function useFeedbackCommand({
  boardId,
  service,
  createCommandId,
  onApplied,
}: FeedbackCommandOptions) {
  const [progress, setProgress] = useState<FeedbackProgress>();
  const request = useRef<FeedbackCommand | undefined>(undefined);
  const active = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => active.current?.abort(), []);

  function accept(result: FeedbackReceipt | undefined, command: FeedbackCommand, message: string) {
    if (!result) {
      setProgress({ kind: 'unknown', message });
      return;
    }

    request.current = undefined;
    if (result.kind === 'rejected') {
      setProgress({ kind: 'error', message: rejectionText[result.reason] });
      return;
    }

    setProgress(undefined);
    onApplied(result, command.operation);
  }

  async function checkReceipt(
    command: FeedbackCommand,
    controller: AbortController,
    message: string,
  ) {
    const { signal } = controller;
    try {
      const result = await service.getReceipt(command.boardId, command.commandId, signal);
      signal.throwIfAborted();
      accept(result, command, message);
    } catch (error) {
      if (!signal.aborted) {
        setProgress({ kind: 'unknown', message: errorText(error) });
      }
    }
  }

  async function send(command: FeedbackCommand, controller: AbortController) {
    const { signal } = controller;
    try {
      const result = await service.apply(command, signal);
      signal.throwIfAborted();
      accept(result, command, '');
    } catch (error) {
      if (!signal.aborted) {
        await checkReceipt(command, controller, errorText(error));
      }
    }
  }

  function run(command: FeedbackCommand, mode: 'send' | 'lookup') {
    if (active.current) {
      return;
    }

    const controller = new AbortController();
    active.current = controller;
    setProgress({ kind: 'saving' });
    const pending =
      mode === 'send'
        ? send(command, controller)
        : checkReceipt(command, controller, '暂无此操作的保存回执。');

    pending
      .finally(() => {
        if (active.current === controller) {
          active.current = undefined;
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setProgress({ kind: 'unknown', message: errorText(error) });
        }
      });
  }

  function submit(operation: FeedbackOperation) {
    if (!request.current) {
      const command = { boardId, commandId: createCommandId(), operation };
      request.current = command;
      run(command, 'send');
    }
  }

  function retry() {
    if (request.current) {
      run(request.current, 'send');
    }
  }

  function check() {
    if (request.current) {
      run(request.current, 'lookup');
    }
  }

  return { progress, submit, retry, check };
}
