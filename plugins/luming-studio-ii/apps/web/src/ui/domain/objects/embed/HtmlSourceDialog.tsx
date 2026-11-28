import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, StatusText, TextArea, TextField } from '../../../base/index.js';
import type { TextAreaHandle } from '../../../base/index.js';
import type { EmbedSourceDraft } from './contracts.js';
import './EmbedObject.css';

export interface HtmlSourceDialogProps {
  readonly mode: 'create' | 'edit';
  readonly draft: EmbedSourceDraft;
  readonly saving: boolean;
  readonly disabled?: boolean;
  readonly retryOriginal?: boolean;
  readonly error?: string;
  readonly readHtmlSource?: (file: File) => Promise<string>;
  readonly onChange: (next: EmbedSourceDraft) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
  readonly onRestoreFocus?: () => void;
}

function FileIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 22h12a2 2 0 0 0 2-2V8l-6-6H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2Zm8-20v6h6M10 12l-2 2 2 2m4 0 2-2-2-2" />
    </svg>
  );
}

export function HtmlSourceDialog({
  mode,
  draft,
  saving,
  disabled,
  retryOriginal,
  error,
  readHtmlSource,
  onChange,
  onClose,
  onSave,
  onRestoreFocus,
}: HtmlSourceDialogProps) {
  const input = useRef<HTMLInputElement>(null);
  const editor = useRef<TextAreaHandle>(null);
  const generation = useRef(0);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const blocked = Boolean(saving || disabled || reading);
  const fieldsLocked = blocked || retryOriginal;
  const editing = mode === 'edit';
  const saveLabel = editing ? '保存源码' : '添加到白板';
  const failure = readError || error;

  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  async function loadFile(file: File) {
    if (fieldsLocked || !readHtmlSource) {
      return;
    }

    const epoch = ++generation.current;
    setReading(true);
    setReadError('');

    try {
      const html = await readHtmlSource(file);
      if (epoch === generation.current) {
        const title = editing ? draft.title : file.name.replace(/\.html?$/iu, '');
        onChange({ title, html });
      }
    } catch (failure) {
      if (epoch === generation.current) {
        setReadError(failure instanceof Error ? failure.message : '读取 HTML 文件失败。');
      }
    } finally {
      if (epoch === generation.current) {
        setReading(false);
      }
    }
  }

  function handleClose() {
    if (!saving) {
      onClose();
    }
  }

  function handleTitle(title: string) {
    onChange({ ...draft, title });
  }

  function handleHtml(html: string) {
    setReadError('');
    onChange({ ...draft, html });
  }

  return (
    <Dialog
      open
      title={editing ? '编辑 HTML 源码' : '导入 HTML 图解'}
      closeLabel="关闭 HTML 源码编辑器"
      initialFocus={() => editor.current?.focus()}
      restoreFocus={onRestoreFocus}
      dismissPolicy={{ escape: !saving }}
      onRequestClose={handleClose}
    >
      <form
        className="studio-ui-embed__source-editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocked && draft.html.trim()) {
            onSave();
          }
        }}
      >
        <div className="studio-ui-embed__source-heading">
          <TextField
            label="HTML 区域名称"
            value={draft.title}
            onValueChange={handleTitle}
            disabled={fieldsLocked}
          />
          {readHtmlSource && (
            <>
              <Button
                label="选择 HTML 文件"
                icon={<FileIcon />}
                busy={reading}
                disabled={fieldsLocked}
                onActivate={() => input.current?.click()}
              />
              <input
                ref={input}
                type="file"
                accept=".html,.htm,text/html"
                aria-label="选择 HTML 文件"
                disabled={fieldsLocked}
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';

                  if (file) {
                    loadFile(file).catch((failure: unknown) =>
                      setReadError(
                        failure instanceof Error ? failure.message : '读取 HTML 文件失败。',
                      ),
                    );
                  }
                }}
              />
            </>
          )}
        </div>
        <TextArea
          ref={editor}
          label="HTML 源码"
          placeholder="粘贴完整 HTML 或选择文件…"
          value={draft.html}
          onValueChange={handleHtml}
          rows={14}
          spellCheck={false}
          disabled={fieldsLocked}
        />
        {failure && <StatusText message={failure} tone="error" announcement="assertive" />}
        <p className="studio-ui-embed__source-note">
          HTML 会作为独立区域显示在白板上，保留自己的样式。
        </p>
        <div className="studio-ui-embed__source-actions">
          <Button label="取消" disabled={saving} onActivate={handleClose} />
          <Button
            label={retryOriginal ? '重试原保存' : saveLabel}
            variant="primary"
            type="submit"
            disabled={blocked || !draft.html.trim()}
            busy={saving}
          />
        </div>
      </form>
    </Dialog>
  );
}
