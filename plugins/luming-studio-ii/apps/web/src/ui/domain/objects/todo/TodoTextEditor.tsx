import { useLayoutEffect, useRef } from 'react';
import type { ClipboardEvent, KeyboardEvent } from 'react';
import { maxTodoTextBytes, maxTodoTitleLength } from './todo-edit.js';
import type { TodoEditorSession } from './useTodoEditor.js';

interface TodoTextEditorProps {
  label: string;
  session: TodoEditorSession;
  paused?: boolean;
}

function plainKey(event: KeyboardEvent) {
  return !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

export function TodoTextEditor({ label, session, paused }: TodoTextEditorProps) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    if (paused || event.nativeEvent.isComposing || event.key === 'Process') {
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

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    if (session.draft?.target.kind !== 'new') {
      return;
    }

    const field = event.currentTarget;
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
  const adding = session.draft?.target.kind === 'new';
  const maximum = title ? maxTodoTitleLength : maxTodoTextBytes;
  const text = session.draft?.text ?? '';

  return (
    <input
      ref={input}
      type="text"
      className="studio-object-todo__editor"
      aria-label={label}
      placeholder={adding ? '输入任务' : undefined}
      maxLength={maximum}
      value={text}
      readOnly={!session.writable}
      onChange={(event) => session.setText(event.currentTarget.value)}
      onKeyDown={handleKey}
      onPaste={handlePaste}
      onFocus={() => session.trackFocus(true)}
      onBlur={() => {
        session.trackFocus(false);
        session.commit();
      }}
    />
  );
}
