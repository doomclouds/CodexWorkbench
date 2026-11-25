import { useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { Button, StatusText } from '../../../base/index.js';
import type {
  CanvasObjectExtension,
  CanvasObjectPayload,
  CanvasObjectViewProps,
} from '../../canvas/index.js';
import { TextObject } from './TextObject.js';
import type { TextObjectProps } from './TextObject.js';

type TextBody = Pick<TextObjectProps, 'text' | 'color' | 'fontFamily' | 'fontSize' | 'align'>;

interface TextSource {
  version: number;
  body: TextBody;
}

interface TextDraft {
  base: TextSource;
  text: string;
}

interface SaveFailure {
  message: string;
  adjacent: boolean;
}

const commitName = 'text.commit';
const saveFailureMessage = '无法保存文字';

function readTextBody(value: unknown, fallback: string): TextBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { text: fallback };
  }

  const { text, color, fontFamily, fontSize, align } = value as Record<string, unknown>;
  const validSize = typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize > 0;
  const validAlignment = align === 'left' || align === 'center' || align === 'right';

  return {
    text: typeof text === 'string' ? text : fallback,
    color: typeof color === 'string' ? color : undefined,
    fontFamily: typeof fontFamily === 'string' ? fontFamily : undefined,
    fontSize: validSize ? fontSize : undefined,
    align: validAlignment ? align : undefined,
  };
}

function readTextSource(payload: CanvasObjectPayload | undefined, fallback: string) {
  if (!payload || !Number.isSafeInteger(payload.version) || payload.version < 0) {
    return undefined;
  }

  return { version: payload.version, body: readTextBody(payload.value, fallback) };
}

function resolveSource(incoming: TextSource | undefined, receipt: TextSource | undefined) {
  const newer = incoming && receipt && receipt.version >= incoming.version;

  return newer ? receipt : incoming;
}

function canWriteText(
  id: string | undefined,
  selected: boolean,
  readOnly: boolean,
  source: TextSource | undefined,
) {
  return Boolean(id) && selected && !readOnly && Boolean(source);
}

function useDraftRetention(
  draft: TextDraft | undefined,
  failure: SaveFailure | undefined,
  saving: boolean,
  onRetentionChange: CanvasObjectViewProps['onRetentionChange'],
) {
  const retained = saving || Boolean(draft ?? failure);
  const observesRetention = onRetentionChange !== undefined;
  const retain = useEffectEvent(() => {
    onRetentionChange?.(true);

    return () => onRetentionChange?.(false);
  });

  useLayoutEffect(() => {
    if (retained && observesRetention) {
      return retain();
    }
  }, [retained, observesRetention]);
}

function CanvasTextView({
  id,
  object,
  payload,
  selected,
  readOnly,
  editRequest,
  request,
  content,
  onRetentionChange,
}: CanvasObjectViewProps) {
  const [receiptSource, setReceiptSource] = useState<TextSource>();
  const [draft, setDraft] = useState<TextDraft>();
  const [localEdit, setLocalEdit] = useState(false);
  const [closedRequest, setClosedRequest] = useState<number>();
  const [failure, setFailure] = useState<SaveFailure>();
  const [saving, setSaving] = useState(false);
  useDraftRetention(draft, failure, saving, onRetentionChange);
  const latestDraft = useRef<TextDraft | undefined>(undefined);
  const writeInFlight = useRef(false);
  const source = resolveSource(readTextSource(payload, object.label), receiptSource);
  const body = source?.body ?? { text: object.label };
  const writable = canWriteText(id, selected, readOnly, source);
  const requested = editRequest !== undefined && editRequest !== closedRequest;
  const editing = writable && (requested || localEdit);
  const directlyEditable = object.kind === 'text' || object.kind === 'note';
  const singleLine = object.kind === 'section' || object.kind === 'connector';
  const editorLabel = object.kind === 'connector' ? '连接线文字' : '编辑文字';

  function applyDraft(value: TextDraft | undefined) {
    latestDraft.current = value;
    setDraft(value);
  }

  function handleCloseEditor() {
    applyDraft(undefined);
    setLocalEdit(false);
    setClosedRequest(editRequest);
    setFailure(undefined);
  }

  function handleTextChange(text: string) {
    const current = latestDraft.current;
    const base = current?.base ?? source;
    if (base) {
      applyDraft(text === base.body.text ? undefined : { base, text });
    }
    if (current && text !== current.text) {
      setFailure(undefined);
    }
  }

  async function save(adjacent: boolean) {
    if (!writable || !source || writeInFlight.current) {
      return;
    }

    const active = latestDraft.current;
    if (!active && !adjacent) {
      handleCloseEditor();
      return;
    }

    const base = active?.base ?? source;
    const text = active?.text ?? base.body.text;
    writeInFlight.current = true;
    setSaving(true);
    setFailure(undefined);
    try {
      const receipt = await request({
        name: commitName,
        expectedVersion: base.version,
        value: { text, adjacent },
      });

      if (!receipt.ok) {
        const current = readTextSource(receipt.current, source.body.text);
        if (current) {
          setReceiptSource(current);
        }

        setFailure({ message: receipt.message || saveFailureMessage, adjacent });
        return;
      }

      const confirmed = readTextSource(receipt.payload, text);
      if (!confirmed || confirmed.version < base.version) {
        setFailure({ message: '保存回执缺少可用的文字版本', adjacent });
        return;
      }

      setReceiptSource(confirmed);
      handleCloseEditor();
    } finally {
      writeInFlight.current = false;
      setSaving(false);
    }
  }

  function sendSave(adjacent: boolean) {
    save(adjacent).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : saveFailureMessage;
      setFailure({ message, adjacent });
    });
  }

  function handleCommit(adjacent?: boolean) {
    if (!failure) {
      sendSave(adjacent === true);
    }
  }

  if (content != null && !payload) {
    return content;
  }

  const canRequestDirectly = writable && directlyEditable;

  return (
    <div className="studio-ui-canvas-text-body">
      <TextObject
        text={draft?.text ?? body.text}
        label={editorLabel}
        editing={editing}
        readOnly={!writable || saving}
        singleLine={singleLine}
        color={body.color}
        fontFamily={body.fontFamily}
        fontSize={body.fontSize}
        align={body.align}
        onTextChange={handleTextChange}
        onCommit={handleCommit}
        onRequestEdit={canRequestDirectly ? () => setLocalEdit(true) : undefined}
      />
      {saving && <StatusText message="正在保存文字" busy announcement="polite" />}
      {failure && (
        <div className="studio-ui-canvas-text-failure" data-canvas-native="">
          <StatusText message={failure.message} tone="error" announcement="assertive" />
          {writable && (
            <>
              <Button label="重试保存文字" onActivate={() => sendSave(failure.adjacent)} />
              <Button label="放弃文字修改" variant="ghost" onActivate={handleCloseEditor} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

const labelCapabilities: CanvasObjectExtension['capabilities'] = {
  content: 'passive',
  move: true,
  resize: true,
  rotate: true,
  connect: true,
};

export const textExtension: CanvasObjectExtension = {
  kind: 'text',
  capabilities: labelCapabilities,
  placement: { kind: 'text', label: '文本', width: 210, height: 85 },
  View: CanvasTextView,
};

export const noteExtension: CanvasObjectExtension = {
  kind: 'note',
  capabilities: labelCapabilities,
  placement: { kind: 'note', label: '便签', width: 140, height: 116 },
  portClick: 'place',
  View: CanvasTextView,
};

export const shapeExtension: CanvasObjectExtension = {
  kind: 'shape',
  capabilities: labelCapabilities,
  placement: { kind: 'shape', shape: 'rounded', label: '形状', width: 144, height: 100 },
  portClick: 'connect',
  View: CanvasTextView,
};

export const sectionExtension: CanvasObjectExtension = {
  kind: 'section',
  capabilities: { ...labelCapabilities, rotate: false },
  blocksPlacement: false,
  placement: { kind: 'section', label: '分区', transparent: true, width: 268, height: 170 },
  View: CanvasTextView,
};

export const connectorExtension: CanvasObjectExtension = {
  kind: 'connector',
  capabilities: { ...labelCapabilities, resize: false, rotate: false, connect: false },
  blocksPlacement: false,
  View: CanvasTextView,
};
