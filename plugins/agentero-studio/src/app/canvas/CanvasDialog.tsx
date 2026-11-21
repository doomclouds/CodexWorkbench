import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { X } from 'lucide-react';
import type { BoardElement } from '../../contracts/studio.js';
import { registerEscapeLayer } from '../shared/escape.js';
import { makeElement, safeHttpLink, tableRows } from './canvas-model.js';

export interface CanvasDialogSpec {
  type: 'html' | 'table' | 'link' | 'sticker';
  element?: BoardElement;
}

interface CanvasDialogProps {
  dialog: CanvasDialogSpec;
  onClose: () => void;
  onSave: (data: Partial<BoardElement>) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}

const fields = {
  html: {
    title: '添加 HTML 图解',
    heading: '添加 HTML 图解',
    valueLabel: '粘贴 HTML 源码',
    defaultTitle: 'HTML 图解',
    placeholder: '<!doctype html>\n<html>…</html>',
  },
  table: {
    title: '编辑表格',
    heading: '表格内容',
    valueLabel: '每行一条记录，列之间用 Tab 分隔（可从电子表格粘贴）',
    defaultTitle: '',
    placeholder: '',
  },
  link: {
    title: '添加链接',
    heading: '链接',
    valueLabel: '网页地址',
    defaultTitle: '链接',
    placeholder: 'https://',
  },
  sticker: {
    title: '添加贴纸',
    heading: '贴纸',
    valueLabel: '符号或简短文字',
    defaultTitle: '',
    placeholder: '★',
  },
};

function originalValue({ type, element }: CanvasDialogSpec): string {
  switch (type) {
    case 'html':
      return element?.html ?? '';
    case 'table':
      return tableRows(element ?? makeElement('table', { x: 0, y: 0 }))
        .map((row) => row.join('\t'))
        .join('\n');
    case 'link':
      return element?.href ?? '';
    case 'sticker':
      return element?.text ?? '★';
  }
}

function changesFor(
  { type, element }: CanvasDialogSpec,
  title: string,
  value: string,
): Partial<BoardElement> {
  switch (type) {
    case 'html':
      return { html: value, text: title || fields.html.defaultTitle };
    case 'table':
      return { data: { ...element?.data, rows: value.split('\n').map((row) => row.split('\t')) } };
    case 'link':
      return { href: value, text: title || new URL(value).hostname };
    case 'sticker':
      return { text: value.slice(0, 12) };
  }
}

export default function CanvasDialog({
  dialog,
  onClose,
  onSave,
  onDirtyChange,
}: CanvasDialogProps) {
  const modal = useRef<HTMLElement>(null);
  const copy = fields[dialog.type];
  const [title, setTitle] = useState(dialog.element?.text ?? copy.defaultTitle);
  const [value, setValue] = useState(() =>
    dialog.type === 'sticker' ? '★' : originalValue(dialog),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isHtml = dialog.type === 'html';
  const isLink = dialog.type === 'link';
  const usesInput = isLink || dialog.type === 'sticker';
  const valid = isLink ? Boolean(safeHttpLink(value)) : Boolean(value.trim());
  const canEditTitle = isHtml || isLink;
  const dirtyTitle = canEditTitle && title !== (dialog.element?.text ?? '');
  const dirty = !dialog.element || value !== originalValue(dialog) || dirtyTitle;
  const escape = useEffectEvent(() => {
    if (!busy) {
      onClose();
    }
  });
  useEffect(() => registerEscapeLayer(modal.current!, () => escape(), 20), []);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave(changesFor(dialog, title, value));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '未能保存到白板，请重试。');
    } finally {
      setBusy(false);
    }
  };
  const handleSave = () => {
    if (valid && !busy) {
      save().catch((failure) => setError(String(failure)));
    }
  };
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSave();
    }
  };
  const handleBackdropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="studio-canvas-modal-backdrop"
      data-native-interactive="true"
      onPointerDown={handleBackdropPointerDown}
    >
      <section
        ref={modal}
        className={`studio-canvas-modal${isHtml ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={copy.title}
      >
        <header>
          <h2>{copy.heading}</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        {canEditTitle && (
          <label>
            名称
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
        )}
        <label>
          {copy.valueLabel}
          {usesInput ? (
            <input
              autoFocus
              value={value}
              placeholder={copy.placeholder}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={handleInputKeyDown}
            />
          ) : (
            <textarea
              className={isHtml ? 'studio-html-source-input' : ''}
              autoFocus
              rows={isHtml ? 14 : 8}
              value={value}
              placeholder={copy.placeholder}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </label>
        {isHtml && <p>图解在独立区域显示；通过批注让 Codex 修改，原始源码会随白板保存。</p>}
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="studio-primary"
            disabled={!valid || busy}
            onClick={handleSave}
          >
            {busy ? '正在保存…' : '保存到白板'}
          </button>
        </footer>
      </section>
    </div>
  );
}
