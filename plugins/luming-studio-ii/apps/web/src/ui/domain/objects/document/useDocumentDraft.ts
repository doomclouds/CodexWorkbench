import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type {
  DocumentCommitResult,
  DocumentDraft,
  DocumentObjectProps,
  DocumentValue,
} from './contracts.js';
import { sameDraft } from './model.js';

interface DraftState {
  readonly input: DocumentValue;
  readonly confirmed: DocumentValue;
  readonly base: DocumentValue;
  readonly draft: DocumentDraft;
  readonly saving: boolean;
  readonly failure?: string;
}

type DraftOptions = Pick<DocumentObjectProps, 'value' | 'onChange' | 'onCommit'> & {
  readonly readOnly: boolean;
  readonly composing: boolean;
};

const saveDelayMs = 650;
const genericError = '文档保存失败，请重试。';

function initialize(value: DocumentValue): DraftState {
  return { input: value, confirmed: value, base: value, draft: value, saving: false };
}

function dirty(state: DraftState) {
  return !sameDraft(state.base, state.draft);
}

function mergeInput(state: DraftState, value: DocumentValue): DraftState {
  const fresh = value.version >= state.confirmed.version ? value : state.confirmed;
  const next = { ...state, input: value, confirmed: fresh };
  if (!dirty(state)) {
    return { ...next, base: fresh, draft: fresh };
  }
  if (sameDraft(state.base, fresh)) {
    return { ...next, base: fresh };
  }

  return next;
}

function mergeCommit(
  state: DraftState,
  submitted: DocumentDraft,
  result: DocumentCommitResult,
): DraftState {
  if (!result.ok) {
    const current = result.current;
    const confirmed =
      current && current.version >= state.confirmed.version ? current : state.confirmed;

    return { ...state, saving: false, confirmed, failure: result.message || genericError };
  }

  const value = result.value;
  const confirmed = value.version >= state.confirmed.version ? value : state.confirmed;
  const next = { ...state, saving: false, confirmed, failure: undefined };
  if (sameDraft(state.draft, submitted)) {
    return { ...next, base: confirmed, draft: confirmed };
  }
  if (sameDraft(submitted, value)) {
    return { ...next, base: value };
  }

  return next;
}

export function useDocumentDraft(options: DraftOptions) {
  const { value, readOnly, composing, onCommit, onChange } = options;
  const [state, setState] = useState(() => initialize(value));
  const latest = useRef(state);
  const capabilities = useRef({ readOnly, composing, onCommit, onChange });
  const activeSave = useRef<Promise<boolean> | undefined>(undefined);
  const mounted = useRef(false);

  if (state.input !== value) {
    setState(mergeInput(state, value));
  }

  useLayoutEffect(() => {
    latest.current = state;
  }, [state]);
  useLayoutEffect(() => {
    capabilities.current = { readOnly, composing, onCommit, onChange };
  }, [readOnly, composing, onCommit, onChange]);
  useLayoutEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  function update(next: DraftState) {
    latest.current = next;
    if (mounted.current) {
      setState(next);
    }
  }

  function reportFailure(error: unknown) {
    const failure = error instanceof Error ? error.message : genericError;
    update({ ...latest.current, saving: false, failure });
  }

  function change(patch: Partial<DocumentDraft>) {
    const current = latest.current;
    const draft = { ...current.draft, ...patch };
    if (sameDraft(current.draft, draft)) {
      return;
    }

    update({ ...current, draft });
    capabilities.current.onChange?.(draft);
  }

  async function submit(
    callback: NonNullable<DraftOptions['onCommit']>,
    snapshot: DraftState,
    overwrite: boolean,
  ) {
    const source = overwrite ? snapshot.confirmed : snapshot.base;
    const { title, document } = snapshot.draft;
    const draft = { title, document };
    update({ ...snapshot, saving: true, failure: undefined });

    let result: DocumentCommitResult;
    try {
      result = await callback({ ...draft, expectedVersion: source.version, overwrite });
    } catch (error) {
      const message = error instanceof Error ? error.message : genericError;
      result = { ok: false, message };
    }

    update(mergeCommit(latest.current, draft, result));

    return result.ok;
  }

  function save(overwrite = false): Promise<boolean> {
    if (activeSave.current) {
      return activeSave.current;
    }

    const current = latest.current;
    const controls = capabilities.current;
    if (!dirty(current) || !controls.onCommit) {
      return Promise.resolve(true);
    }
    if (controls.readOnly || controls.composing) {
      return Promise.resolve(false);
    }

    const pending = submit(controls.onCommit, current, overwrite).finally(() => {
      activeSave.current = undefined;
    });
    activeSave.current = pending;

    return pending;
  }

  async function prepareExit() {
    while (capabilities.current.onCommit && dirty(latest.current)) {
      const accepted = await save();
      if (!accepted) {
        return false;
      }
    }

    return true;
  }

  async function prepareExport(): Promise<DocumentDraft | undefined> {
    if (capabilities.current.readOnly) {
      return latest.current.confirmed;
    }
    if (capabilities.current.composing || !(await prepareExit())) {
      return undefined;
    }

    return capabilities.current.onCommit ? latest.current.confirmed : latest.current.draft;
  }

  function useCurrent() {
    const current = latest.current;
    const value = current.confirmed;
    update({ ...current, base: value, draft: value, failure: undefined });
    capabilities.current.onChange?.(value);
  }

  const modified = dirty(state);
  const autosave = useEffectEvent(() => {
    save().catch(reportFailure);
  });
  const saveScheduled = Boolean(onCommit) && modified && !readOnly;
  const saveWaiting = state.saving || Boolean(state.failure) || composing;
  const saveAutomatically = saveScheduled && !saveWaiting;
  useEffect(() => {
    if (!saveAutomatically) {
      return;
    }

    const timer = setTimeout(() => autosave(), saveDelayMs);

    return () => clearTimeout(timer);
  }, [saveAutomatically, state.draft]);

  return {
    draft: state.draft,
    confirmed: state.confirmed,
    dirty: modified,
    saving: state.saving,
    failure: state.failure,
    change,
    save,
    prepareExit,
    prepareExport,
    useCurrent,
    reportFailure,
  };
}
