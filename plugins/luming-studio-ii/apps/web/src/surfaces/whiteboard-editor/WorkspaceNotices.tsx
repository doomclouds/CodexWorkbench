import { useCallback, useState } from 'react';
import type { WhiteboardReadyState } from '../../data/whiteboard/index.js';
import { OperationNotice } from '../../ui/base/index.js';
import type { TextSaveIssue } from '../../ui/domain/objects/text/index.js';
import type { useBoardTitle } from './use-board-title.js';
import type { useBoardUndo } from './use-board-undo.js';

export function useTextSaveIssues() {
  const [textSaveIssues, setTextSaveIssues] = useState<ReadonlyMap<string, TextSaveIssue>>(
    () => new Map(),
  );
  const publishTextSaveIssue = useCallback((issue: TextSaveIssue) => {
    setTextSaveIssues((current) => new Map(current).set(issue.objectId, issue));

    return () => {
      setTextSaveIssues((current) => {
        if (current.get(issue.objectId) !== issue) {
          return current;
        }

        const next = new Map(current);
        next.delete(issue.objectId);
        return next;
      });
    };
  }, []);

  return { textSaveIssues, publishTextSaveIssue };
}

interface BoardReadNoticesProps {
  readonly state: WhiteboardReadyState;
  readonly reload: () => void;
  readonly retryPayloads: () => void;
  readonly unsafePayloadVersion: boolean;
  readonly renameFailure?: ReturnType<typeof useBoardTitle>['failure'];
}

function BoardReadNotices({
  state,
  reload,
  retryPayloads,
  unsafePayloadVersion,
  renameFailure,
}: BoardReadNoticesProps) {
  return (
    <>
      {renameFailure && (
        <OperationNotice
          id="whiteboard-rename-failed"
          level="error"
          message={renameFailure.message}
          actions={
            renameFailure.retry && [
              { id: 'retry-rename', label: '重试改名', onActivate: renameFailure.retry },
            ]
          }
        />
      )}
      {state.sceneError && (
        <OperationNotice
          id="whiteboard-reload-failed"
          level="error"
          message={'白板刷新失败。' + state.sceneError}
          actions={[{ id: 'reload', label: '重新加载', onActivate: reload }]}
        />
      )}
      {state.payloadError && (
        <OperationNotice
          id="whiteboard-payload-failed"
          level="warning"
          message={'对象正文加载失败。' + state.payloadError}
          actions={[{ id: 'retry-payloads', label: '重试正文', onActivate: retryPayloads }]}
        />
      )}
      {unsafePayloadVersion && (
        <OperationNotice
          id="whiteboard-payload-version"
          level="warning"
          message="部分对象的正文版本超出当前画布的安全整数范围。"
        />
      )}
    </>
  );
}

interface WorkspaceNoticesProps extends BoardReadNoticesProps {
  readonly textSaveIssues: ReadonlyMap<string, TextSaveIssue>;
  readonly sourceIssue?: string;
  readonly dismissSourceIssue: () => void;
  readonly clipboardIssue?: string;
  readonly dismissClipboardIssue: () => void;
  readonly undo: Pick<
    ReturnType<typeof useBoardUndo>,
    'state' | 'canRetry' | 'checkReceipt' | 'retry'
  >;
}

export function WorkspaceNotices({
  textSaveIssues,
  sourceIssue,
  dismissSourceIssue,
  clipboardIssue,
  dismissClipboardIssue,
  undo,
  ...readNotices
}: WorkspaceNoticesProps) {
  const undoError = 'detail' in undo.state ? undo.state.detail : undefined;
  return (
    <>
      <BoardReadNotices {...readNotices} />
      {[...textSaveIssues.values()].map(({ objectId, message, retry, discard }) => (
        <OperationNotice
          key={objectId}
          id={'whiteboard-text-save-' + objectId}
          level="error"
          message={message}
          presentation="banner"
          actions={[
            ...(retry ? [{ id: 'retry', label: '重试保存文字', onActivate: retry }] : []),
            ...(discard ? [{ id: 'discard', label: '放弃文字修改', onActivate: discard }] : []),
          ]}
        />
      ))}
      {sourceIssue && (
        <OperationNotice
          id="native-source-unavailable"
          level="warning"
          message={sourceIssue}
          dismissible
          onDismiss={dismissSourceIssue}
        />
      )}
      {clipboardIssue && (
        <OperationNotice
          id="canvas-clipboard-error"
          level="warning"
          message={clipboardIssue}
          dismissible
          onDismiss={dismissClipboardIssue}
        />
      )}
      {undoError && (
        <OperationNotice
          id="canvas-history-error"
          level="warning"
          message={undoError}
          actions={
            undo.state.kind === 'unknown'
              ? [
                  {
                    id: 'check',
                    label: '查询回执',
                    onActivate: undo.checkReceipt,
                    disabled: !undo.canRetry,
                  },
                  {
                    id: 'retry',
                    label: '重试',
                    onActivate: undo.retry,
                    disabled: !undo.canRetry,
                  },
                ]
              : undefined
          }
        />
      )}
    </>
  );
}
