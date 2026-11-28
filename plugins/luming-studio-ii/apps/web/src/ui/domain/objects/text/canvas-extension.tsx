import { useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Button, StatusText } from '../../../base/index.js';
import type {
  CanvasObjectExtension,
  CanvasObjectPayload,
  CanvasObjectViewProps,
} from '../../canvas/index.js';
import { TextObject } from './TextObject.js';
import type { TextObjectProps } from './TextObject.js';
import { useTextAutosave } from './use-text-autosave.js';

type TextBody = Pick<
  TextObjectProps,
  'text' | 'color' | 'fontFamily' | 'fontSize' | 'align' | 'bold' | 'italic'
>;

interface TextSource {
  version: number;
  body: TextBody;
}

interface TextDraft {
  base: TextSource;
  text: string;
}

interface SaveFailure {
  readonly message: string;
  readonly attempt: TextCommit;
  readonly finish?: FinishMode;
  readonly conflict?: true;
  readonly noticeRoot: HTMLElement | null;
}

type FinishMode = 'close' | 'adjacent';
type SaveMode = 'autosave' | FinishMode;
type TextKind = CanvasObjectViewProps['object']['kind'];

interface TextCommit extends TextDraft {
  readonly mode: SaveMode;
  readonly close: boolean;
  readonly adjacent: boolean;
  readonly clearsText: boolean;
}

interface SaveOptions {
  readonly confirmed?: TextSource;
  readonly retry?: SaveFailure;
}

const commitName = 'text.commit';
const defaultTextLabel = '文本';
const saveFailureMessage = '无法保存文字';
const adjacentTextKinds = new Set<TextKind>(['text', 'note', 'shape', 'section']);

function textCommit(mode: SaveMode, base: TextSource, text: string, kind: TextKind): TextCommit {
  const close = mode !== 'autosave';
  const clearsText = close && kind === 'text' && !text.trim();

  return { mode, base, text, close, clearsText, adjacent: mode === 'adjacent' && !clearsText };
}

function readTextBody(value: unknown, fallback: string): TextBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { text: fallback };
  }

  const { text, color, fontFamily, fontSize, align, bold, italic } = value as Record<
    string,
    unknown
  >;
  const validSize = typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize > 0;
  const validAlignment = align === 'left' || align === 'center' || align === 'right';

  return {
    text: typeof text === 'string' ? text : fallback,
    color: typeof color === 'string' ? color : undefined,
    fontFamily: typeof fontFamily === 'string' ? fontFamily : undefined,
    fontSize: validSize ? fontSize : undefined,
    align: validAlignment ? align : undefined,
    bold: bold === true,
    italic: italic === true,
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

function canWriteText(id: string | undefined, readOnly: boolean, source: TextSource | undefined) {
  return Boolean(id) && !readOnly && Boolean(source);
}

function useTextRetention(
  editing: boolean,
  draft: TextDraft | undefined,
  failure: SaveFailure | undefined,
  saving: boolean,
  onRetentionChange: CanvasObjectViewProps['onRetentionChange'],
) {
  const retained = editing || saving || Boolean(draft ?? failure);
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

interface TextSaveNoticeProps {
  readonly failure?: SaveFailure;
  readonly selected: boolean;
  readonly writable: boolean;
  readonly onRetry: () => void;
  readonly onDiscard: () => void;
}

function TextSaveNotice({ failure, selected, writable, onRetry, onDiscard }: TextSaveNoticeProps) {
  if (!failure || !selected) {
    return null;
  }

  const notice = (
    <div className="studio-ui-canvas-text-failure" data-canvas-native="" data-canvas-controls="">
      <StatusText message={failure.message} tone="error" announcement="assertive" />
      {writable && !failure.conflict && <Button label="重试保存文字" onActivate={onRetry} />}
      {writable && (
        <Button label="放弃文字修改" variant="ghost" tone="danger" onActivate={onDiscard} />
      )}
    </div>
  );

  return failure.noticeRoot ? createPortal(notice, failure.noticeRoot) : notice;
}

interface TextPaintStyle extends CSSProperties {
  '--studio-ui-text-link'?: string;
}

function linearChannel(hex: string) {
  const channel = parseInt(hex, 16) / 255;

  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function textPaintStyle({
  kind,
  hollow,
  fill,
}: CanvasObjectViewProps['object']): TextPaintStyle | undefined {
  if (hollow || (kind !== 'shape' && kind !== 'note')) {
    return undefined;
  }

  const background = fill ?? (kind === 'note' ? '#fff0b5' : '');
  const hex =
    /^#([\da-f]{6})(?:ff)?$/iu.exec(background)?.[1] ??
    /^#([\da-f]{3})$/iu.exec(background)?.[1]?.replace(/./gu, '$&$&');

  if (!hex) {
    return undefined;
  }

  const luminance =
    0.2126 * linearChannel(hex.slice(0, 2)) +
    0.7152 * linearChannel(hex.slice(2, 4)) +
    0.0722 * linearChannel(hex.slice(4));

  return {
    color: luminance >= 0.179 ? '#111827' : '#f5f5f5',
    '--studio-ui-text-link': luminance >= 0.22 ? '#14356e' : '#bcd8ff',
  };
}

function automaticText(draft: TextDraft | undefined, kind: TextKind, allowed: boolean) {
  if (!allowed || !draft) {
    return undefined;
  }

  return kind === 'text' && !draft.text.trim() ? undefined : draft.text;
}

function activeRequest(sequence: number | undefined, closed: number | undefined) {
  return sequence !== undefined && sequence !== closed;
}

function editorControls(kind: TextKind, selected: boolean, canMutate: boolean) {
  return {
    writable: selected && canMutate,
    directlyEditable: kind === 'text' || kind === 'note',
    singleLine: kind === 'section' || kind === 'connector',
    label: kind === 'connector' ? '连接线文字' : '编辑文字',
  };
}

function removedText(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return 'removed' in value && value.removed === true;
}

function confirmedText(
  receipt: Awaited<ReturnType<CanvasObjectViewProps['request']>>,
  { base, text, clearsText }: TextCommit,
) {
  if (!receipt.ok) {
    return {
      kind: 'failed' as const,
      message: receipt.message || saveFailureMessage,
      current: readTextSource(receipt.current, base.body.text),
      conflict: receipt.conflict,
    };
  }

  if (removedText(receipt.payload.value)) {
    if (clearsText && receipt.payload.version === base.version) {
      return { kind: 'removed' as const };
    }

    return { kind: 'failed' as const, message: '删除回执与原始文字版本不一致。' };
  }

  const source = readTextSource(receipt.payload, text);
  if (!source || source.version < base.version) {
    return { kind: 'failed' as const, message: '保存回执缺少可用的文字版本' };
  }

  return { kind: 'saved' as const, source };
}

function canvasLabelState(
  {
    object,
    geometry,
    zoom,
    expanded,
    focusedReading,
  }: Pick<CanvasObjectViewProps, 'object' | 'geometry' | 'zoom' | 'expanded' | 'focusedReading'>,
  fontSize: number | undefined,
  { editing, saving, failure }: { editing: boolean; saving?: SaveMode; failure?: SaveFailure },
) {
  if (editing || saving !== undefined || failure !== undefined) {
    return 'active';
  }
  if (object.kind !== 'shape' || expanded || focusedReading) {
    return;
  }

  const boxFits = geometry.width * zoom >= 32 && geometry.height * zoom >= 12;
  if (!boxFits || (fontSize ?? 16) * zoom < 8) {
    return 'concealed';
  }
}

function CanvasTextBody({
  id,
  object,
  geometry,
  zoom,
  payload,
  selected,
  expanded,
  focusedReading,
  readOnly,
  editRequest,
  formatRequest,
  request,
  content,
  onRetentionChange,
}: CanvasObjectViewProps) {
  const [receiptSource, setReceiptSource] = useState<TextSource>();
  const [draft, setDraft] = useState<TextDraft>();
  const [localEdit, setLocalEdit] = useState(false);
  const [closedRequest, setClosedRequest] = useState<number>();
  const [closedFormatRequest, setClosedFormatRequest] = useState<number>();
  const [failure, setFailure] = useState<SaveFailure>();
  const [saving, setSaving] = useState<SaveMode>();
  const frame = useRef<HTMLDivElement>(null);
  const latestDraft = useRef<TextDraft | undefined>(undefined);
  const writeInFlight = useRef<SaveMode | undefined>(undefined);
  const pendingFinish = useRef<FinishMode | undefined>(undefined);
  const canWrite = useRef(false);
  const source = resolveSource(readTextSource(payload, object.label), receiptSource);
  const body = source?.body ?? { text: object.label };
  const canMutate = canWriteText(id, readOnly, source);
  const {
    directlyEditable,
    singleLine,
    label: editorLabel,
    writable,
  } = editorControls(object.kind, selected, canMutate);
  const requested = activeRequest(editRequest, closedRequest);
  const formatSequence = formatRequest?.sequence;
  const formatting = activeRequest(formatSequence, closedFormatRequest);
  const editingRequested = requested || formatting || localEdit;
  const editing = writable && editingRequested;
  useTextRetention(editing, draft, failure, saving !== undefined, onRetentionChange);
  useLayoutEffect(() => {
    canWrite.current = canMutate;
  }, [canMutate]);

  function applyDraft(value: TextDraft | undefined) {
    latestDraft.current = value;
    setDraft(value);
  }

  function handleCloseEditor() {
    applyDraft(undefined);
    setLocalEdit(false);
    setClosedRequest(editRequest);
    setClosedFormatRequest(formatSequence);
    setFailure(undefined);
  }

  function handleTextChange(text: string) {
    const writing = writeInFlight.current;
    if (writing && writing !== 'autosave') {
      return;
    }

    const current = latestDraft.current;
    const base = current?.base ?? source;
    if (base) {
      const matchesSaved = text === base.body.text && !writing;
      applyDraft(matchesSaved ? undefined : { base, text });
    }
  }

  function beginSave(mode: SaveMode, saved: TextSource | undefined, retry?: SaveFailure) {
    if (!canWrite.current || !saved) {
      return undefined;
    }

    if (writeInFlight.current) {
      if (writeInFlight.current === 'autosave' && mode !== 'autosave') {
        pendingFinish.current = pendingFinish.current === 'adjacent' ? 'adjacent' : mode;
      }

      return undefined;
    }

    if (retry) {
      pendingFinish.current = retry.finish;
      return retry.attempt;
    }

    const active = latestDraft.current;
    const attempt = textCommit(
      mode,
      active?.base ?? saved,
      active?.text ?? saved.body.text,
      object.kind,
    );
    const needsCommand = active || attempt.adjacent || attempt.clearsText;
    if (!needsCommand) {
      if (mode === 'close') {
        handleCloseEditor();
      }

      return undefined;
    }

    return attempt;
  }

  function synchronizeDraft(confirmed: TextSource, submitted: string, mode: SaveMode) {
    setReceiptSource(confirmed);
    const latest = latestDraft.current?.text;
    const editedSinceRequest = latest !== undefined && latest !== submitted;
    applyDraft(editedSinceRequest ? { base: confirmed, text: latest } : undefined);
    if (mode !== 'autosave' && !editedSinceRequest) {
      handleCloseEditor();
    }
  }

  function reportSaveFailure(message: string, attempt: TextCommit, conflict?: true) {
    const noticeRoot = frame.current?.closest<HTMLElement>('[data-canvas-root]') ?? null;
    setFailure({ message, attempt, finish: pendingFinish.current, conflict, noticeRoot });
  }

  async function save(mode: SaveMode, { confirmed = source, retry }: SaveOptions = {}) {
    const next = beginSave(mode, confirmed, retry);
    if (!next) {
      return;
    }

    const { base, text, adjacent, close } = next;
    writeInFlight.current = mode;
    setSaving(mode);
    setFailure(undefined);
    let followUp: { mode: SaveMode; source: TextSource } | undefined;
    try {
      const receipt = await request({
        name: commitName,
        expectedVersion: base.version,
        value: { text, baseText: base.body.text, adjacent, close },
      });

      const result = confirmedText(receipt, next);
      if (result.kind === 'failed') {
        if (result.current) {
          setReceiptSource(result.current);
        }

        reportSaveFailure(result.message, next, result.conflict);
        return;
      }
      if (result.kind === 'removed') {
        handleCloseEditor();
        return;
      }

      synchronizeDraft(result.source, text, mode);
      if (pendingFinish.current) {
        followUp = { mode: pendingFinish.current, source: result.source };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : saveFailureMessage;
      reportSaveFailure(message, next);
    } finally {
      writeInFlight.current = undefined;
      pendingFinish.current = undefined;
      setSaving(undefined);
    }
    if (followUp) {
      await save(followUp.mode, { confirmed: followUp.source });
    }
  }

  function sendSave(mode: SaveMode, options?: SaveOptions) {
    save(mode, options).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : saveFailureMessage;
      const active = latestDraft.current;
      const base = active?.base ?? source;
      if (base) {
        const attempt =
          options?.retry?.attempt ??
          textCommit(mode, base, active?.text ?? base.body.text, object.kind);
        reportSaveFailure(message, attempt);
      }
    });
  }

  function handleCommit(adjacent?: boolean) {
    if (!failure) {
      const addsAdjacent = adjacent && adjacentTextKinds.has(object.kind);
      sendSave(addsAdjacent ? 'adjacent' : 'close');
    }
  }

  function handleRetry() {
    if (failure && !failure.conflict) {
      sendSave(failure.attempt.mode, { retry: failure });
    }
  }

  const autosaveAllowed = editing && !saving && !failure;
  useTextAutosave(automaticText(draft, object.kind, autosaveAllowed), () => sendSave('autosave'));

  if (content != null && !payload) {
    return content;
  }

  const canRequestDirectly = writable && directlyEditable;
  const finishing = saving !== undefined && saving !== 'autosave';
  const captionState = canvasLabelState(
    { object, geometry, zoom, expanded, focusedReading },
    body.fontSize,
    { editing, saving, failure },
  );

  return (
    <div
      ref={frame}
      className="studio-ui-canvas-text-body"
      data-canvas-label-state={captionState}
      style={textPaintStyle(object)}
    >
      <div inert={finishing}>
        <TextObject
          text={draft?.text ?? body.text}
          label={editorLabel}
          editing={editing}
          readOnly={!writable}
          singleLine={singleLine}
          color={body.color}
          fontFamily={body.fontFamily}
          fontSize={body.fontSize}
          align={body.align}
          bold={body.bold}
          italic={body.italic}
          formatRequest={formatting ? formatRequest : undefined}
          onTextChange={handleTextChange}
          onCommit={handleCommit}
          onRequestEdit={canRequestDirectly ? () => setLocalEdit(true) : undefined}
        />
      </div>
      <TextSaveNotice
        failure={failure}
        selected={selected}
        writable={writable}
        onRetry={handleRetry}
        onDiscard={handleCloseEditor}
      />
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

const richLabelCapabilities: CanvasObjectExtension['capabilities'] = {
  ...labelCapabilities,
  inlineFormats: ['link', 'bullets'],
};

function CanvasTextView(props: CanvasObjectViewProps) {
  const { id, object, geometry, zoom } = props;
  const newText = id === undefined && object.kind === 'text';
  if (newText && object.label === defaultTextLabel && zoom < 0.5) {
    return (
      <span
        className="studio-ui-canvas-text-placement"
        aria-hidden="true"
        style={{ height: Math.min(2 / zoom, geometry.height / 3) }}
      />
    );
  }

  return <CanvasTextBody {...props} />;
}

export const textExtension: CanvasObjectExtension = {
  kind: 'text',
  capabilities: richLabelCapabilities,
  placement: { kind: 'text', label: defaultTextLabel, width: 300, height: 70, fill: 'transparent' },
  View: CanvasTextView,
};

export const noteExtension: CanvasObjectExtension = {
  kind: 'note',
  capabilities: richLabelCapabilities,
  placement: { kind: 'note', label: '便签', width: 208, height: 184, fill: '#F9E56F' },
  portClick: 'place',
  View: CanvasTextView,
};

export const shapeExtension: CanvasObjectExtension = {
  kind: 'shape',
  capabilities: richLabelCapabilities,
  placement: {
    kind: 'shape',
    shape: 'rounded',
    label: '形状',
    width: 208,
    height: 112,
    fill: '#EFEFEF',
    stroke: 'transparent',
  },
  portClick: 'connect',
  View: CanvasTextView,
};

export const sectionExtension: CanvasObjectExtension = {
  kind: 'section',
  capabilities: { ...richLabelCapabilities, rotate: false },
  blocksPlacement: false,
  placement: {
    kind: 'section',
    label: '分区',
    width: 600,
    height: 360,
    fill: '#EFEFEF',
    stroke: '#9ca3af',
  },
  View: CanvasTextView,
};

export const connectorExtension: CanvasObjectExtension = {
  kind: 'connector',
  capabilities: { ...richLabelCapabilities, resize: false, connect: false },
  blocksPlacement: false,
  View: CanvasTextView,
};
