import { useEffect, useEffectEvent, useRef } from 'react';
import type { BoardRoomAgentWorkspace } from '../../data/rooms/index.js';
import {
  fitAgentWorkspaceViewport,
  type AgentWorkspaceFollowFrame,
} from './agent-workspace-follow.js';
import type { RoomPresenceCamera, RoomPresenceViewport } from './follow.js';

interface PriorFrame extends AgentWorkspaceFollowFrame {
  readonly agentId: string;
}

function sameCamera(a: RoomPresenceCamera, b: RoomPresenceCamera) {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

export function useAgentWorkspaceCamera(
  agentId: string | undefined,
  workspaces: readonly BoardRoomAgentWorkspace[],
  viewport: RoomPresenceViewport | undefined,
  available: boolean,
  onViewportRequest: (camera: RoomPresenceCamera) => void,
) {
  const prior = useRef<PriorFrame>(undefined);
  const width = viewport?.width;
  const height = viewport?.height;
  const focus = useEffectEvent((id: string, scopes: readonly BoardRoomAgentWorkspace[]) => {
    const earlier = prior.current?.agentId === id ? prior.current : undefined;
    const next = fitAgentWorkspaceViewport(
      scopes.filter(({ agentId: owner }) => owner === id),
      viewport,
      earlier,
    );

    if (next) {
      prior.current = { agentId: id, ...next };
      if (!earlier || !sameCamera(next.camera, earlier.camera)) {
        onViewportRequest(next.camera);
      }
    }
  });

  useEffect(() => {
    if (!agentId) {
      prior.current = undefined;
    } else if (available) {
      focus(agentId, workspaces);
    }
  }, [agentId, available, workspaces, width, height]);
}
