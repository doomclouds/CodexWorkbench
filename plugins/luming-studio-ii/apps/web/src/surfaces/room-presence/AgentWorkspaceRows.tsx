import { Bot } from 'lucide-react';
import { useRef, useState, type CSSProperties } from 'react';
import type { BoardRoomAgentWorkspace } from '../../data/rooms/index.js';
import { participantColor } from './follow.js';
import './agent-workspace.css';

export type AgentWorkspaceTarget = Pick<
  BoardRoomAgentWorkspace,
  'agentId' | 'taskId' | 'generation'
>;

export interface AgentWorkspaceRowsProps {
  readonly workspaces: readonly BoardRoomAgentWorkspace[];
  readonly followedAgentId?: string;
  readonly canFollow: boolean;
  readonly preview: boolean;
  readonly onFollow: (agentId: string) => void;
  readonly onRelease?: (target: AgentWorkspaceTarget) => Promise<void>;
}

type ReleaseWorkspace = NonNullable<AgentWorkspaceRowsProps['onRelease']>;

const phases: Record<BoardRoomAgentWorkspace['phase'], string> = {
  preparing: '准备中',
  writing: '修改中',
  verifying: '检查中',
};

const releaseLabels = {
  idle: '结束此工作区',
  submitting: '正在结束…',
  finished: '已结束',
};

function workspaceKey({ taskId, generation }: AgentWorkspaceTarget) {
  return JSON.stringify([taskId, generation]);
}

function workspaceName({ label, taskId }: BoardRoomAgentWorkspace) {
  return label || taskId;
}

function workspacesByAgent(workspaces: readonly BoardRoomAgentWorkspace[]) {
  const groups = new Map<string, BoardRoomAgentWorkspace[]>();
  for (const workspace of workspaces) {
    const group = groups.get(workspace.agentId);
    if (group) {
      group.push(workspace);
    } else {
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

function WorkspaceRelease({
  workspace,
  onRelease,
}: {
  readonly workspace: BoardRoomAgentWorkspace;
  readonly onRelease: ReleaseWorkspace;
}) {
  const { agentId, taskId, generation } = workspace;
  const requestActive = useRef(false);
  const [state, setState] = useState<keyof typeof releaseLabels>('idle');
  const [failed, setFailed] = useState<string>();

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
    <div className="room-agent-release">
      <button
        className="room-agent-release-button"
        type="button"
        data-agent-task-release={taskId}
        aria-label={'结束此工作区：' + workspaceName(workspace)}
        title="结束此工作区，停止显示当前活动。"
        disabled={state !== 'idle'}
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
  readonly workspaces: readonly BoardRoomAgentWorkspace[];
  readonly followed: boolean;
  readonly canFollow: boolean;
  readonly preview: boolean;
  readonly onFollow: AgentWorkspaceRowsProps['onFollow'];
  readonly onRelease?: ReleaseWorkspace;
}

function AgentRow({
  agentId,
  workspaces,
  followed,
  canFollow,
  preview,
  onFollow,
  onRelease,
}: AgentRowProps) {
  const hasAreas = workspaces.some(({ areas }) => areas.length > 0);
  const canUseFollow = followed || (canFollow && hasAreas);
  let followTitle: string | undefined;
  if (preview) {
    followTitle = '预览期间不能跟随，请先退出预览';
  } else if (!canUseFollow) {
    followTitle = '当前没有可跟随的工作区域';
  }

  const leadWorkspace = workspaces[0];
  const followName = leadWorkspace ? ' Agent：' + workspaceName(leadWorkspace) : ' Agent';
  const followAction = followed ? '停止跟随' : '跟随';
  return (
    <li className="room-presence-row room-agent-row">
      <AgentWorkspaceAvatar agentId={agentId} followed={followed} />
      <div className="room-presence-identity room-agent-identity">
        <strong>Agent</strong>
        {workspaces.length > 1 && <span>{workspaces.length}个工作区</span>}
        {workspaces.map((workspace) => (
          <div className="room-agent-workspace" key={workspaceKey(workspace)}>
            <span>
              {phases[workspace.phase]} · {workspaceName(workspace)}
            </span>
            {onRelease && !preview && (
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
  followedAgentId,
  ...actions
}: AgentWorkspaceRowsProps) {
  return Array.from(workspacesByAgent(workspaces), ([agentId, entries]) => (
    <AgentRow
      key={agentId}
      agentId={agentId}
      workspaces={entries}
      followed={followedAgentId === agentId}
      {...actions}
    />
  ));
}
