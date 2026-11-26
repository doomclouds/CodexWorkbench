import { useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../../base/index.js';
import type { ButtonHandle } from '../../../base/index.js';
import type { EmbedObjectProps, EmbedObjectValue, EmbedSourceDraft } from './contracts.js';
import { HtmlSourceDialog } from './HtmlSourceDialog.js';

interface EmbedSourceEditorProps {
  readonly value: EmbedObjectValue;
  readonly interactive: boolean;
  readonly editRequest?: number;
  readonly useCanvasTools?: boolean;
  readonly readHtmlSource?: EmbedObjectProps['readHtmlSource'];
  readonly onSave: EmbedObjectProps['onSaveSource'];
  readonly onEditingChange: (editing: boolean) => void;
}

interface EmbedSourceSession {
  readonly draft: EmbedSourceDraft;
  readonly sourceRevision: number;
}

function sourceSession(value: EmbedObjectValue): EmbedSourceSession {
  return {
    draft: { title: value.title ?? '', html: value.html ?? '' },
    sourceRevision: value.sourceRevision ?? value.version,
  };
}

export function EmbedSourceEditor({
  value,
  interactive,
  editRequest,
  useCanvasTools,
  readHtmlSource,
  onSave,
  onEditingChange,
}: EmbedSourceEditorProps) {
  const [session, setSession] = useState<EmbedSourceSession | null>(null);
  const [seenRequest, setSeenRequest] = useState<number>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const opener = useRef<ButtonHandle>(null);
  const pending = useRef(false);
  const editing = session !== null;
  const publishEditing = useEffectEvent(onEditingChange);

  if (seenRequest !== editRequest) {
    setSeenRequest(editRequest);
    if (!session && onSave && editRequest !== undefined) {
      setError('');
      setSession(sourceSession(value));
    }
  }

  useLayoutEffect(() => {
    if (editing) {
      publishEditing(true);

      return () => publishEditing(false);
    }
  }, [editing]);

  function handleOpen() {
    setError('');
    setSession(sourceSession(value));
  }

  function handleClose() {
    if (!pending.current) {
      setSession(null);
    }
  }

  function handleUpdateDraft(draft: EmbedSourceDraft) {
    if (session) {
      setSession({ ...session, draft });
    }
  }

  function handleSave() {
    if (!session || !onSave || pending.current) {
      return;
    }

    pending.current = true;
    setSaving(true);
    setError('');
    Promise.resolve()
      .then(() => onSave(session.draft, session.sourceRevision))
      .then(() => setSession(null))
      .finally(() => {
        pending.current = false;
        setSaving(false);
      })
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : '保存 HTML 源码失败。'),
      );
  }

  return (
    <>
      {!useCanvasTools && interactive && onSave && (
        <div className="studio-ui-embed__source-tools">
          <Button ref={opener} label="编辑 HTML 源码" variant="ghost" onActivate={handleOpen} />
        </div>
      )}
      {session && (
        <HtmlSourceDialog
          mode="edit"
          draft={session.draft}
          saving={saving}
          disabled={!onSave}
          error={error}
          readHtmlSource={readHtmlSource}
          onChange={handleUpdateDraft}
          onClose={handleClose}
          onSave={handleSave}
          onRestoreFocus={() => opener.current?.focus()}
        />
      )}
    </>
  );
}
