import { useMemo, useSyncExternalStore } from 'react';
import type { BoardRoomAgentWorkspace, BoardRoomSession } from '../../data/rooms/index.js';

type Workspace = BoardRoomAgentWorkspace;
type TerminalState = NonNullable<Workspace['endReason']>;
export type AgentWorkspaceState = Workspace['phase'] | TerminalState | 'stale';

export interface AgentWorkspaceView extends Workspace {
  readonly state: AgentWorkspaceState;
  readonly fadeMillis?: number;
}

const phaseLabels = {
  preparing: '准备中',
  writing: '修改中',
  verifying: '检查中',
};
const terminalLabels = {
  completed: '已完成',
  released: '工作区已结束',
  expired: '工作区已过期',
};
const staleAfterMs = 120_000;
const terminalDisplayMs = 500;

export function workspaceName({ label, taskId }: Workspace) {
  return label || taskId;
}

export function workspaceStatus({ state, phase }: AgentWorkspaceView) {
  if (state === 'stale') {
    return '暂未收到新进度 · ' + phaseLabels[phase];
  }

  return state in terminalLabels ? terminalLabels[state as TerminalState] : phaseLabels[phase];
}

export function workspaceIsActive({ state }: AgentWorkspaceView) {
  return !(state in terminalLabels);
}

function workspaceTime(workspace: Workspace, now: number) {
  const { phase, endedAtUnixMs, endReason, expiresAtUnixMs, lastProgressAtUnixMs } = workspace;
  if (endReason && endedAtUnixMs !== undefined) {
    return { state: endReason, deadline: endedAtUnixMs + terminalDisplayMs };
  }
  if (expiresAtUnixMs <= now) {
    return { state: 'expired' as const, deadline: expiresAtUnixMs + terminalDisplayMs };
  }

  const staleAt =
    lastProgressAtUnixMs === undefined ? Infinity : lastProgressAtUnixMs + staleAfterMs;
  const stale = staleAt <= now;

  return {
    state: stale ? ('stale' as const) : phase,
    deadline: stale ? expiresAtUnixMs : Math.min(staleAt, expiresAtUnixMs),
  };
}

function workspaceRead(session: BoardRoomSession) {
  const { agentWorkspaces, status } = session.getSnapshot();
  const now = session.now();
  const views: { workspace: Workspace; view: AgentWorkspaceView }[] = [];
  let deadline = Infinity;
  if (status === 'accessLost') {
    return { views, deadline };
  }

  for (const workspace of agentWorkspaces ?? []) {
    const time = workspaceTime(workspace, now);
    if (time.deadline > now) {
      const fadeMillis = time.state in terminalLabels ? time.deadline - now : undefined;
      views.push({ workspace, view: { ...workspace, state: time.state, fadeMillis } });
      deadline = Math.min(deadline, time.deadline);
    }
  }

  return { views, deadline };
}

function agentWorkspaceStore(session: BoardRoomSession) {
  let current = workspaceRead(session).views;
  let snapshot = current.map(({ view }) => view);
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      let cancel: (() => void) | undefined;
      function refresh() {
        cancel?.();
        const { views, deadline } = workspaceRead(session);
        const changed =
          current.length !== views.length ||
          current.some(
            (item, index) =>
              item.workspace !== views[index]?.workspace ||
              item.view.state !== views[index]?.view.state,
          );

        if (changed) {
          current = views;
          snapshot = views.map(({ view }) => view);
          listener();
        }
        if (Number.isFinite(deadline)) {
          cancel = session.schedule(Math.max(1, deadline - session.now()), refresh);
        }
      }
      const unsubscribe = session.subscribe(refresh);
      refresh();

      return () => {
        unsubscribe();
        cancel?.();
      };
    },
  };
}

export function useAgentWorkspaceView(session: BoardRoomSession) {
  const store = useMemo(() => agentWorkspaceStore(session), [session]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
