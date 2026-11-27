import { useRef, useState, type SubmitEvent } from 'react';
import { Button, Dialog, StatusText, TextField } from '../../../base/index.js';
import type { TextFieldHandle } from '../../../base/index.js';
import { safeHttpLink } from './LinkObject.js';

export interface LinkDraft {
  readonly title: string;
  readonly href: string;
}

interface LinkDialogProps {
  readonly initial: LinkDraft;
  readonly readOnly?: boolean;
  readonly onClose: () => void;
  readonly onSave: (draft: LinkDraft) => Promise<boolean | void>;
  readonly onRestoreFocus?: () => void;
}

const failure = '未能保存到白板，请重试。';

export function LinkDialog({
  initial,
  readOnly,
  onClose,
  onSave,
  onRestoreFocus,
}: LinkDialogProps) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const address = useRef<TextFieldHandle>(null);
  const saving = useRef(false);
  const href = safeHttpLink(draft.href);

  function showFailure(cause: unknown) {
    setError(cause instanceof Error && cause.message ? cause.message : failure);
  }

  async function submit() {
    if (saving.current || !href || readOnly) {
      return;
    }

    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const saved = await onSave({ title: draft.title.trim() || new URL(href).hostname, href });
      if (saved === false) {
        setError(failure);
      } else {
        onClose();
      }
    } catch (cause) {
      showFailure(cause);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function handleClose() {
    if (!saving.current) {
      onClose();
    }
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    submit().catch(showFailure);
  }

  return (
    <Dialog
      open
      title="链接"
      closeLabel="关闭"
      onRequestClose={handleClose}
      initialFocus={() => address.current?.focus()}
      restoreFocus={onRestoreFocus}
      dismissPolicy={{ escape: !busy, backdrop: !busy }}
    >
      <form className="luming-link-dialog" onSubmit={handleSubmit}>
        <TextField
          label="名称"
          value={draft.title}
          disabled={busy}
          readOnly={readOnly}
          onValueChange={(title) => setDraft({ ...draft, title })}
        />
        <TextField
          ref={address}
          label="网页地址"
          placeholder="https://"
          value={draft.href}
          disabled={busy}
          readOnly={readOnly}
          onValueChange={(value) => setDraft({ ...draft, href: value })}
        />
        {error && <StatusText message={error} tone="error" announcement="assertive" />}
        <div className="luming-link-dialog__actions">
          <Button label="取消" disabled={busy} onActivate={handleClose} />
          <Button
            type="submit"
            label={busy ? '正在保存…' : '保存到白板'}
            variant="primary"
            disabled={!href || readOnly}
            busy={busy}
          />
        </div>
      </form>
    </Dialog>
  );
}
