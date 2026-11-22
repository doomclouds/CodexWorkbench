import { useCallback, useState } from 'react';
import type { RoomTimer } from '../../../contracts/studio';
import type { StudioViewRequests } from '../../shared/studio-view-scope';
import type { TimerAction } from './TimerControl';

interface TimerRequest {
  action: TimerAction;
  durationSeconds?: number;
  deltaSeconds?: number;
}

export function useRoomTimer(scope: StudioViewRequests) {
  const [roomTimer, setRoomTimer] = useState<RoomTimer | null>(null);
  const [timerBusy, setTimerBusy] = useState(false);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const resetTimer = useCallback(() => {
    setRoomTimer(null);
    setTimerBusy(false);
  }, []);

  async function changeTimer(
    send: (request: Record<string, unknown>) => Promise<void>,
    canEdit: boolean,
    { action, durationSeconds, deltaSeconds }: TimerRequest,
    onError: (cause: unknown) => void,
  ) {
    if (!canEdit || timerBusy) {
      return;
    }

    const request = scope.capture();
    setTimerBusy(true);
    try {
      await send({
        action,
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
        ...(deltaSeconds !== undefined ? { deltaSeconds } : {}),
      });
    } catch (cause) {
      if (scope.isCurrent(request)) {
        onError(cause);
      }
    } finally {
      if (scope.isCurrent(request)) {
        setTimerBusy(false);
      }
    }
  }

  return {
    roomTimer,
    timerBusy,
    clockOffsetMs,
    setRoomTimer,
    setClockOffsetMs,
    resetTimer,
    changeTimer,
  };
}
