import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  CanvasObjectKind,
  CanvasObjectNavigation,
  CanvasObjectReceipt,
  CanvasProps,
} from './contracts.js';

function useCommittedCallback<Args extends unknown[], Result>(
  handler: ((...args: Args) => Result) | undefined,
  fallback: (...args: Args) => Result,
) {
  const current = useRef(handler);
  useLayoutEffect(() => {
    current.current = handler;
  }, [handler]);

  const invoke = useCallback((...args: Args) => (current.current ?? fallback)(...args), [fallback]);

  return handler ? invoke : undefined;
}

const ignore = () => undefined;
const unavailable = (): CanvasObjectReceipt => ({ ok: false, message: '当前对象不可编辑。' });

export function useCanvasRenderActions(
  props: CanvasProps,
  navigate: (id: string, event: CanvasObjectNavigation) => void,
) {
  const onObjectNavigation = useCommittedCallback(navigate, ignore);
  const onObjectIntent = useCommittedCallback(props.onObjectIntent, unavailable);
  const onAnnotateContent = useCommittedCallback(props.onAnnotateContent, ignore);
  const onOpenPresentation = useCommittedCallback(props.onOpenPresentation, ignore);
  const onClosePresentation = useCommittedCallback(props.onClosePresentation, ignore);
  const onOpenNativeSource = useCommittedCallback(props.onOpenNativeSource, ignore);
  const onObjectEditingChange = useCommittedCallback(props.onObjectEditingChange, ignore);
  const kinds = useMemo(
    () => [...new Set(props.scene.objects.map(({ kind }) => kind))],
    [props.scene.objects],
  );
  const writable = kinds.filter((kind) => props.canWriteObject?.(kind) ?? true);
  const [allowed, setAllowed] = useState(writable);
  if (
    allowed.length !== writable.length ||
    allowed.some((kind, index) => kind !== writable[index])
  ) {
    setAllowed(writable);
  }

  const canWriteObject = useCallback((kind: CanvasObjectKind) => allowed.includes(kind), [allowed]);

  return {
    onObjectNavigation,
    onObjectIntent,
    onAnnotateContent,
    onOpenPresentation,
    onClosePresentation,
    onOpenNativeSource,
    onObjectEditingChange,
    canWriteObject,
  };
}
