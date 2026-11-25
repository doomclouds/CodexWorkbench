import { useLayoutEffect, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { TextField } from '../../../base/index.js';
import type { TextFieldHandle } from '../../../base/index.js';
import { maxTodoTextBytes, maxTodoTitleLength } from './todo-edit.js';
import type { TodoEditorSession } from './useTodoEditor.js';

interface TodoTextEditorProps {
  label: string;
  session: TodoEditorSession;
}

function plainKey(event: KeyboardEvent) {
  return !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

export function TodoTextEditor({ label, session }: TodoTextEditorProps) {
  const input = useRef<TextFieldHandle>(null);
  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.key === 'Process') {
      return;
    }

    if (event.key === 'Enter' && plainKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      session.commit(true);
    } else if (event.key === 'Escape' && !session.pending) {
      event.preventDefault();
      event.stopPropagation();
      session.cancel();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (session.draft?.target.kind !== 'new') {
      return;
    }

    const field = event.target;
    const Input = event.currentTarget.ownerDocument.defaultView?.HTMLInputElement;
    if (!Input || !(field instanceof Input)) {
      return;
    }

    const pasted = event.clipboardData.getData('text/plain');
    if (!/[\r\n]/u.test(pasted)) {
      return;
    }

    const before = field.value.slice(0, field.selectionStart ?? 0);
    const after = field.value.slice(field.selectionEnd ?? field.value.length);
    if (session.paste(before + pasted + after)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  const title = session.draft?.target.kind === 'title';
  const maximum = title ? maxTodoTitleLength : maxTodoTextBytes;
  const text = session.draft?.text ?? '';

  return (
    <div
      className="studio-object-todo__editor"
      onKeyDown={handleKey}
      onPaste={handlePaste}
      onFocus={() => session.trackFocus(true)}
      onBlur={() => {
        session.trackFocus(false);
        session.commit();
      }}
    >
      <TextField
        label={label}
        value={text}
        readOnly={!session.writable}
        onValueChange={(value) => session.setText(value.slice(0, maximum))}
        ref={input}
      />
    </div>
  );
}
