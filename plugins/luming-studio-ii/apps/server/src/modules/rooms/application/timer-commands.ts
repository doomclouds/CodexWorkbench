import {
  changeTimer,
  initialTimer,
  timerView,
  type RoomTimerReceipt,
  type TimerCommand,
  type TimerCommandKey,
  type TimerRejection,
} from '../domain/index.js';
import type { RoomRepository } from '../ports/index.js';

export interface TimerChange {
  readonly receipt: RoomTimerReceipt;
  readonly changed: boolean;
}

function rejected(key: TimerCommandKey, reason: TimerRejection): TimerChange {
  return { changed: false, receipt: { ...key, outcome: { kind: 'rejected', reason } } };
}

export function executeTimerChange(
  repository: RoomRepository,
  actorId: string,
  command: TimerCommand,
  now: number,
): TimerChange {
  const { boardId, commandId, expectedVersion, action } = command;
  const key = { boardId, commandId };
  const signature = JSON.stringify([expectedVersion.toString(), action]);

  return repository.write((writer) => {
    if (!writer.access(boardId, actorId)?.canEdit) {
      return rejected(key, 'forbidden');
    }

    const stored = writer.receipt(actorId, key);
    if (stored) {
      return stored.signature === signature
        ? { changed: false, receipt: stored.receipt }
        : rejected(key, 'commandIdReuse');
    }

    const current = writer.timer(boardId) ?? initialTimer;
    if (current.version !== expectedVersion) {
      const outcome = { kind: 'conflict', timer: timerView(current, now) } as const;

      return { changed: false, receipt: { ...key, outcome } };
    }

    const next = changeTimer(current, action, now);
    if (!next) {
      return rejected(key, 'invalidAction');
    }

    const outcome = { kind: 'applied', timer: timerView(next, now) } as const;
    const receipt = { ...key, outcome };
    writer.saveTimer(boardId, next);
    writer.saveReceipt(actorId, { signature, receipt });

    return { changed: true, receipt };
  });
}
