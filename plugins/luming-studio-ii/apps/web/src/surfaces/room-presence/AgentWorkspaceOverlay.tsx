import { Bot } from 'lucide-react';
import type { CSSProperties } from 'react';
import { WorkspaceRelease, type AgentWorkspaceRowsProps } from './AgentWorkspaceRows.js';
import {
  workspaceIsActive,
  workspaceName,
  workspaceStatus,
  type AgentWorkspaceView,
} from './agent-workspace-view.js';
import { cursorLabelColor, participantColor, type RoomPresenceViewport } from './follow.js';
import './agent-workspace.css';

interface AgentWorkspaceOverlayProps {
  readonly workspaces: readonly AgentWorkspaceView[];
  readonly viewport: RoomPresenceViewport;
  readonly onRelease?: AgentWorkspaceRowsProps['onRelease'];
  readonly onCanvasFocus?: () => void;
}

type Area = AgentWorkspaceView['areas'][number];

function AgentWorkingMark({ motion }: { readonly motion: 'running' | 'paused' }) {
  return (
    <span className="room-agent-working-mark" data-agent-motion={motion} aria-hidden="true">
      <Bot size={13} aria-hidden="true" />
      <svg className="room-agent-working-orbit" width="19" height="19" viewBox="0 0 20 20">
        <g fill="currentColor">
          <circle cx="10" cy="1.5" r="1" />
          <circle cx="18.5" cy="10" r="1" />
          <circle cx="10" cy="18.5" r="1" />
          <circle cx="1.5" cy="10" r="1" />
        </g>
      </svg>
    </span>
  );
}

function projectArea(area: Area, viewport: RoomPresenceViewport) {
  const { bounds } = area;
  const left = bounds.x * viewport.zoom + viewport.x;
  const top = bounds.y * viewport.zoom + viewport.y;
  const width = bounds.width * viewport.zoom;
  const height = bounds.height * viewport.zoom;
  const visible =
    left + width > 0 && top + height > 0 && left < viewport.width && top < viewport.height;

  return visible ? { id: area.id, active: area.active, left, top, width, height } : undefined;
}

function WorkspaceFrame({
  workspace,
  viewport,
  onRelease,
  onCanvasFocus,
}: Omit<AgentWorkspaceOverlayProps, 'workspaces'> & {
  readonly workspace: AgentWorkspaceView;
}) {
  const ended = !workspaceIsActive(workspace);
  const animated = !ended && workspace.state !== 'stale';
  const areas = workspace.areas.flatMap((area) => {
    const screen = projectArea(area, viewport);

    return screen ? [screen] : [];
  });
  const labeledArea = (animated && areas.find(({ active }) => active)) || areas[0];
  if (!labeledArea) {
    return null;
  }

  const color = participantColor(workspace.agentId);
  const style = {
    '--agent-workspace-color': color,
    '--agent-workspace-label-ink': cursorLabelColor(color),
    '--agent-workspace-play-state': animated ? 'running' : 'paused',
    '--agent-workspace-fade': `${workspace.fadeMillis ?? 0}ms`,
  } as CSSProperties;
  const gap = 4;
  const labelHeight = 25;
  const labelWidth = Math.max(0, Math.min(260, viewport.width - gap * 2));
  const labelLeft = Math.max(gap, Math.min(labeledArea.left, viewport.width - labelWidth - gap));
  const labelTop = Math.max(gap, labeledArea.top - labelHeight - gap);

  return (
    <div
      className="room-agent-workspace-frame"
      data-agent-task={workspace.taskId}
      data-agent-state={workspace.state}
      data-agent-generation={workspace.generation}
      data-agent-terminal={ended || undefined}
      style={style}
    >
      {areas.map(({ id, active, left, top, width, height }) => (
        <div
          key={id}
          className="room-agent-workspace-outline"
          data-agent-workspace-area={id}
          data-agent-label-area={id === labeledArea.id || undefined}
          data-active-area={(animated && active) || undefined}
          style={{ left, top, width, height }}
          aria-hidden="true"
        />
      ))}
      <div
        className="room-agent-workspace-label"
        style={{ left: labelLeft, top: labelTop, maxWidth: labelWidth }}
      >
        <AgentWorkingMark motion={animated ? 'running' : 'paused'} />
        <span role="status">
          {workspaceStatus(workspace)} · {workspaceName(workspace)}
        </span>
        <span className="room-agent-working-dots" aria-hidden="true">
          <i>.</i>
          <i>.</i>
          <i>.</i>
        </span>
        {!ended && onRelease && (
          <WorkspaceRelease
            workspace={workspace}
            onRelease={onRelease}
            canvas
            onCanvasFocus={onCanvasFocus}
          />
        )}
      </div>
    </div>
  );
}

export function AgentWorkspaceOverlay({ workspaces, ...frame }: AgentWorkspaceOverlayProps) {
  if (!workspaces.length) {
    return null;
  }

  return (
    <div className="room-agent-workspace-overlay">
      {workspaces.map((workspace) => (
        <WorkspaceFrame
          key={JSON.stringify([workspace.agentId, workspace.taskId, workspace.generation])}
          workspace={workspace}
          {...frame}
        />
      ))}
    </div>
  );
}
