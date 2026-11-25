import { useRef, useState } from 'react';
import { Button, Dialog, TextArea, TextField } from '../../../base/index.js';
import type { ButtonHandle, TextAreaHandle } from '../../../base/index.js';
import type { EmbedObjectProps, EmbedObjectValue, EmbedSourceDraft } from './contracts.js';

interface EmbedSourceEditorProps {
  value: EmbedObjectValue;
  interactive: boolean;
  onSave: EmbedObjectProps['onSaveSource'];
  onEditingChange: (editing: boolean) => void;
}

interface EmbedSourceSession {
  draft: EmbedSourceDraft;
  sourceRevision: number;
}

export function EmbedSourceEditor({
  value,
  interactive,
  onSave,
  onEditingChange,
}: EmbedSourceEditorProps) {
  const [session, setSession] = useState<EmbedSourceSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const opener = useRef<ButtonHandle>(null);
  const editor = useRef<TextAreaHandle>(null);

  function handleOpen() {
    setError('');
    setSession({
      draft: { title: value.title ?? '', html: value.html ?? '' },
      sourceRevision: value.sourceRevision ?? value.version,
    });
    onEditingChange(true);
  }

  function finishEditing() {
    setSession(null);
    onEditingChange(false);
  }

  function handleClose() {
    if (!saving) {
      finishEditing();
    }
  }

  function updateDraft(field: keyof EmbedSourceDraft, content: string) {
    if (session) {
      setSession({ ...session, draft: { ...session.draft, [field]: content } });
    }
  }

  function handleSave() {
    if (!session || !onSave || saving) {
      return;
    }

    setSaving(true);
    setError('');
    Promise.resolve()
      .then(() => onSave(session.draft, session.sourceRevision))
      .then(finishEditing)
      .finally(() => setSaving(false))
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : '保存 HTML 源码失败。'),
      );
  }

  if (!session && (!interactive || !onSave)) {
    return null;
  }

  return (
    <>
      {interactive && onSave && (
        <div className="studio-ui-embed__source-tools">
          <Button ref={opener} label="编辑 HTML 源码" variant="ghost" onActivate={handleOpen} />
        </div>
      )}
      <Dialog
        open={session !== null}
        title="编辑 HTML 源码"
        closeLabel="关闭 HTML 源码编辑器"
        initialFocus={() => editor.current?.focus()}
        restoreFocus={() => opener.current?.focus()}
        onRequestClose={handleClose}
      >
        {session && (
          <div className="studio-ui-embed__source-editor">
            <TextField
              label="HTML 区域名称"
              value={session.draft.title}
              onValueChange={(text) => updateDraft('title', text)}
              disabled={saving || !onSave}
            />
            <TextArea
              ref={editor}
              label="HTML 源码"
              value={session.draft.html}
              onValueChange={(html) => updateDraft('html', html)}
              rows={14}
              disabled={saving || !onSave}
              error={error || undefined}
            />
            <Button
              label="保存 HTML 源码"
              variant="primary"
              disabled={!onSave || !session.draft.html.trim()}
              busy={saving}
              onActivate={handleSave}
            />
          </div>
        )}
      </Dialog>
    </>
  );
}
