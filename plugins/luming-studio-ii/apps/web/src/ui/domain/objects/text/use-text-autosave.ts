import { useEffect, useEffectEvent, useRef } from 'react';

const textIdleMs = 250;
const textMaximumWaitMs = 1000;

export function useTextAutosave(text: string | undefined, save: () => void) {
  const firstChange = useRef<number | undefined>(undefined);
  const persist = useEffectEvent(save);

  useEffect(() => {
    if (text === undefined) {
      firstChange.current = undefined;
      return;
    }

    const now = performance.now();
    firstChange.current ??= now;
    const delay = Math.max(0, Math.min(textIdleMs, firstChange.current + textMaximumWaitMs - now));
    const timer = setTimeout(() => {
      firstChange.current = undefined;
      persist();
    }, delay);

    return () => clearTimeout(timer);
  }, [text]);
}
