import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Minus, Pause, Play, Plus, RotateCcw, Timer } from 'lucide-react';
import type { RoomTimer } from '../../../contracts/studio';
import { EditorPopover } from './EditorPopover';
import './editor-panels.css';

export type TimerAction = 'start' | 'pause' | 'resume' | 'reset' | 'adjust' | 'set-duration';
export interface TimerControlProps {
  timer: RoomTimer | null;
  canEdit: boolean;
  busy: boolean;
  clockOffsetMs?: number;
  onAction: (action: TimerAction, durationSeconds?: number, deltaSeconds?: number) => void;
}
type TimerDraft = [string | null, string | null] | null;

export function timerRemainingSeconds(timer: RoomTimer, now: number): number {
  return Math.ceil(
    Math.max(
      0,
      timer.paused || timer.deadline === null ? timer.remainingMs : timer.deadline - now,
    ) / 1000,
  );
}

function timerDigits(seconds: number): [string, string] {
  return [String(Math.floor(seconds / 60)).padStart(2, '0'), String(seconds % 60).padStart(2, '0')];
}

function TimerDigits({
  digits,
  ended = false,
  decorative = true,
}: {
  digits: [string, string];
  ended?: boolean;
  decorative?: boolean;
}) {
  return (
    <span
      className="studio-timer-digits"
      data-ended={ended || undefined}
      aria-hidden={decorative || undefined}
    >
      {digits[0]}
      <span className="studio-timer-colon">:</span>
      {digits[1]}
    </span>
  );
}

function TimerLayout({
  canEdit,
  busy,
  running,
  paused,
  actionLabel,
  configuredSeconds,
  canIncrease,
  canDecrease,
  onPlay,
  onReset,
  onAdjust,
  children,
}: {
  canEdit: boolean;
  busy: boolean;
  running: boolean;
  paused: boolean;
  actionLabel: string;
  configuredSeconds: number;
  canIncrease: boolean;
  canDecrease: boolean;
  onPlay: () => void;
  onReset: () => void;
  onAdjust: (direction: number) => void;
  children: import('react').ReactNode;
}) {
  return (
    <div className={`studio-timer-layout${canEdit ? '' : ' is-readonly'}`}>
      {canEdit && (
        <button
          type="button"
          className="studio-timer-play"
          aria-label={actionLabel}
          disabled={busy}
          onClick={onPlay}
        >
          {running ? (
            <Pause size={22} fill="currentColor" />
          ) : (
            <Play size={22} fill="currentColor" />
          )}
        </button>
      )}

      {children}
      {canEdit && (
        <div className="studio-timer-slot">
          {paused ? (
            <button
              type="button"
              className="studio-timer-reset studio-icon-button"
              aria-label="重置"
              title={`重置为 ${timerDigits(configuredSeconds).join(':')}`}
              disabled={busy}
              onClick={onReset}
            >
              <RotateCcw size={21} />
            </button>
          ) : (
            <div className="studio-timer-adjust">
              <button
                type="button"
                className="studio-icon-button"
                aria-label="增加一分钟"
                title="增加一分钟"
                disabled={!canIncrease}
                onClick={() => onAdjust(1)}
              >
                <Plus size={19} />
              </button>
              <button
                type="button"
                className="studio-icon-button"
                aria-label="减少一分钟"
                title="减少一分钟"
                disabled={!canDecrease}
                onClick={() => onAdjust(-1)}
              >
                <Minus size={19} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TimerFace({
  editable,
  digits,
  seconds,
  ended,
  busy,
  assignField,
  onChange,
  onType,
  onPaste,
  onKeyDown,
  onKeyUp,
  onDigitStart,
  onSelect,
  onBlur,
}: {
  editable: boolean;
  digits: [string, string];
  seconds: number;
  ended: boolean;
  busy: boolean;
  assignField: (field: number, node: HTMLInputElement | null) => void;
  onChange: (field: number, event: ChangeEvent<HTMLInputElement>) => void;
  onType: (field: number, data: string) => void;
  onPaste: (field: number, event: import('react').ClipboardEvent<HTMLInputElement>) => void;
  onKeyDown: (field: number, event: KeyboardEvent<HTMLInputElement>) => void;
  onKeyUp: (event: KeyboardEvent<HTMLInputElement>) => void;
  onDigitStart: () => void;
  onSelect: (event: import('react').SyntheticEvent<HTMLInputElement>) => void;
  onBlur: (field: number, event: import('react').FocusEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="studio-timer-face">
      {editable ? (
        <>
          <TimerDigits digits={digits} />
          <div className="studio-timer-duration" role="group" aria-label="计时时长">
            {[0, 1].map((field) => (
              <input
                key={field}
                ref={(node) => assignField(field, node)}
                type="text"
                role="spinbutton"
                aria-label={field === 0 ? '计时分钟' : '计时秒数'}
                aria-valuemin={0}
                aria-valuemax={field === 0 ? 99 : 59}
                aria-valuenow={Number(digits[field])}
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                disabled={busy}
                value={digits[field]}
                onChange={(event) => onChange(field, event)}
                onCompositionEnd={(event) => onType(field, event.data)}
                onPaste={(event) => onPaste(field, event)}
                onKeyDown={(event) => onKeyDown(field, event)}
                onKeyUp={onKeyUp}
                onFocus={onDigitStart}
                onPointerDown={onDigitStart}
                onSelect={onSelect}
                onBlur={(event) => onBlur(field, event)}
              />
            ))}
          </div>
        </>
      ) : (
        <output className="studio-timer-display" aria-label="剩余时间">
          <TimerDigits digits={timerDigits(seconds)} ended={ended} decorative={false} />
        </output>
      )}
    </div>
  );
}

const phaseStatus = { idle: '待开始', running: '计时中', paused: '已暂停', ended: '已结束' };
const phaseAction = { idle: '开始', running: '暂停', paused: '继续', ended: '开始' };

function timerPhase(timer: RoomTimer | null, now: number): keyof typeof phaseStatus {
  if (!timer) {
    return 'idle';
  }

  const remaining = timerRemainingSeconds(timer, now);
  const deadline = timer.deadline;
  if (timer.paused && remaining > 0) {
    return 'paused';
  }
  if (!timer.paused && deadline !== null && deadline > now) {
    return 'running';
  }

  const finished = deadline !== null && remaining === 0 && now < deadline + 2400;

  return finished ? 'ended' : 'idle';
}

function useTimerClock(timer: RoomTimer | null, clockOffsetMs: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let interval: number | undefined;
    const update = () => {
      const stamp = Date.now() + clockOffsetMs;
      setNow(stamp);
      if (
        timer?.deadline !== null &&
        timer?.deadline !== undefined &&
        stamp >= timer.deadline + 2400
      ) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };

    const visibility = () => {
      window.clearInterval(interval);
      interval = undefined;
      if (document.visibilityState === 'hidden') {
        return;
      }

      update();
      if (
        timer?.deadline !== null &&
        timer?.deadline !== undefined &&
        Date.now() + clockOffsetMs < timer.deadline + 2400
      ) {
        interval = window.setInterval(update, 250);
      }
    };

    visibility();
    document.addEventListener('visibilitychange', visibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [timer?.deadline, timer?.paused, timer?.remainingMs, clockOffsetMs]);

  return now;
}

export function TimerControl({
  timer,
  canEdit,
  busy,
  clockOffsetMs = 0,
  onAction,
}: TimerControlProps) {
  const [open, setOpen] = useState(() => !!timer && (timer.deadline !== null || timer.paused));
  const [localDuration, setLocalDuration] = useState(300);
  const now = useTimerClock(timer, clockOffsetMs);
  const [draft, setDraft] = useState<TimerDraft>(null);
  const [entryMessage, setEntryMessage] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const fields = useRef<(HTMLInputElement | null)[]>([null, null]);
  const firstDigit = useRef(true);
  const phase = timerPhase(timer, now);
  const running = phase === 'running';
  const ended = phase === 'ended';
  const paused = phase === 'paused';
  const idle = phase === 'idle';
  const activePhase = running || paused ? phase : 'inactive';
  const [previousPhase, setPreviousPhase] = useState(activePhase);
  if (previousPhase !== activePhase) {
    setPreviousPhase(activePhase);
    if (activePhase !== 'inactive') {
      setOpen(true);
    }
  }

  const configuredSeconds = timer ? timer.durationMs / 1000 : localDuration;
  const seconds = idle ? configuredSeconds : timerRemainingSeconds(timer!, now);
  const originalDigits = timerDigits(seconds);
  const digits: [string, string] = [
    draft?.[0] ?? originalDigits[0],
    draft?.[1] ?? originalDigits[1],
  ];
  const editable = canEdit && !running && !ended;
  if (!editable && draft) {
    setDraft(null);
  }

  const label = timerDigits(seconds).join(':');
  const actionLabel = phaseAction[phase];
  const parsedDraft = () => {
    const value = Number(digits[0]) * 60 + Number(digits[1]);

    return value >= 1 && value <= 5999 ? value : undefined;
  };

  function finishDraft(publish = true): number | undefined {
    firstDigit.current = true;
    if (!draft) {
      return seconds;
    }

    const value = parsedDraft();
    setDraft(null);
    if (value === undefined) {
      setEntryMessage('计时时长至少为 1 秒。');

      return;
    }

    setEntryMessage('');
    setLocalDuration(value);
    if (publish && (!idle || value !== seconds)) {
      onAction('set-duration', value);
    }

    return value;
  }

  function setField(field: number, value: string, previous: TimerDraft = draft): TimerDraft {
    return field === 0 ? [value, previous?.[1] ?? null] : [previous?.[0] ?? null, value];
  }

  function handleDigitInput(field: number, input: string) {
    const normalized = input.normalize('NFKC');
    const pasted = /^\s*(\d{1,2})\s*[:.,]\s*([0-5]?\d)\s*$/.exec(normalized);
    if (pasted || (field === 0 && [':', '.', ','].includes(normalized))) {
      firstDigit.current = true;
      if (pasted) {
        setDraft([pasted[1]!.padStart(2, '0'), pasted[2]!.padStart(2, '0')]);
      }

      fields.current[1]?.focus();

      return;
    }

    let next = draft;
    let index = field;
    for (const digit of normalized.replace(/\D/g, '')) {
      const previous = next?.[index] ?? originalDigits[index]!;
      const value = firstDigit.current ? `0${digit}` : previous.slice(-1) + digit;
      const complete = !firstDigit.current || (index === 1 && digit > '5');
      next = setField(index, value, next);
      firstDigit.current = complete;
      if (complete) {
        index = 1;
      }
    }

    if (next !== draft) {
      setEntryMessage('');
      setDraft(next);
      if (index !== field) {
        const continuing = firstDigit.current;
        fields.current[index]?.focus();
        firstDigit.current = continuing;
      }
    }
  }

  function handleDigitChange(field: number, event: ChangeEvent<HTMLInputElement>) {
    const input = event.nativeEvent as InputEvent;
    if (input.isComposing) {
      return;
    }

    if (input.inputType?.startsWith('delete')) {
      firstDigit.current = true;
      setDraft(setField(field, '00'));
    } else if (input.data !== undefined && input.data !== null) {
      handleDigitInput(field, input.data);
    } else {
      const value = event.currentTarget.value.normalize('NFKC');
      if (/[:.,]/.test(value)) {
        handleDigitInput(field, value);
      } else if (/^\d{0,2}$/.test(value)) {
        setDraft(
          setField(field, String(Math.min(field === 0 ? 99 : 59, Number(value))).padStart(2, '0')),
        );
        firstDigit.current = true;
      }
    }
  }

  function handleDigitKeyDown(field: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      finishDraft();
    } else if (event.key === 'Escape' && draft) {
      event.preventDefault();
      event.stopPropagation();
      firstDigit.current = true;
      setDraft(null);
      setEntryMessage('');
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      firstDigit.current = true;
      const step = event.key === 'ArrowUp' ? 1 : -1;
      let value = Number(digits[field]) + step;
      if (field === 0) {
        const wouldBeZero = value === 0 && Number(digits[1]) === 0;
        if (value < 0 || value > 99 || wouldBeZero) {
          return;
        }
      } else {
        value = (value + 60) % 60;
        if (value === 0 && Number(digits[0]) === 0) {
          value = (value + step + 60) % 60;
        }
      }

      setDraft(setField(field, String(value).padStart(2, '0')));
    } else if (
      field === 0
        ? event.key === 'ArrowRight' || [':', '.', ','].includes(event.key)
        : event.key === 'ArrowLeft'
    ) {
      event.preventDefault();
      fields.current[1 - field]?.focus();
    }
  }

  function handlePlay() {
    if (running) {
      onAction('pause', undefined);

      return;
    }

    const value = finishDraft(false);
    if (value === undefined) {
      return;
    }

    if (draft) {
      onAction('start', value);
    } else {
      onAction(paused ? 'resume' : 'start', timer ? undefined : value);
    }
  }

  function handleAdjust(direction: number) {
    setDraft(null);
    firstDigit.current = true;
    if (running) {
      onAction('adjust', undefined, direction * 60);
    } else {
      const value =
        direction > 0 ? Math.floor(seconds / 60) * 60 + 60 : Math.ceil(seconds / 60) * 60 - 60;
      setLocalDuration(value);
      onAction('set-duration', value);
    }
  }

  function canNudge(direction: number): boolean {
    const canAdjust = running || idle;
    if (busy || !canEdit || !canAdjust) {
      return false;
    }

    if (running) {
      const value = timer!.deadline! - now + direction * 60_000;

      return value >= 1000 && value <= 5_999_000;
    }

    const value =
      direction > 0 ? Math.floor(seconds / 60) * 60 + 60 : Math.ceil(seconds / 60) * 60 - 60;

    return value >= 60 && value <= 5940;
  }

  function handleClose() {
    setOpen(false);
    setDraft(null);
  }

  function handleReset() {
    setDraft(null);
    onAction('reset');
  }

  function handlePaste(field: number, event: import('react').ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    handleDigitInput(field, event.clipboardData.getData('text'));
  }

  function handleSpinKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      finishDraft();
    }
  }

  function handleDigitSelect(event: import('react').SyntheticEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    if (input.selectionStart !== input.selectionEnd) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function handleDigitBlur(field: number, event: import('react').FocusEvent<HTMLInputElement>) {
    const target = event.relatedTarget;
    if (target === fields.current[1 - field]) {
      return;
    }
    if (target instanceof Element && target.closest('.studio-timer-play')) {
      return;
    }

    finishDraft();
  }

  return (
    <div className="studio-editor-popover-anchor studio-timer-control">
      <button
        ref={anchor}
        type="button"
        className={`studio-icon-button studio-timer-trigger${open ? ' is-active' : ''}`}
        aria-label="共享计时器"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={!idle ? `共享计时器 ${label}` : '共享计时器'}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Timer size={19} />
      </button>
      {open && (
        <EditorPopover
          title="共享计时器"
          hideHeading
          persistent
          className="studio-timer-popover"
          anchorRef={anchor}
          onClose={handleClose}
        >
          <TimerLayout
            canEdit={canEdit}
            busy={busy}
            running={running}
            paused={paused}
            actionLabel={actionLabel}
            configuredSeconds={configuredSeconds}
            canIncrease={canNudge(1)}
            canDecrease={canNudge(-1)}
            onPlay={handlePlay}
            onReset={handleReset}
            onAdjust={handleAdjust}
          >
            <TimerFace
              editable={editable}
              digits={digits}
              seconds={seconds}
              ended={ended}
              busy={busy}
              assignField={(field, node) => {
                fields.current[field] = node;
              }}
              onChange={handleDigitChange}
              onType={handleDigitInput}
              onPaste={handlePaste}
              onKeyDown={handleDigitKeyDown}
              onKeyUp={handleSpinKey}
              onDigitStart={() => {
                firstDigit.current = true;
              }}
              onSelect={handleDigitSelect}
              onBlur={handleDigitBlur}
            />
          </TimerLayout>
          <span className="studio-timer-status" aria-label="计时状态">
            {phaseStatus[phase]}
          </span>
          <span className="studio-timer-status" aria-live="polite">
            {entryMessage}
          </span>
        </EditorPopover>
      )}
    </div>
  );
}
