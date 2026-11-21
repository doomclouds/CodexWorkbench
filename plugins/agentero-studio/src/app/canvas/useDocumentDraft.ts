import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { BoardElement } from '../../contracts/studio.js';
import {
  applyDocumentOperations,
  defaultDocument,
  documentOperations,
  normalizeDocument,
  type DocumentContent,
} from '../../contracts/document.js';
import { jsonEqual } from '../../core/shared/safe-merge.js';
import { copyPlainText } from '../clipboard.js';

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

function createDraftStorage(key: string, elementId: string) {
  const initial = { recovered: null as SavedDraft | null, warning: '', loaded: false };
  let snapshot = initial;
  let recoveryPresent = false;
  const listeners = new Set<() => void>();
  function publish(recovered: SavedDraft | null, warning: string) {
    if (snapshot.loaded && snapshot.recovered === recovered && snapshot.warning === warning) {
      return;
    }

    snapshot = { recovered, warning, loaded: true };
    for (const listener of listeners) {
      listener();
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(key);
      recoveryPresent = Boolean(raw);
      if (!raw) {
        publish(null, '');

        return;
      }

      const saved = JSON.parse(raw);
      const base = saved?.base;
      const validBase =
        base?.id === elementId && base.type === 'document' && Number.isSafeInteger(base.version);
      const validTitle = typeof saved?.title === 'string' && saved.title.length <= 200;
      if (!validBase || !validTitle) {
        throw new Error('草稿信息无效。');
      }

      publish(
        {
          base: { ...saved.base, document: normalizeDocument(saved.base.document) },
          document: normalizeDocument(saved.document),
          title: saved.title,
        },
        '',
      );
    } catch (cause) {
      const detail = storageRestriction(cause);
      publish(null, `未能读取上次的文档草稿，请先复制本机草稿，避免丢失。${detail}`);
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!snapshot.loaded) {
        load();
      }

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initial,
    sync(draft: SavedDraft, dirty: boolean) {
      if (!snapshot.loaded || (!dirty && recoveryPresent)) {
        return;
      }

      try {
        if (dirty) {
          localStorage.setItem(key, JSON.stringify(draft));
        } else {
          localStorage.removeItem(key);
        }

        publish(snapshot.recovered, '');
      } catch (cause) {
        const detail = storageRestriction(cause);
        publish(
          snapshot.recovered,
          `无法保存本机草稿，仍会尝试保存到白板；未确认前请复制文档草稿。${detail}`,
        );
      }
    },
    releaseRecovery() {
      recoveryPresent = false;
      publish(null, snapshot.warning);
    },
  };
}

interface DocumentDraftOptions {
  element: BoardElement;
  draftKey: string;
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
  draftKey,
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

  const storage = useMemo(() => createDraftStorage(draftKey, element.id), [draftKey, element.id]);
  const { recovered, warning, loaded } = useSyncExternalStore(
    storage.subscribe,
    storage.getSnapshot,
    storage.getServerSnapshot,
  );
  useEffect(() => {
    if (loaded) {
      storage.sync({ base, document, title }, dirty);
    }
  }, [base, document, title, dirty, storage, recovered, loaded]);

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
          storage.releaseRecovery();
          if (mounted.current) {
            setBase(result);
            if (!newerDraft) {
              setDocument(result.document ?? submitted.document);
              setTitle(result.text || submitted.title);
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
    [canEdit, storage, reportError],
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
  }, [composing, save]);
  useEffect(() => {
    const blocked = composing || saving || Boolean(error);
    if (blocked || !dirty || !canEdit) {
      return;
    }

    const timer = setTimeout(() => {
      save().catch(reportError);
    }, 650);

    return () => clearTimeout(timer);
  }, [document, title, dirty, saving, error, canEdit, save, composing, reportError]);

  function restore() {
    if (!recovered) {
      return false;
    }

    storage.releaseRecovery();
    baseline.current = recovered.base;
    setBase(recovered.base);
    setDocument(recovered.document);
    setTitle(recovered.title);

    return true;
  }

  function discard() {
    try {
      localStorage.removeItem(draftKey);
      storage.releaseRecovery();
    } catch (cause) {
      reportError(cause);
    }
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
    setComparing(false);
  }

  function copy() {
    copyPlainText(JSON.stringify(draft.current)).catch(reportError);
  }

  function copyRecovery() {
    let value = JSON.stringify(draft.current);
    try {
      value = localStorage.getItem(draftKey) || value;
    } catch (cause) {
      if (!storageRestriction(cause)) {
        reportError(cause);
      }
    }

    copyPlainText(value).catch(reportError);
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
    recovered,
    warning,
    draft,
    baseline,
    mounted,
    save,
    prepareExit,
    restore,
    discard,
    adoptCurrent,
    copy,
    copyRecovery,
  };
}
