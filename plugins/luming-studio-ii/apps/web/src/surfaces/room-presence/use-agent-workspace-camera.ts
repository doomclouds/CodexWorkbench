import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import type { BoardRoomAgentWorkspace, BoardRoomSession } from '../../data/rooms/index.js';
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

function moveCamera(
  from: RoomPresenceCamera | undefined,
  target: RoomPresenceCamera,
  scheduleFrame: BoardRoomSession['scheduleFrame'],
  render: (camera: RoomPresenceCamera) => void,
) {
  if (!from || !scheduleFrame || sameCamera(from, target)) {
    render(target);
    return;
  }

  const { x, y, zoom } = from;
  let start: number | undefined;
  let frame: (() => void) | undefined;
  const step = (now: number) => {
    start ??= now;
    const progress = Math.max(0, Math.min(1, (now - start) / 90));
    frame = progress < 1 ? scheduleFrame(step) : undefined;
    if (!frame) {
      render(target);
    } else if (progress > 0) {
      const eased = progress * progress * (3 - 2 * progress);
      render({
        x: x + (target.x - x) * eased,
        y: y + (target.y - y) * eased,
        zoom: zoom + (target.zoom - zoom) * eased,
      });
    }
  };
  frame = scheduleFrame(step);
  if (!frame) {
    render(target);
  }

  return () => frame?.();
}

export function useAgentWorkspaceCamera(
  scheduleFrame: BoardRoomSession['scheduleFrame'],
  agentId: string | undefined,
  workspaces: readonly BoardRoomAgentWorkspace[],
  viewport: RoomPresenceViewport | undefined,
  available: boolean,
  onViewportRequest: (camera: RoomPresenceCamera) => void,
) {
  const prior = useRef<PriorFrame>(undefined);
  const rendered = useRef<RoomPresenceCamera>(undefined);
  const cancel = useRef<(() => void) | undefined>(undefined);
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
        cancel.current?.();
        cancel.current = moveCamera(
          rendered.current ?? viewport,
          next.camera,
          scheduleFrame,
          (camera) => {
            rendered.current = camera;
            onViewportRequest(camera);
          },
        );
      }
    }
  });

  useLayoutEffect(() => {
    if (!agentId || !available) {
      return;
    }

    return () => {
      cancel.current?.();
      cancel.current = undefined;
      prior.current = undefined;
      rendered.current = undefined;
    };
  }, [agentId, available]);
  useLayoutEffect(() => {
    if (agentId && available) {
      focus(agentId, workspaces);
    }
  }, [agentId, available, workspaces, width, height]);
}
