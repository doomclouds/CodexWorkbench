import { Bot } from 'lucide-react';
import { useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { BoardRoomAgentWorkspace } from '../../data/rooms/index.js';
import {
  workspaceIsActive,
  workspaceName,
  workspaceStatus,
  type AgentWorkspaceView,
} from './agent-workspace-view.js';
import { participantColor } from './follow.js';
import './agent-workspace.css';

export type AgentWorkspaceTarget = Pick<
  BoardRoomAgentWorkspace,
  'agentId' | 'taskId' | 'generation'
>;

export interface AgentWorkspaceRowsProps {
  readonly workspaces: readonly AgentWorkspaceView[];
  readonly onlineAgentIds?: readonly string[];
  readonly readingAgentIds?: readonly string[];
  readonly followedAgentId?: string;
  readonly canFollow: boolean;
  readonly preview: boolean;
  readonly onFollow: (agentId: string) => void;
  readonly onRelease?: (target: AgentWorkspaceTarget) => Promise<void>;
}

type ReleaseWorkspace = NonNullable<AgentWorkspaceRowsProps['onRelease']>;

const releaseLabels = {
  idle: '结束此工作区',
  submitting: '正在结束…',
  finished: '已结束',
};

function workspaceKey({ taskId, generation }: AgentWorkspaceTarget) {
  return JSON.stringify([taskId, generation]);
}

function workspacesByAgent(
  workspaces: readonly AgentWorkspaceView[],
  onlineAgentIds: readonly string[] | undefined,
) {
  const groups = new Map<string, AgentWorkspaceView[]>(onlineAgentIds?.map((id) => [id, []]));

  for (const workspace of workspaces) {
    const group = groups.get(workspace.agentId);
    if (group) {
      group.push(workspace);
    } else if (!onlineAgentIds) {
      groups.set(workspace.agentId, [workspace]);
    }
  }

  return groups;
}

export function AgentWorkspaceAvatar({
  agentId,
  followed = false,
}: {
  readonly agentId: string;
  readonly followed?: boolean;
}) {
  const color = participantColor(agentId);
  const style = {
    '--room-member-color': color,
    backgroundColor: color,
    color: color === '#fbb315' ? '#201b0c' : '#fff',
  } as CSSProperties;

  return (
    <span
      className="room-presence-avatar room-agent-avatar"
      data-followed={followed || undefined}
      aria-hidden="true"
      style={style}
    >
      <Bot size={14} aria-hidden="true" />
    </span>
  );
}

export function WorkspaceRelease({
  workspace,
  onRelease,
  canvas = false,
  onCanvasFocus,
}: {
  readonly workspace: BoardRoomAgentWorkspace;
  readonly onRelease: ReleaseWorkspace;
  readonly canvas?: boolean;
  readonly onCanvasFocus?: () => void;
}) {
  const { agentId, taskId, generation } = workspace;
  const trigger = useRef<HTMLButtonElement>(null);
  const requestActive = useRef(false);
  const [state, setState] = useState<keyof typeof releaseLabels>('idle');
  const [failed, setFailed] = useState<string>();
  const restoreFocus = useEffectEvent((button: HTMLButtonElement) => {
    if (button.ownerDocument.activeElement === button) {
      onCanvasFocus?.();
    }
  });
  useLayoutEffect(() => {
    const button = trigger.current;
    if (canvas && button) {
      return () => restoreFocus(button);
    }
  }, [canvas]);

  async function release() {
    if (requestActive.current) {
      return;
    }

    requestActive.current = true;
    setState('submitting');
    setFailed(undefined);
    try {
      await onRelease({ agentId, taskId, generation });
      setState('finished');
    } catch (error) {
      setFailed(error instanceof Error && error.message ? error.message : '请重试。');
      requestActive.current = false;
      setState('idle');
    }
  }

  return (
    <div
      className="room-agent-release"
      onPointerDown={canvas ? (event) => event.stopPropagation() : undefined}
      onDoubleClick={canvas ? (event) => event.stopPropagation() : undefined}
      onClick={canvas ? (event) => event.stopPropagation() : undefined}
    >
      <button
        ref={trigger}
        className="room-agent-release-button"
        type="button"
        data-agent-task-release={taskId}
        data-canvas-native={canvas ? '' : undefined}
        aria-label={'结束此工作区：' + workspaceName(workspace)}
        title="结束此工作区并撤销本任务的后续写入。模型仍可继续运行。"
        disabled={!canvas && state !== 'idle'}
        aria-disabled={(canvas && state !== 'idle') || undefined}
        aria-busy={state === 'submitting' || undefined}
        onClick={() => void release()}
      >
        {releaseLabels[state]}
      </button>
      {failed && (
        <p className="room-agent-release-error" role="alert">
          结束工作区失败：{failed}
        </p>
      )}
    </div>
  );
}

interface AgentRowProps {
  readonly agentId: string;
  readonly workspaces: readonly AgentWorkspaceView[];
  readonly followed: boolean;
  readonly reading: boolean;
  readonly canFollow: boolean;
  readonly preview: boolean;
  readonly onFollow: AgentWorkspaceRowsProps['onFollow'];
  readonly onRelease?: ReleaseWorkspace;
}

function AgentRow({
  agentId,
  workspaces,
  followed,
  reading,
  canFollow,
  preview,
  onFollow,
  onRelease,
}: AgentRowProps) {
  const activeWorkspaces = workspaces.filter(workspaceIsActive);
  const hasAreas = activeWorkspaces.some(({ areas }) => areas.length > 0);
  const canUseFollow = followed || (canFollow && hasAreas);
  let followTitle: string | undefined;
  if (preview) {
    followTitle = '预览期间不能跟随，请先退出预览';
  } else if (!canUseFollow) {
    followTitle = '当前没有可跟随的工作区域';
  }

  const leadWorkspace = activeWorkspaces[0] ?? workspaces[0];
  const followName = leadWorkspace ? ' Agent：' + workspaceName(leadWorkspace) : ' Agent';
  const followAction = followed ? '停止跟随' : '跟随';
  return (
    <li className="room-presence-row room-agent-row">
      <AgentWorkspaceAvatar agentId={agentId} followed={followed} />
      <div className="room-presence-identity room-agent-identity">
        <strong>Agent</strong>
        {workspaces.length === 0 && <span>{reading ? '正在读取' : '空闲'}</span>}
        {workspaces.length > 1 && <span>{workspaces.length}个工作区</span>}
        {workspaces.map((workspace) => (
          <div className="room-agent-workspace" key={workspaceKey(workspace)}>
            <span>
              {workspaceStatus(workspace)} · {workspaceName(workspace)}
            </span>
            {onRelease && !preview && workspaceIsActive(workspace) && (
              <WorkspaceRelease workspace={workspace} onRelease={onRelease} />
            )}
          </div>
        ))}
      </div>
      <button
        className="room-presence-link"
        type="button"
        title={followTitle}
        aria-label={followAction + followName}
        disabled={preview || !canUseFollow}
        onClick={() => onFollow(agentId)}
      >
        {followAction}
      </button>
    </li>
  );
}

export function AgentWorkspaceRows({
  workspaces,
  onlineAgentIds,
  readingAgentIds,
  followedAgentId,
  ...actions
}: AgentWorkspaceRowsProps) {
  return Array.from(workspacesByAgent(workspaces, onlineAgentIds), ([agentId, entries]) => (
    <AgentRow
      key={agentId}
      agentId={agentId}
      workspaces={entries}
      followed={followedAgentId === agentId}
      reading={readingAgentIds?.includes(agentId) ?? false}
      {...actions}
    />
  ));
}
