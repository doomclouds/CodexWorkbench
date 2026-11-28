import { useEffect, useState } from 'react';

type Editor = typeof import('./DocumentEditor.js').default;

let loadedEditor: Editor | undefined;
let loadingEditor: Promise<Editor> | undefined;

function loadEditor() {
  loadingEditor ??= import('./DocumentEditor.js')
    .then(({ default: editor }) => {
      loadedEditor = editor;
      return editor;
    })
    .catch((error: unknown) => {
      loadingEditor = undefined;
      throw error;
    });

  return loadingEditor;
}

export function useDocumentEditor(request: object | undefined) {
  const [editor, setEditor] = useState(() => loadedEditor);
  const [failure, setFailure] = useState<{ request: object; error: Error }>();
  const loadError = failure?.request === request ? failure?.error : undefined;
  const failed = loadError !== undefined;

  useEffect(() => {
    if (request === undefined || editor || failed) {
      return;
    }

    let current = true;
    void loadEditor().then(
      (component) => {
        if (current) {
          setEditor(() => component);
        }
      },
      (error: unknown) => {
        if (current) {
          setFailure({
            request,
            error: new Error('Document editor failed to load.', { cause: error }),
          });
        }
      },
    );

    return () => {
      current = false;
    };
  }, [request, editor, failed]);

  const loading = request !== undefined && !editor && !failed;
  const failureState = failed ? 'failed' : undefined;
  const state: 'loading' | 'failed' | undefined = loading ? 'loading' : failureState;

  return { editor, state };
}
