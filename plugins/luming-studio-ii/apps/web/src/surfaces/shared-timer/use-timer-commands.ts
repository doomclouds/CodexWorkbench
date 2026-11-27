import { useEffect, useRef, useState } from 'react';
import type {
  BoardRoomSession,
  BoardRoomTimerAction,
  BoardRoomTimerCommand,
  BoardRoomTimerReceipt,
} from '../../data/rooms/index.js';

interface TimerPlan {
  readonly session: BoardRoomSession;
  readonly command: BoardRoomTimerCommand;
  readonly startAfterSave?: boolean;
  readonly onApplied?: () => void;
}

interface TimerAttempt {
  readonly plan: TimerPlan;
  readonly controller: AbortController;
}

type RequestMode = 'send' | 'check' | 'retry';

const rejections = {
  forbidden: '当前参与者不能控制计时器。',
  invalidAction: '当前计时状态无法执行此操作。',
  commandIdReuse: '计时命令已被不同的请求使用。',
};

function canWrite(session: BoardRoomSession) {
  const { status, canEdit } = session.getSnapshot();

  return status === 'online' && canEdit;
}

async function findReceipt({ plan, controller }: TimerAttempt) {
  const receipt = await plan.session.getTimerReceipt(plan.command.commandId, controller.signal);
  if (receipt?.kind === 'rejected' && receipt.reason === 'forbidden') {
    throw new Error('当前参与者无法核对原计时回执。');
  }

  return receipt;
}

async function requestTimer(attempt: TimerAttempt, mode: RequestMode) {
  const { plan, controller } = attempt;
  const { signal } = controller;
  if (mode === 'check') {
    return findReceipt(attempt);
  }

  if (mode === 'retry') {
    const known = await findReceipt(attempt);
    signal.throwIfAborted();
    if (known) {
      return known;
    }
  }

  if (!canWrite(plan.session)) {
    throw new Error('房间尚不可写，请恢复连接后重试。');
  }

  try {
    return await plan.session.changeTimer(plan.command, signal);
  } catch (error) {
    signal.throwIfAborted();
    const known = await findReceipt(attempt);
    if (known) {
      return known;
    }

    throw error;
  }
}

export function useTimerCommands(session: BoardRoomSession, createCommandId: () => string) {
  const [pending, setPending] = useState<BoardRoomSession>();
  const [recovery, setRecovery] = useState<TimerPlan>();
  const [notice, setNotice] = useState('');
  const active = useRef<TimerAttempt>(undefined);
  const recoverable = recovery?.session === session ? recovery : undefined;
  const busy = pending === session;

  useEffect(
    () => () => {
      active.current?.controller.abort();
      active.current = undefined;
    },
    [session],
  );

  function release(attempt: TimerAttempt) {
    if (active.current !== attempt || attempt.controller.signal.aborted) {
      return false;
    }

    active.current = undefined;
    setPending(undefined);

    return true;
  }

  function handleApplied(plan: TimerPlan, timerVersion: bigint) {
    plan.onApplied?.();
    if (!plan.startAfterSave) {
      return;
    }

    if (canWrite(session)) {
      startNew({ kind: 'start' }, timerVersion);
    } else {
      setNotice('计时时长已保存。恢复连接与编辑权限后可开始。');
    }
  }

  function handleReceipt(attempt: TimerAttempt, receipt: BoardRoomTimerReceipt | undefined) {
    if (!release(attempt)) {
      return;
    }

    if (!receipt || receipt.commandId !== attempt.plan.command.commandId) {
      setRecovery(attempt.plan);
      setNotice('尚未核对到原计时命令的回执。');
      return;
    }

    setRecovery(undefined);
    if (receipt.kind === 'applied') {
      handleApplied(attempt.plan, receipt.timer.version);
    } else if (receipt.kind === 'rejected') {
      setNotice(rejections[receipt.reason]);
    } else {
      setNotice('计时状态已更新，请核对后再提交。');
    }
  }

  function send(plan: TimerPlan, mode: RequestMode) {
    if (active.current || !canWrite(session)) {
      return;
    }

    const attempt = { plan, controller: new AbortController() };
    active.current = attempt;
    setPending(session);
    setNotice('');
    requestTimer(attempt, mode)
      .then((receipt) => handleReceipt(attempt, receipt))
      .catch((error: unknown) => {
        if (release(attempt)) {
          setRecovery(plan);
          const detail = error instanceof Error ? ' ' + error.message : '';
          setNotice('计时命令结果待确认。' + detail);
        }
      });
  }

  function startNew(
    action: BoardRoomTimerAction,
    expectedVersion: bigint,
    continuation: Pick<TimerPlan, 'startAfterSave' | 'onApplied'> = {},
  ) {
    if (!canWrite(session)) {
      return;
    }

    try {
      const command = { commandId: createCommandId(), expectedVersion, action };
      send({ session, command, ...continuation }, 'send');
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法创建计时命令。';
      setNotice(message);
    }
  }

  function submit(
    action: BoardRoomTimerAction,
    expectedVersion: bigint,
    continuation?: Pick<TimerPlan, 'startAfterSave' | 'onApplied'>,
  ) {
    if (!recoverable && !active.current) {
      startNew(action, expectedVersion, continuation);
    }
  }

  function handleCheck() {
    if (recoverable) {
      send(recoverable, 'check');
    }
  }

  function handleRetry() {
    if (recoverable) {
      send(recoverable, 'retry');
    }
  }

  return { busy, recovering: recoverable !== undefined, notice, submit, handleCheck, handleRetry };
}
