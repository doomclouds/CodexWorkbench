import { Minus, Pause, Play, Plus, RotateCcw, Timer } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { BoardRoomSession, BoardRoomState } from '../../data/rooms/index.js';
import {
  AnchoredPopover,
  Button,
  StatusText,
  type AnchoredPopoverCloseReason,
} from '../../ui/base/index.js';
import {
  adjustedIdleSeconds,
  maxSeconds,
  milliseconds,
  minute,
  timerDigits,
  timerPhase,
  timerRemaining,
  useTimerClock,
} from './timer-display.js';
import { TimerDigits, TimerEntry, useTimerEntry } from './timer-entry.js';
import { useTimerCommands } from './use-timer-commands.js';
import './shared-timer.css';

export interface SharedTimerSurfaceProps {
  readonly session: BoardRoomSession;
  readonly createCommandId: () => string;
}

interface TimerControlsProps extends SharedTimerSurfaceProps {
  readonly state: BoardRoomState;
}

const statuses = { idle: '待开始', running: '计时中', paused: '已暂停', ended: '已结束' };
const actions = { idle: '开始', running: '暂停', paused: '继续', ended: '开始' };
const minuteMs = minute * milliseconds;
const maxWholeMinuteSeconds = maxSeconds - (maxSeconds % minute);

function isDuration(seconds: number) {
  return seconds >= 1 && seconds <= maxSeconds;
}

function isWholeMinuteDuration(seconds: number) {
  return seconds >= minute && seconds <= maxWholeMinuteSeconds;
}

function TimerAdjusters({
  canIncrease,
  canDecrease,
  blocked,
  onAdjust,
}: {
  readonly canIncrease: boolean;
  readonly canDecrease: boolean;
  readonly blocked: boolean;
  readonly onAdjust: (direction: number) => void;
}) {
  return (
    <div className="whiteboard-shared-timer__adjust">
      <button
        type="button"
        data-timer-action
        aria-label="增加一分钟"
        title="增加一分钟"
        disabled={!canIncrease}
        aria-disabled={blocked || undefined}
        onClick={() => onAdjust(1)}
      >
        <Plus size={19} />
      </button>
      <button
        type="button"
        data-timer-action
        aria-label="减少一分钟"
        title="减少一分钟"
        disabled={!canDecrease}
        aria-disabled={blocked || undefined}
        onClick={() => onAdjust(-1)}
      >
        <Minus size={19} />
      </button>
    </div>
  );
}

interface TimerPopoverProps {
  readonly anchor: HTMLButtonElement | null;
  readonly open: boolean;
  readonly timer?: BoardRoomState['timer'];
  readonly status: BoardRoomState['status'];
  readonly phase: keyof typeof statuses;
  readonly digits: ReturnType<typeof timerDigits>;
  readonly writable: boolean;
  readonly commands: ReturnType<typeof useTimerCommands>;
  readonly entry: ReturnType<typeof useTimerEntry>;
  readonly canAdjust: (direction: number) => boolean;
  readonly onDismiss: (reason: AnchoredPopoverCloseReason) => void;
  readonly onPlay: () => void;
  readonly onReset: () => void;
  readonly onAdjust: (direction: number) => void;
}

function TimerPopover({
  anchor,
  open,
  timer,
  status,
  phase,
  digits,
  writable,
  commands,
  entry,
  canAdjust,
  onDismiss,
  onPlay,
  onReset,
  onAdjust,
}: TimerPopoverProps) {
  const running = phase === 'running';
  const paused = phase === 'paused';
  const blocked = commands.busy || commands.recovering;
  const editable = writable && !running && phase !== 'ended';
  const connectionNotice =
    status === 'reconnecting' ? '共享计时已断开，正在重新连接。' : '正在连接共享计时器…';

  return (
    <AnchoredPopover
      anchor={anchor}
      open={open}
      label="共享计时器"
      align="end"
      persistent
      onRequestClose={onDismiss}
    >
      <div className="whiteboard-shared-timer__panel">
        {timer ? (
          <div className="whiteboard-shared-timer__layout" data-readonly={!writable || undefined}>
            {writable && (
              <button
                type="button"
                data-timer-action
                className="whiteboard-shared-timer__play"
                aria-label={actions[phase]}
                aria-disabled={blocked || undefined}
                onClick={onPlay}
              >
                {running ? (
                  <Pause size={22} fill="currentColor" />
                ) : (
                  <Play size={22} fill="currentColor" />
                )}
              </button>
            )}
            <div className="whiteboard-shared-timer__face">
              {editable ? (
                <TimerEntry entry={entry} readOnly={blocked} />
              ) : (
                <output className="whiteboard-shared-timer__display" aria-label="剩余时间">
                  <TimerDigits digits={digits} ended={phase === 'ended'} />
                </output>
              )}
            </div>
            {writable && (
              <div className="whiteboard-shared-timer__slot">
                {paused ? (
                  <button
                    type="button"
                    data-timer-action
                    className="whiteboard-shared-timer__reset"
                    aria-label="重置"
                    title={'重置为 ' + timerDigits(timer.durationMs / milliseconds).join(':')}
                    aria-disabled={blocked || undefined}
                    onClick={onReset}
                  >
                    <RotateCcw size={21} />
                  </button>
                ) : (
                  <TimerAdjusters
                    canIncrease={canAdjust(1)}
                    canDecrease={canAdjust(-1)}
                    blocked={blocked}
                    onAdjust={onAdjust}
                  />
                )}
              </div>
            )}
          </div>
        ) : null}
        {status !== 'online' && <StatusText message={connectionNotice} announcement="polite" />}
        <span className="whiteboard-shared-timer__status" role="status">
          {commands.busy ? '正在核对计时命令…' : ''}
        </span>
        {commands.notice && (
          <StatusText message={commands.notice} announcement="polite" tone="error" />
        )}
        {commands.recovering && writable && (
          <div className="whiteboard-shared-timer__recovery">
            <Button label="核对原回执" disabled={commands.busy} onActivate={commands.handleCheck} />
            <Button label="重试原命令" disabled={commands.busy} onActivate={commands.handleRetry} />
          </div>
        )}
        {timer && (
          <span className="whiteboard-shared-timer__status" aria-label="计时状态">
            {statuses[phase]}
          </span>
        )}
        <span className="whiteboard-shared-timer__status" aria-live="polite">
          {entry.message}
        </span>
      </div>
    </AnchoredPopover>
  );
}

function TimerControls({ session, state, createCommandId }: TimerControlsProps) {
  const { timer, status, canEdit } = state;
  const now = useTimerClock(session, timer?.deadlineUnixMs);
  const phase = timer ? timerPhase(timer, now) : 'idle';
  const active = phase === 'running' || phase === 'paused' ? phase : undefined;
  const seconds = timer ? Math.ceil(timerRemaining(timer, now) / milliseconds) : 0;
  const digits = timerDigits(seconds);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(active !== undefined);
  const commands = useTimerCommands(session, createCommandId);
  const writable = status === 'online' && canEdit;
  const blocked = commands.busy || commands.recovering;
  const running = phase === 'running';
  const entry = useTimerEntry(seconds, handleDuration);

  useEffect(
    () => (active ? session.schedule(0, () => setOpen(true)) : undefined),
    [active, session],
  );

  function saveDuration(duration: number, startAfterSave: boolean) {
    if (!timer || blocked) {
      return;
    }

    commands.submit({ kind: 'setDuration', durationMs: duration * milliseconds }, timer.version, {
      startAfterSave,
      onApplied: entry.discard,
    });
  }

  function handleDuration(duration: number) {
    if (phase === 'idle' && duration === seconds) {
      entry.discard();
    } else {
      saveDuration(duration, false);
    }
  }

  function handleToggle() {
    if (open) {
      entry.discard();
    }

    setOpen(!open);
  }

  function handleDismiss(reason: AnchoredPopoverCloseReason) {
    if (reason === 'escape' && entry.draft) {
      entry.discard();
      return;
    }

    setOpen(false);
    entry.discard();
    if (reason === 'escape') {
      anchor?.focus({ preventScroll: true });
    }
  }

  function handlePlay() {
    if (!timer || blocked) {
      return;
    }

    const current = timerPhase(timer, session.now());
    if (current === 'running') {
      commands.submit({ kind: 'pause' }, timer.version);
    } else if (entry.draft) {
      const duration = entry.finish(false);
      if (duration !== undefined) {
        saveDuration(duration, true);
      }
    } else {
      commands.submit({ kind: current === 'paused' ? 'resume' : 'start' }, timer.version);
    }
  }

  function handleReset() {
    if (timer && !blocked) {
      commands.submit({ kind: 'reset' }, timer.version, { onApplied: entry.discard });
    }
  }

  function canAdjust(direction: number) {
    if (!timer) {
      return false;
    }
    if (running) {
      return isDuration((timerRemaining(timer, now) + direction * minuteMs) / milliseconds);
    }

    return phase === 'idle' && isWholeMinuteDuration(adjustedIdleSeconds(seconds, direction));
  }

  function handleAdjust(direction: number) {
    if (!timer || blocked) {
      return;
    }

    const stamp = session.now();
    const current = timerPhase(timer, stamp);
    if (current === 'running') {
      const deltaMs = direction * minuteMs;
      if (isDuration((timerRemaining(timer, stamp) + deltaMs) / milliseconds)) {
        commands.submit({ kind: 'adjustDuration', deltaMs }, timer.version);
      }

      return;
    }

    if (current === 'idle') {
      const duration = adjustedIdleSeconds(timer.durationMs / milliseconds, direction);
      if (isWholeMinuteDuration(duration)) {
        saveDuration(duration, false);
      }
    }
  }

  return (
    <div className="whiteboard-shared-timer">
      <button
        ref={setAnchor}
        type="button"
        className="whiteboard-shared-timer__trigger"
        aria-label="共享计时器"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={phase === 'idle' ? '共享计时器' : '共享计时器 ' + digits.join(':')}
        onClick={handleToggle}
      >
        <Timer size={19} />
      </button>
      <TimerPopover
        anchor={anchor}
        open={open && anchor !== null}
        timer={timer}
        status={status}
        phase={phase}
        digits={digits}
        writable={writable}
        commands={commands}
        entry={entry}
        canAdjust={canAdjust}
        onDismiss={handleDismiss}
        onPlay={handlePlay}
        onReset={handleReset}
        onAdjust={handleAdjust}
      />
    </div>
  );
}

export function SharedTimerSurface(props: SharedTimerSurfaceProps) {
  const { session } = props;
  const subscribe = useCallback((listener: () => void) => session.subscribe(listener), [session]);
  const getSnapshot = useCallback(() => session.getSnapshot(), [session]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return state.status === 'accessLost' ? null : (
    <TimerControls key={state.viewId} {...props} state={state} />
  );
}
