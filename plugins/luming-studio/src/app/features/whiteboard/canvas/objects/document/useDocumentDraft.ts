import type { DraftSlot } from '../../../draft-workspace.js';
import { isBoardElementProjection } from '../../../../../../contracts/board-shape.js';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { BoardElement } from '../../../../../../contracts/studio.js';
import {
  applyDocumentOperations,
  defaultDocument,
  documentPlainText,
  documentOperations,
  normalizeDocument,
  type DocumentContent,
} from '../../../../../../contracts/document.js';
import { jsonEqual } from '../../../../../../shared/safe-merge.js';
import { copyPlainText } from '../../../../../clipboard.js';

interface SavedDraft {
  base: BoardElement;
  document: DocumentContent;
  title: string;
}

const READ_ONLY_DRAFT = '当前为只读，文档草稿已保留。';

function storageRestriction(cause: unknown) {
  if (!(cause instanceof DOMException)) {
    return '';
  }
  if (cause.name === 'SecurityError') {
    return '当前环境限制了本机存储。';
  }
  if (cause.name === 'QuotaExceededError') {
    return '本机存储空间不足。';
  }

  return '';
}

function createDraftStorage(slot: DraftSlot) {
  let warning = '';
  const listeners = new Set<() => void>();
  function publish(message: string) {
    if (warning === message) {
      return;
    }

    warning = message;
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => warning,
    getServerSnapshot: () => '',
    sync(draft: SavedDraft, dirty: boolean) {
      try {
        if (dirty) {
          slot.write(JSON.stringify(draft));
        } else {
          slot.clear();
        }

        publish('');
      } catch (cause) {
        const detail = storageRestriction(cause);
        publish('无法保存本机草稿，仍会尝试保存到白板；未确认前请复制文档草稿。' + detail);
      }
    },
  };
}

function decodeDocumentDraft(raw: string, elementId: string): SavedDraft | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const fields: Record<string, unknown> = Object.fromEntries(Object.entries(parsed));
    const { base, document, title } = fields;
    if (!isBoardElementProjection(base) || base.id !== elementId || base.type !== 'document') {
      return null;
    }
    if (typeof title !== 'string' || title.length > 200) {
      return null;
    }

    return {
      base: { ...base, document: normalizeDocument(base.document) },
      document: normalizeDocument(document),
      title,
    };
  } catch (failure) {
    if (failure instanceof Error) {
      return null;
    }

    throw failure;
  }
}

interface DocumentDraftOptions {
  element: BoardElement;
  draftSlot: DraftSlot;
  canEdit: boolean;
  composing: boolean;
  onSave(
    document: DocumentContent,
    title: string,
    source: BoardElement,
    overwrite: boolean,
  ): Promise<BoardElement | false>;
  onUseCurrent?: () => void;
}

function sameSavedText(current: BoardElement, base: BoardElement) {
  return current.text === base.text && jsonEqual(current.document, base.document);
}

function rebaseDraft(
  submitted: Pick<SavedDraft, 'document' | 'title'>,
  origin: BoardElement,
  source: BoardElement,
) {
  const intent = documentOperations(origin.document ?? defaultDocument(), submitted.document);
  const currentDocument = source.document ?? defaultDocument();

  return {
    document: intent.length ? applyDocumentOperations(currentDocument, intent) : currentDocument,
    title: submitted.title === (origin.text || '文档') ? (source.text ?? '文档') : submitted.title,
  };
}

export default function useDocumentDraft({
  element,
  draftSlot,
  canEdit,
  composing,
  onSave,
  onUseCurrent,
}: DocumentDraftOptions) {
  const [document, setDocument] = useState(() => element.document ?? defaultDocument());
  const [title, setTitle] = useState(element.text || '文档');
  const [base, setBase] = useState(element);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState('');
  const [comparing, setComparing] = useState(false);
  const [awaitingReview, setAwaitingReview] = useState(false);
  const baseline = useRef(base);
  const current = useRef(element);
  const draft = useRef({ document, title });
  const commit = useRef(onSave);
  const mounted = useRef(true);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const leavingRef = useRef(false);

  useLayoutEffect(() => {
    current.current = element;
    baseline.current = base;
    draft.current = { document, title };
    commit.current = onSave;
  }, [element, base, document, title, onSave]);
  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const dirty =
    !jsonEqual(document, base.document ?? defaultDocument()) || title !== (base.text || '文档');
  const newerSavedState = element !== base && element.version >= base.version;
  if (newerSavedState && !composing && !saving) {
    if (!dirty) {
      setBase(element);
      setDocument(element.document ?? defaultDocument());
      setTitle(element.text || '文档');
    } else if (element.version > base.version && sameSavedText(element, base)) {
      setBase(element);
    }
  }
  if (!canEdit && dirty && error !== READ_ONLY_DRAFT) {
    setError(READ_ONLY_DRAFT);
  }

  const storage = useMemo(() => createDraftStorage(draftSlot), [draftSlot]);
  const warning = useSyncExternalStore(
    storage.subscribe,
    storage.getSnapshot,
    storage.getServerSnapshot,
  );
  useEffect(() => {
    storage.sync({ base, document, title }, dirty);
  }, [base, document, title, dirty, storage]);

  const reportError = useCallback((cause: unknown) => {
    if (mounted.current) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const save = useCallback(
    async (overwrite = false): Promise<boolean> => {
      if (inFlight.current) {
        return inFlight.current;
      }

      if (!canEdit) {
        setError(READ_ONLY_DRAFT);

        return false;
      }

      if (awaitingReview && !overwrite) {
        return false;
      }

      const submitted = draft.current;
      const origin = baseline.current;
      const source = overwrite ? current.current : origin;
      if (!submitted.title.trim()) {
        setError('请填写文档标题后保存。');

        return false;
      }

      const unchanged =
        jsonEqual(submitted.document, source.document) && submitted.title === source.text;

      if (!overwrite && unchanged) {
        return true;
      }

      setSaving(true);
      setError('');

      const work = (async () => {
        try {
          const next = overwrite ? rebaseDraft(submitted, origin, source) : submitted;
          const result = await commit.current(next.document, next.title, source, overwrite);
          if (!result) {
            throw new Error('文档尚未保存，请比较最新内容或重试。');
          }

          const newerDraft = !jsonEqual(draft.current, submitted);
          const foreignBody = !jsonEqual(
            normalizeDocument(result.document ?? defaultDocument()),
            normalizeDocument(submitted.document),
          );

          if (newerDraft && foreignBody) {
            baseline.current = origin;
            reportError('保存回执含有新的正文，新输入已保留，请比较最新内容后保存。');

            return false;
          }

          baseline.current = result;
          if (mounted.current) {
            setBase(result);
            if (!newerDraft) {
              setDocument(result.document ?? submitted.document);
              setTitle(result.text || submitted.title);
            }

            if (!newerDraft) {
              setAwaitingReview(false);
            }
            setComparing(false);
          }

          return true;
        } catch (cause) {
          reportError(cause);

          return false;
        } finally {
          inFlight.current = null;
          if (mounted.current) {
            setSaving(false);
          }
        }
      })();
      inFlight.current = work;

      return work;
    },
    [canEdit, awaitingReview, reportError],
  );

  const prepareExit = useCallback(async (): Promise<boolean> => {
    if (composing || leavingRef.current) {
      return false;
    }

    leavingRef.current = true;
    setLeaving(true);
    const unsaved = () =>
      draft.current.title !== (baseline.current.text || '文档') ||
      !jsonEqual(
        normalizeDocument(draft.current.document),
        normalizeDocument(baseline.current.document ?? defaultDocument()),
      );

    try {
      if (inFlight.current && !(await inFlight.current)) {
        return false;
      }
      if (awaitingReview && unsaved()) {
        return !warning && mounted.current;
      }
      if (unsaved() && !(await save())) {
        return false;
      }

      if (unsaved()) {
        setError('文档还有未确认的修改，请确认保存后再返回。');

        return false;
      }

      return mounted.current;
    } finally {
      leavingRef.current = false;
      if (mounted.current) {
        setLeaving(false);
      }
    }
  }, [awaitingReview, composing, save, warning]);
  useEffect(() => {
    const blocked = composing || saving || Boolean(error);
    const liveSaving = canEdit && !awaitingReview;
    if (blocked || !dirty || !liveSaving) {
      return;
    }

    const timer = setTimeout(() => {
      save().catch(reportError);
    }, 650);

    return () => clearTimeout(timer);
  }, [
    document,
    title,
    dirty,
    saving,
    error,
    canEdit,
    save,
    composing,
    reportError,
    awaitingReview,
  ]);

  function compareRecovery(raw: string) {
    const recovered = decodeDocumentDraft(raw, element.id);
    return {
      saved: documentPlainText(element.document ?? defaultDocument()),
      draft: recovered ? recovered.title + '\n' + documentPlainText(recovered.document) : raw,
      recoverable: Boolean(recovered),
    };
  }

  function restore(raw: string) {
    const recovered = decodeDocumentDraft(raw, element.id);
    if (!recovered) {
      return false;
    }

    draftSlot.write(JSON.stringify(recovered));
    baseline.current = recovered.base;
    setBase(recovered.base);
    setDocument(recovered.document);
    setTitle(recovered.title);
    setAwaitingReview(true);
    setComparing(true);
    return true;
  }

  function adoptCurrent() {
    if (inFlight.current) {
      return;
    }

    onUseCurrent?.();
    baseline.current = current.current;
    setBase(current.current);
    setDocument(current.current.document ?? defaultDocument());
    setTitle(current.current.text || '文档');
    setError('');
    setAwaitingReview(false);
    setComparing(false);
  }

  function copy() {
    copyPlainText(JSON.stringify(draft.current)).catch(reportError);
  }

  return {
    document,
    setDocument,
    title,
    setTitle,
    dirty,
    saving,
    leaving,
    error,
    reportError,
    comparing,
    setComparing,
    draftSlot,
    compareRecovery,
    warning,
    draft,
    baseline,
    mounted,
    save,
    prepareExit,
    restore,
    adoptCurrent,
    copy,
  };
}
