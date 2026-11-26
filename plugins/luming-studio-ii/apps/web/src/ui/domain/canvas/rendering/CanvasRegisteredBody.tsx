import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import type { ComponentType } from 'react';
import type {
  CanvasObjectNavigation,
  CanvasObjectOperation,
  CanvasObjectReceipt,
  CanvasObjectViewProps,
  CanvasProps,
} from '../contracts.js';

type SubmitObjectIntent = NonNullable<CanvasProps['onObjectIntent']>;
type NavigateObject = (id: string, event: CanvasObjectNavigation) => void;
type RetainObject = (id: string, retain: boolean) => void;

interface CanvasRegisteredBodyProps extends Omit<
  CanvasObjectViewProps,
  'request' | 'onNavigation' | 'onRetentionChange' | 'onOpenPresentation'
> {
  readonly View: ComponentType<CanvasObjectViewProps>;
  readonly onObjectIntent?: SubmitObjectIntent;
  readonly onObjectNavigation?: NavigateObject;
  readonly onObjectRetentionChange?: RetainObject;
  readonly onOpenPresentation?: CanvasProps['onOpenPresentation'];
}

interface CanvasBodyTarget {
  readonly id?: string;
  readonly kind: CanvasObjectViewProps['object']['kind'];
  readonly View: ComponentType<CanvasObjectViewProps>;
}

interface CanvasBodyAuthority {
  readonly target: CanvasBodyTarget;
  readonly submit?: SubmitObjectIntent;
  readonly navigate?: NavigateObject;
}

const unavailableReceipt: CanvasObjectReceipt = Object.freeze({
  ok: false,
  message: '当前对象不可编辑。',
});

export function CanvasRegisteredBody({
  View,
  onObjectIntent,
  onObjectNavigation,
  onObjectRetentionChange,
  onOpenPresentation,
  ...props
}: CanvasRegisteredBodyProps) {
  const { id, object, readOnly } = props;
  const { kind } = object;
  const target = useMemo(() => ({ id, kind, View }), [id, kind, View]);
  const authority = useRef<CanvasBodyAuthority | null>(null);
  const explicitRetention = useRef(false);
  const pending = useRef(0);
  const reportedRetention = useRef(false);

  const publishRetention = useCallback(() => {
    const retain = explicitRetention.current || pending.current > 0;
    if (id === undefined || reportedRetention.current === retain) {
      return;
    }

    reportedRetention.current = retain;
    onObjectRetentionChange?.(id, retain);
  }, [id, onObjectRetentionChange]);

  useLayoutEffect(
    () => () => {
      explicitRetention.current = false;
      pending.current = 0;
      reportedRetention.current = false;
      if (id !== undefined) {
        onObjectRetentionChange?.(id, false);
      }
    },
    [id, onObjectRetentionChange, target],
  );

  useLayoutEffect(() => {
    authority.current = {
      target,
      submit: readOnly ? undefined : onObjectIntent,
      navigate: onObjectNavigation,
    };

    return () => {
      authority.current = null;
    };
  }, [target, readOnly, onObjectIntent, onObjectNavigation]);

  const request = useCallback(
    async (operation: CanvasObjectOperation): Promise<CanvasObjectReceipt> => {
      const active = authority.current;
      if (id === undefined || active?.target !== target || !active.submit) {
        return unavailableReceipt;
      }

      pending.current += 1;
      publishRetention();
      try {
        return await active.submit({
          objectId: id,
          kind,
          name: operation.name,
          expectedVersion: operation.expectedVersion,
          value: operation.value,
        });
      } finally {
        if (authority.current?.target === target) {
          pending.current -= 1;
          publishRetention();
        }
      }
    },
    [id, kind, publishRetention, target],
  );
  const retain = useCallback(
    (value: boolean) => {
      if (authority.current?.target === target) {
        explicitRetention.current = value;
        publishRetention();
      }
    },
    [publishRetention, target],
  );
  const navigate = useCallback(
    (event: CanvasObjectNavigation) => {
      const active = authority.current;
      if (id !== undefined && active?.target === target) {
        active.navigate?.(id, event);
      }
    },
    [id, target],
  );
  const openPresentation = useCallback(() => {
    if (id !== undefined && authority.current?.target === target) {
      onOpenPresentation?.([id]);
    }
  }, [id, target, onOpenPresentation]);

  return (
    <View
      {...props}
      request={request}
      onNavigation={id !== undefined && onObjectNavigation ? navigate : undefined}
      onRetentionChange={id !== undefined && onObjectRetentionChange ? retain : undefined}
      onOpenPresentation={onOpenPresentation && id !== undefined ? openPresentation : undefined}
    />
  );
}
