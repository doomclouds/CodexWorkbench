import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { TableObjectProps, TableObjectValue } from './contracts.js';
import {
  clampCell,
  describeTableDraft,
  projectTableDraft,
  readTable,
  rebaseTableDraft,
  sameTable,
  tableDraft,
} from './table-model.js';
import type { CellAddress, TableDraft, TableModel } from './table-model.js';

interface CommitTarget {
  readonly cell: CellAddress | null;
}

const autoSaveWait = 250;
const autoSaveMaximumWait = 1000;
const noActivity = { editing: false, dirty: false, saving: false, resizing: false };

function latestValue(value: TableObjectValue, saved: TableObjectValue | null) {
  return saved && saved.version > value.version ? saved : value;
}

function changed(draft: TableDraft | null) {
  return draft !== null && !sameTable(draft.original, draft.model);
}

function failureMessage(failure: unknown) {
  return failure instanceof Error ? failure.message : String(failure);
}

export function useTableSession(props: TableObjectProps, resizing: boolean) {
  const { value, canEdit, initialDraft, selected, editRequest } = props;
  const [draft, setDraft] = useState<TableDraft | null>(() =>
    initialDraft ? tableDraft(value, initialDraft) : null,
  );
  const [receipt, setReceipt] = useState<TableObjectValue | null>(null);
  const [active, setActive] = useState<CellAddress | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const draftRef = useRef(draft);
  const propsRef = useRef(props);
  const receiptRef = useRef<TableObjectValue | null>(null);
  const inFlight = useRef<TableDraft | null>(null);
  const queued = useRef<CommitTarget | null>(null);
  const alive = useRef(false);
  const waitStarted = useRef<number | null>(null);
  const displayedValue = latestValue(value, receipt);
  const confirmed = useMemo(() => readTable(displayedValue), [displayedValue]);
  const dirty = changed(draft);
  const model = useMemo(() => {
    if (!draft || !dirty) {
      return confirmed;
    }

    const projectionMoved =
      draft.base.version < displayedValue.version || draft.base.width !== displayedValue.width;

    return projectionMoved ? projectTableDraft(draft, confirmed) : draft.model;
  }, [confirmed, dirty, displayedValue.version, displayedValue.width, draft]);
  const editing = Boolean((canEdit && active) || dirty || saving || resizing);

  useLayoutEffect(() => {
    propsRef.current = props;
  }, [props]);

  const notifyActivity = useEffectEvent((activity: typeof noActivity) => {
    propsRef.current.onActivityChange?.(activity);
  });

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
      notifyActivity(noActivity);
    };
  }, []);

  useEffect(() => {
    notifyActivity({ editing, dirty, saving, resizing });
  }, [dirty, editing, resizing, saving]);

  function source() {
    const observed = latestValue(propsRef.current.value, receiptRef.current);
    const current = draftRef.current;
    if (!current) {
      return tableDraft(observed);
    }

    const currentProjection =
      current.base.version >= observed.version && current.base.width === observed.width;

    return changed(current) || currentProjection ? current : tableDraft(observed);
  }

  function stage(next: TableDraft | null) {
    draftRef.current = next;
    setDraft(next);
    propsRef.current.onDraftChange?.(next && changed(next) ? describeTableDraft(next) : null);
  }

  function patch(next: TableModel) {
    stage({ ...source(), model: next });
  }

  function select(cell: CellAddress) {
    if (!propsRef.current.canEdit || inFlight.current) {
      return;
    }

    setActive(cell);
  }

  function applyTarget(target: CommitTarget, model: TableModel) {
    setActive(target.cell ? clampCell(target.cell, model) : null);
  }

  function reportSaveFailure(failure: unknown) {
    if (alive.current) {
      setError(failureMessage(failure));
    }
  }

  function accept(submitted: TableDraft, result: TableObjectValue, target: CommitTarget) {
    const displayed = latestValue(propsRef.current.value, result);
    receiptRef.current = displayed;
    setReceipt(displayed);
    const current = draftRef.current;
    if (current && !sameTable(current.model, submitted.model)) {
      const rebased = rebaseTableDraft(submitted, current, displayed);
      if (!rebased) {
        setError('有新的共享表格修改，草稿已保留。');
        return false;
      }

      stage(rebased);
      return true;
    }

    stage(null);
    applyTarget(target, readTable(displayed));

    return true;
  }

  async function submit(next: TableDraft, target: CommitTarget) {
    if (!propsRef.current.canEdit) {
      return;
    }

    if (inFlight.current) {
      queued.current = target;
      return;
    }
    if (!changed(next)) {
      stage(null);
      applyTarget(target, next.model);
      return;
    }

    inFlight.current = next;
    setSaving(true);
    setError('');
    let accepted = false;
    try {
      const result = await propsRef.current.onSave(describeTableDraft(next));
      if (!alive.current) {
        return;
      }

      const validReceipt =
        result && result.id === next.base.id && result.version > next.base.version;

      if (validReceipt) {
        accepted = accept(next, result, target);
      } else {
        setError('表格未能保存，草稿已保留。');
      }
    } catch (failure) {
      reportSaveFailure(failure);
    } finally {
      inFlight.current = null;
      const pending = queued.current;
      queued.current = null;
      if (alive.current) {
        setSaving(false);
        if (accepted && pending) {
          submit(source(), pending).catch(reportSaveFailure);
        }
      }
    }
  }

  function commit(cell: CellAddress | null, next?: TableModel) {
    const current = source();
    const staged = next ? { ...current, model: next } : current;
    if (next) {
      stage(staged);
    }

    submit(staged, { cell }).catch(reportSaveFailure);
  }

  function discard() {
    if (inFlight.current) {
      return;
    }

    setError('');
    stage(null);
    setActive(null);
  }

  const saveLiveDraft = useEffectEvent(() => {
    commit(active);
  });
  useEffect(() => {
    const canAutoSave = canEdit && !error && !saving;
    if (!dirty || !canAutoSave || resizing) {
      waitStarted.current = null;
      return;
    }

    waitStarted.current ??= Date.now();
    const remaining = autoSaveMaximumWait - (Date.now() - waitStarted.current);
    const timer = setTimeout(
      () => {
        waitStarted.current = null;
        saveLiveDraft();
      },
      Math.max(0, Math.min(autoSaveWait, remaining)),
    );

    return () => clearTimeout(timer);
  }, [canEdit, dirty, draft, error, resizing, saving]);

  const openRequestedEditor = useEffectEvent(() => {
    if (selected && editRequest) {
      select({ row: 0, column: 0 });
    }
  });
  useEffect(() => {
    openRequestedEditor();
  }, [editRequest]);

  return { active, model, saving, error, editing, source, patch, select, commit, discard };
}
