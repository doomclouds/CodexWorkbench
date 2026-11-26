import { Minus, Pause, Play, Plus, RotateCcw, Timer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, FocusEvent, KeyboardEvent } from 'react';
import { AnchoredPopover, type AnchoredPopoverCloseReason } from '../../ui/base/index.js';

type Field = 0 | 1;
type Digits = readonly [string, string];

type TimerState = { readonly durationMs: number } & (
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly deadline: number }
  | { readonly kind: 'paused'; readonly remainingMs: number }
);

const milliseconds = 1000;
const minute = 60;
const maxSeconds = 5_999;
const defaultSeconds = 300;
const endGraceMs = 2400;
const tickMs = 250;
const fields = [0, 1] as const;
const statuses = { idle: '待开始', running: '计时中', paused: '已暂停', ended: '已结束' };
const actions = { idle: '开始', running: '暂停', paused: '继续', ended: '开始' };

function phaseOf(timer: TimerState, now: number): keyof typeof statuses {
  if (timer.kind !== 'running') {
    return timer.kind;
  }
  if (now < timer.deadline) {
    return 'running';
  }

  return now < timer.deadline + endGraceMs ? 'ended' : 'idle';
}

function remainingMs(timer: TimerState, now: number): number {
  if (timer.kind === 'paused') {
    return timer.remainingMs;
  }
  if (timer.kind === 'running') {
    return Math.max(0, timer.deadline - now);
  }

  return timer.durationMs;
}

function timerDigits(seconds: number): Digits {
  return [digitPair(Math.floor(seconds / minute)), digitPair(seconds % minute)];
}

function digitPair(value: number) {
  return String(value).padStart(2, '0');
}

function durationFrom(digits: Digits) {
  return Number(digits[0]) * minute + Number(digits[1]);
}

function adjustedIdleSeconds(seconds: number, direction: number) {
  const minutes = seconds / minute;

  return (direction > 0 ? Math.floor(minutes) + 1 : Math.ceil(minutes) - 1) * minute;
}

function useTimerClock(deadline: number | undefined, owner: Document | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (deadline === undefined) {
      return;
    }

    const finish = deadline + endGraceMs;
    let interval: ReturnType<typeof setInterval> | undefined;

    function stop() {
      if (interval !== undefined) {
        clearInterval(interval);
        interval = undefined;
      }
    }

    function tick() {
      const stamp = Date.now();
      setNow(stamp);
      if (stamp >= finish) {
        stop();
      }
    }

    function start() {
      if (owner?.visibilityState !== 'hidden' && Date.now() < finish) {
        interval = setInterval(tick, tickMs);
      }
    }

    function onVisibilityChange() {
      stop();
      if (owner?.visibilityState !== 'hidden') {
        tick();
        start();
      }
    }

    start();
    owner?.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      owner?.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [deadline, owner]);

  return { now, update: setNow };
}

function withDigit(digits: Digits, field: Field, digit: string): Digits {
  return field === 0 ? [digit, digits[1]] : [digits[0], digit];
}

function readPastedTime(value: string): Digits | undefined {
  const match = /^\s*(\d{1,2})\s*[:.,]\s*([0-5]?\d)\s*$/u.exec(value);
  if (match) {
    return [digitPair(Number(match[1])), digitPair(Number(match[2]))];
  }
}

function adjacentField(field: Field): Field {
  return field === 0 ? 1 : 0;
}

function spinDigits(digits: Digits, field: Field, direction: number): Digits {
  const value = Number(digits[field]) + direction;
  if (field === 0) {
    const empty = value === 0 && Number(digits[1]) === 0;
    if (value < 0 || value > 99 || empty) {
      return digits;
    }

    return withDigit(digits, field, digitPair(value));
  }

  const next = (value + minute) % minute;
  const adjusted =
    next === 0 && Number(digits[0]) === 0 ? (next + direction + minute) % minute : next;

  return withDigit(digits, field, digitPair(adjusted));
}

function useTimerEntry(seconds: number, onDuration: (duration: number) => void) {
  const [draft, setDraft] = useState<Digits>();
  const [message, setMessage] = useState('');
  const inputs = useRef<[HTMLInputElement | null, HTMLInputElement | null]>([null, null]);
  const firstDigit = useRef(true);
  const digits = draft ?? timerDigits(seconds);

  function discard() {
    firstDigit.current = true;
    setDraft(undefined);
    setMessage('');
  }

  function finish(publish = true) {
    if (!draft) {
      return seconds;
    }

    const next = durationFrom(draft);
    discard();
    if (next < 1 || next > maxSeconds) {
      setMessage('计时时长至少为 1 秒。');
      return;
    }
    if (publish) {
      onDuration(next);
    }

    return next;
  }

  function focusField(field: Field) {
    inputs.current[field]?.focus();
  }

  function typeDigits(field: Field, source: string) {
    const value = source.normalize('NFKC');
    const pasted = readPastedTime(value);
    const separator = field === 0 && [':', '.', ','].includes(value);
    if (pasted || separator) {
      if (pasted) {
        setDraft(pasted);
      }
      firstDigit.current = true;
      focusField(1);
      return;
    }

    let next = digits;
    let index = field;
    for (const digit of value.replace(/\D/gu, '')) {
      const start = firstDigit.current;
      const text = start ? `0${digit}` : next[index].slice(-1) + digit;
      const complete = !start || (index === 1 && digit > '5');
      next = withDigit(next, index, text);
      firstDigit.current = complete;
      if (complete) {
        index = 1;
      }
    }

    if (next !== digits) {
      setMessage('');
      setDraft(next);
      if (index !== field) {
        focusField(index);
      }
    }
  }

  function handleChange(field: Field, event: ChangeEvent<HTMLInputElement>) {
    const input = event.nativeEvent as InputEvent;
    if (input.isComposing) {
      return;
    }

    if (input.inputType?.startsWith('delete')) {
      firstDigit.current = true;
      setDraft(withDigit(digits, field, '00'));
      return;
    }
    if (typeof input.data === 'string') {
      typeDigits(field, input.data);
      return;
    }

    const value = event.currentTarget.value.normalize('NFKC');
    if (/[:.,]/u.test(value)) {
      typeDigits(field, value);
    } else if (/^\d{0,2}$/u.test(value)) {
      const maximum = field === 0 ? 99 : 59;
      setDraft(withDigit(digits, field, digitPair(Math.min(maximum, Number(value)))));
      firstDigit.current = true;
    }
  }

  function handleKeyDown(field: Field, event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    const { key } = event;
    if (key === 'Enter') {
      event.preventDefault();
      finish();
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      firstDigit.current = true;
      const next = spinDigits(digits, field, key === 'ArrowUp' ? 1 : -1);
      if (next !== digits) {
        setDraft(next);
      }
      return;
    }

    const otherField =
      field === 0 ? ['ArrowRight', ':', '.', ','].includes(key) : key === 'ArrowLeft';

    if (otherField) {
      event.preventDefault();
      focusField(adjacentField(field));
    }
  }

  function handleBlur(field: Field, event: FocusEvent<HTMLInputElement>) {
    const target = event.relatedTarget;
    const toAnotherField = target === inputs.current[adjacentField(field)];
    const toPlay = target instanceof Element && target.closest('.whiteboard-board-timer__play');
    if (!toAnotherField && !toPlay) {
      finish();
    }
  }

  function handlePaste(field: Field, event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    typeDigits(field, event.clipboardData.getData('text'));
  }

  function restartDigits() {
    firstDigit.current = true;
  }

  function assign(field: Field, node: HTMLInputElement | null) {
    inputs.current[field] = node;
  }

  return {
    digits,
    draft,
    message,
    assign,
    discard,
    finish,
    handleBlur,
    handleChange,
    handleKeyDown,
    handlePaste,
    restartDigits,
    typeDigits,
  };
}

function TimerDigits({
  digits,
  ended,
  decorative,
}: {
  readonly digits: Digits;
  readonly ended?: boolean;
  readonly decorative?: boolean;
}) {
  return (
    <span
      className="whiteboard-board-timer__digits"
      data-ended={ended || undefined}
      aria-hidden={decorative || undefined}
    >
      {digits[0]}
      <span>:</span>
      {digits[1]}
    </span>
  );
}

function TimerEntry({ entry }: { readonly entry: ReturnType<typeof useTimerEntry> }) {
  return (
    <>
      <TimerDigits digits={entry.digits} decorative />
      <div className="whiteboard-board-timer__duration" role="group" aria-label="计时时长">
        {fields.map((field) => (
          <input
            key={field}
            ref={(node) => entry.assign(field, node)}
            type="text"
            role="spinbutton"
            aria-label={field === 0 ? '计时分钟' : '计时秒数'}
            aria-valuemin={0}
            aria-valuemax={field === 0 ? 99 : 59}
            aria-valuenow={Number(entry.digits[field])}
            inputMode="numeric"
            enterKeyHint="done"
            autoComplete="off"
            value={entry.digits[field]}
            onChange={(event) => entry.handleChange(field, event)}
            onCompositionEnd={(event) => entry.typeDigits(field, event.data)}
            onPaste={(event) => entry.handlePaste(field, event)}
            onKeyDown={(event) => entry.handleKeyDown(field, event)}
            onKeyUp={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                entry.finish();
              }
            }}
            onFocus={entry.restartDigits}
            onPointerDown={entry.restartDigits}
            onBlur={(event) => entry.handleBlur(field, event)}
          />
        ))}
      </div>
    </>
  );
}

function TimerAdjusters({
  canIncrease,
  canDecrease,
  onAdjust,
}: {
  readonly canIncrease: boolean;
  readonly canDecrease: boolean;
  readonly onAdjust: (direction: number) => void;
}) {
  return (
    <div className="whiteboard-board-timer__adjust">
      <button
        type="button"
        aria-label="增加一分钟"
        title="增加一分钟"
        disabled={!canIncrease}
        onClick={() => onAdjust(1)}
      >
        <Plus size={19} />
      </button>
      <button
        type="button"
        aria-label="减少一分钟"
        title="减少一分钟"
        disabled={!canDecrease}
        onClick={() => onAdjust(-1)}
      >
        <Minus size={19} />
      </button>
    </div>
  );
}

export function BoardTimer({ canEdit }: { readonly canEdit: boolean }) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [timer, setTimer] = useState<TimerState>({
    kind: 'idle',
    durationMs: defaultSeconds * milliseconds,
  });
  const deadline = timer.kind === 'running' ? timer.deadline : undefined;
  const { now, update } = useTimerClock(deadline, anchor?.ownerDocument);
  const phase = phaseOf(timer, now);
  const seconds = Math.ceil(
    (phase === 'idle' ? timer.durationMs : remainingMs(timer, now)) / milliseconds,
  );
  const entry = useTimerEntry(seconds, setDuration);
  const digits = timerDigits(seconds);
  const running = phase === 'running';
  const paused = phase === 'paused';

  function setDuration(duration: number) {
    setTimer({ kind: 'idle', durationMs: duration * milliseconds });
  }

  function close() {
    entry.discard();
    setOpen(false);
  }

  function handleToggle() {
    if (open) {
      close();
      return;
    }

    setOpen(true);
  }

  function handleDismiss(reason: AnchoredPopoverCloseReason) {
    if (reason === 'escape' && entry.draft) {
      entry.discard();
      return;
    }

    close();
    if (reason === 'escape') {
      anchor?.focus({ preventScroll: true });
    }
  }

  function handleReset() {
    entry.discard();
    setDuration(timer.durationMs / milliseconds);
  }

  function handlePlay() {
    const stamp = Date.now();
    const latest = phaseOf(timer, stamp);
    update(stamp);
    if (latest === 'running') {
      setTimer({
        kind: 'paused',
        durationMs: timer.durationMs,
        remainingMs: remainingMs(timer, stamp),
      });

      return;
    }

    const pendingDraft = entry.draft;
    const value = entry.finish(false);
    if (value === undefined) {
      return;
    }

    const durationMs = pendingDraft ? value * milliseconds : timer.durationMs;
    const resumed = latest === 'paused' && !pendingDraft;
    const pending = resumed ? remainingMs(timer, stamp) : durationMs;
    setTimer({ kind: 'running', durationMs, deadline: stamp + pending });
  }

  function handleAdjust(direction: number) {
    entry.discard();
    const stamp = Date.now();
    const latest = phaseOf(timer, stamp);
    if (latest === 'running') {
      const pending = remainingMs(timer, stamp) + direction * minute * milliseconds;
      if (pending >= milliseconds && pending <= maxSeconds * milliseconds) {
        update(stamp);
        setTimer({ kind: 'running', durationMs: timer.durationMs, deadline: stamp + pending });
      }
      return;
    }
    if (latest !== 'idle') {
      return;
    }

    const value = adjustedIdleSeconds(seconds, direction);
    if (value >= minute && value <= maxSeconds) {
      setDuration(value);
    }
  }

  function canAdjust(direction: number) {
    if (running) {
      const pending = remainingMs(timer, now) + direction * minute * milliseconds;

      return pending >= milliseconds && pending <= maxSeconds * milliseconds;
    }

    const value = adjustedIdleSeconds(seconds, direction);

    return phase === 'idle' && value >= minute && value <= maxSeconds;
  }

  return (
    <div className="whiteboard-board-timer">
      <button
        ref={setAnchor}
        type="button"
        className="whiteboard-board-timer__trigger"
        aria-label="计时器"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={phase === 'idle' ? '计时器' : `计时器 ${digits.join(':')}`}
        onClick={handleToggle}
      >
        <Timer size={19} />
      </button>
      <AnchoredPopover
        anchor={anchor}
        open={open}
        label="计时器"
        persistent
        onRequestClose={handleDismiss}
      >
        <div className="whiteboard-board-timer__layout" data-readonly={!canEdit || undefined}>
          {canEdit && (
            <button
              type="button"
              className="whiteboard-board-timer__play"
              aria-label={actions[phase]}
              onClick={handlePlay}
            >
              {running ? (
                <Pause size={22} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" />
              )}
            </button>
          )}
          <div className="whiteboard-board-timer__face">
            {canEdit && !running && phase !== 'ended' ? (
              <TimerEntry entry={entry} />
            ) : (
              <output aria-label="剩余时间">
                <TimerDigits digits={digits} ended={phase === 'ended'} />
              </output>
            )}
          </div>
          {canEdit && (
            <div className="whiteboard-board-timer__slot">
              {paused ? (
                <button
                  type="button"
                  className="whiteboard-board-timer__reset"
                  aria-label="重置"
                  title={`重置为 ${timerDigits(timer.durationMs / milliseconds).join(':')}`}
                  onClick={handleReset}
                >
                  <RotateCcw size={21} />
                </button>
              ) : (
                <TimerAdjusters
                  canIncrease={canAdjust(1)}
                  canDecrease={canAdjust(-1)}
                  onAdjust={handleAdjust}
                />
              )}
            </div>
          )}
        </div>
        <span className="whiteboard-board-timer__status" aria-label="计时状态">
          {statuses[phase]}
        </span>
        <span className="whiteboard-board-timer__status" aria-live="polite">
          {entry.message}
        </span>
      </AnchoredPopover>
    </div>
  );
}
