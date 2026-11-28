import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Dialog } from '../../ui/base/index.js';
import type { CanvasProps } from '../../ui/domain/canvas/index.js';
import type { BoardDraftAccess, BoardDraftCurrent, LocalBoardDraft } from './local-board-drafts.js';
import './board-draft-recovery.css';

interface BoardDraftRecoveryProps {
  readonly draftAccess?: BoardDraftAccess;
  readonly readCurrent: (objectId: string, signal: AbortSignal) => Promise<BoardDraftCurrent>;
  readonly copyText?: (text: string) => Promise<void>;
  readonly downloadFile?: CanvasProps['downloadFile'];
}

interface Comparison {
  readonly draft: LocalBoardDraft;
  readonly current: BoardDraftCurrent;
}

interface Picker {
  readonly scope: string;
  readonly entries: readonly LocalBoardDraft[];
  readonly comparison?: Comparison;
}

const draftTitles = new Map([
  ['text.commit', '文字'],
  ['document.commit', '文档'],
  ['todo.edit', '任务清单'],
  ['table.save', '表格'],
  ['embed.save-source', 'HTML 源码'],
  ['embed.save-state', 'HTML 交互状态'],
  ['sticker.select', '贴纸'],
  ['media.crop', '图片裁剪'],
  ['link.commit', '链接'],
]);

function draftCaption(draft: LocalBoardDraft): string {
  const { name, objectId } = draft.intent;

  return (draftTitles.get(name) ?? '正文') + '草稿 · ' + objectId;
}

function draftChoices(entries: readonly LocalBoardDraft[]) {
  const labels = new Map<string, number>();
  for (const draft of entries) {
    const caption = draftCaption(draft);
    labels.set(caption, (labels.get(caption) ?? 0) + 1);
  }

  return entries.map((draft) => {
    const caption = draftCaption(draft);
    const duplicate = (labels.get(caption) ?? 0) > 1;

    return { draft, label: duplicate ? caption + ' · ' + draft.id.slice(0, 8) : caption };
  });
}

function presentJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, part: unknown) => (typeof part === 'bigint' ? part.toString() : part),
    2,
  );
}

function savedDraftText(current: BoardDraftCurrent): string {
  if (!current.kind) {
    return '原对象已不在当前白板。';
  }

  return current.value === undefined ? '对象当前没有已保存正文。' : presentJson(current.value);
}

function stillMatches(current: BoardDraftCurrent, draft: LocalBoardDraft): boolean {
  const { intent } = draft;

  return (
    current.canEdit &&
    current.kind === intent.kind &&
    current.version === BigInt(intent.expectedVersion)
  );
}

function containsDraft(entries: readonly LocalBoardDraft[], draft: LocalBoardDraft): boolean {
  return entries.some(({ id, data }) => id === draft.id && data === draft.data);
}

type RecoveryAction = (
  access: BoardDraftAccess,
  current: BoardDraftCurrent,
  signal: AbortSignal,
) => Promise<void> | void;

interface RecoveryCommands {
  readonly choose: (draft: LocalBoardDraft) => void;
  readonly discard: (draft: LocalBoardDraft) => void;
  readonly apply: (draft: LocalBoardDraft) => void;
  readonly copy?: (draft: LocalBoardDraft) => void;
  readonly download?: (draft: LocalBoardDraft) => void;
}

interface RecoveryDetailsProps {
  readonly comparison: Comparison;
  readonly busy: boolean;
  readonly actions: RecoveryCommands;
}

function RecoveryDetails({ comparison, busy, actions }: RecoveryDetailsProps) {
  const { draft, current } = comparison;
  const matchingVersion = stillMatches(current, draft);

  return (
    <>
      {!matchingVersion && (
        <p className="studio-board-draft__status" role="status">
          当前对象或正文版本已有变化。可比较、复制或下载这份草稿。
        </p>
      )}
      <div className="studio-board-draft__comparison">
        <section>
          <h3>当前已保存内容</h3>
          <pre>{savedDraftText(current)}</pre>
        </section>
        <section>
          <h3>本机草稿</h3>
          <pre>{presentJson(draft.intent.value)}</pre>
        </section>
      </div>
      <div className="studio-board-draft__actions">
        {actions.copy && (
          <Button label="复制草稿" disabled={busy} onActivate={() => actions.copy?.(draft)} />
        )}
        {actions.download && (
          <Button
            label="下载草稿副本"
            disabled={busy}
            onActivate={() => actions.download?.(draft)}
          />
        )}
        <Button
          label="放弃上次草稿"
          tone="danger"
          disabled={busy}
          onActivate={() => actions.discard(draft)}
        />
        <Button
          label="应用已比较的草稿"
          variant="primary"
          disabled={busy || !matchingVersion}
          onActivate={() => actions.apply(draft)}
        />
      </div>
    </>
  );
}

export function BoardDraftRecovery({
  draftAccess,
  readCurrent,
  copyText,
  downloadFile,
}: BoardDraftRecoveryProps) {
  const [picker, setPicker] = useState<Picker>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  const scope = draftAccess?.scope;

  useLayoutEffect(() => () => request.current?.abort(), [scope]);

  function handleClose() {
    request.current?.abort();
    setPicker(undefined);
    setMessage(undefined);
  }

  function handleOpen() {
    if (!draftAccess?.active()) {
      return;
    }

    setPicker({ scope: draftAccess.scope, entries: draftAccess.list() });
  }

  function refresh(access: BoardDraftAccess) {
    setPicker({ scope: access.scope, entries: access.list() });
  }

  function inspect(draft: LocalBoardDraft, action?: RecoveryAction) {
    const access = draftAccess;
    if (!access?.active()) {
      return;
    }

    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const { signal } = controller;
    setBusy(true);
    setMessage(undefined);
    setPicker((current) =>
      current?.scope === access.scope ? { ...current, comparison: undefined } : current,
    );
    readCurrent(draft.intent.objectId, signal)
      .then(async (current) => {
        if (signal.aborted || !access.active()) {
          return;
        }

        if (!current.canEdit) {
          setPicker(undefined);
          setMessage('当前没有恢复此白板草稿的权限。');

          return;
        }

        const entries = access.list();
        if (!containsDraft(entries, draft)) {
          setPicker({ scope: access.scope, entries });
          setMessage('草稿在另一视图中已变化，请重新比较。');
          return;
        }

        setPicker({ scope: access.scope, entries, comparison: { draft, current } });
        await action?.(access, current, signal);
      })
      .catch((error: unknown) => {
        if (!signal.aborted && access.active()) {
          const detail = error instanceof Error ? error.message : '请求失败。';
          setMessage('本机草稿操作未完成。' + detail);
        }
      })
      .finally(() => {
        if (request.current === controller) {
          request.current = undefined;
          setBusy(false);
        }
      });
  }

  const actions: RecoveryCommands = {
    choose: (draft) => inspect(draft),
    discard: (draft) =>
      inspect(draft, (access) => {
        access.remove(draft.id);
        refresh(access);
      }),
    apply: (draft) =>
      inspect(draft, async (access, current, signal) => {
        if (!stillMatches(current, draft)) {
          return;
        }

        const result = await access.restore(draft);
        if (!signal.aborted && access.active()) {
          if (result.ok) {
            refresh(access);
            setMessage('草稿已保存到当前白板。');
          } else {
            setMessage(result.message);
          }
        }
      }),
    copy: copyText ? (draft) => inspect(draft, () => copyText(draft.data)) : undefined,
    download: downloadFile
      ? (draft) =>
          inspect(draft, () => {
            downloadFile({
              filename: '白板草稿-' + draft.id + '.json',
              mimeType: 'application/json',
              content: new TextEncoder().encode(draft.data),
            });
          })
      : undefined,
  };

  if (!draftAccess) {
    return null;
  }

  const visible = picker?.scope === scope ? picker : undefined;
  const comparison = visible?.comparison;
  const statusMessage = draftAccess.storageError || message;

  return (
    <>
      {(draftAccess.hasEntries || statusMessage) && (
        <div className="studio-board-draft__entry">
          <Button label="本机草稿" onActivate={handleOpen} />
          {!visible && statusMessage && <span role="status">{statusMessage}</span>}
        </div>
      )}
      <Dialog
        open={visible !== undefined}
        title="本机草稿"
        closeLabel="关闭本机草稿提示"
        onRequestClose={handleClose}
      >
        {visible && (
          <div className="studio-board-draft">
            {draftAccess.storageError && <p role="status">{draftAccess.storageError}</p>}
            {message && <p role="status">{message}</p>}
            {visible.entries.length > 0 ? (
              <ul className="studio-board-draft__list" aria-label="上次未确认的草稿">
                {draftChoices(visible.entries).map(({ draft, label }) => (
                  <li key={draft.id}>
                    <Button
                      label={label}
                      disabled={busy}
                      onActivate={() => actions.choose(draft)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p role="status">当前白板没有待处理的本机草稿。</p>
            )}
            {comparison && (
              <RecoveryDetails comparison={comparison} busy={busy} actions={actions} />
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
