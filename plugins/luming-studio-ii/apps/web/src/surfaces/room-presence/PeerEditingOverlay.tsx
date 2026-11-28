import type {
  BoardRoomGestureGeometry,
  BoardRoomParticipant,
  BoardRoomSession,
} from '../../data/rooms/index.js';
import { cursorLabelColor, participantColor, type RoomPresenceViewport } from './follow.js';
import { useRoomEditingSnapshot } from './room-snapshot.js';
import './peer-editing.css';

interface PeerEditingOverlayProps {
  readonly session: BoardRoomSession;
  readonly viewport: RoomPresenceViewport;
  readonly objectGeometry?: ReadonlyMap<string, BoardRoomGestureGeometry>;
}

interface EditingTarget {
  readonly id: string;
  readonly editor: BoardRoomParticipant;
  readonly geometry: BoardRoomGestureGeometry;
  readonly slot: number;
}

function roomEditingTargets(
  participants: readonly BoardRoomParticipant[],
  viewer: string | undefined,
  objectGeometry: NonNullable<PeerEditingOverlayProps['objectGeometry']>,
) {
  const editors = new Map<string, Set<string>>();
  const targets: EditingTarget[] = [];
  for (const editor of participants) {
    if (editor.actorId === viewer || !editor.editingObjectIds) {
      continue;
    }

    for (const id of editor.editingObjectIds) {
      const geometry = objectGeometry.get(id);
      const current = editors.get(id) ?? new Set<string>();
      if (geometry && !current.has(editor.actorId)) {
        targets.push({ id, editor, geometry, slot: current.size });
        current.add(editor.actorId);
        editors.set(id, current);
      }
    }
  }

  return targets;
}

function projectEditingTarget(geometry: BoardRoomGestureGeometry, viewport: RoomPresenceViewport) {
  const { zoom } = viewport;
  const x = geometry.x * zoom + viewport.x;
  const y = geometry.y * zoom + viewport.y;
  const width = geometry.width * zoom;
  const height = geometry.height * zoom;
  const angle = (geometry.rotation * Math.PI) / 180;
  const rotatedWidth = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle));
  const rotatedHeight = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle));
  const left = x + (width - rotatedWidth) / 2;
  const top = y + (height - rotatedHeight) / 2;
  const right = left + rotatedWidth;
  const bottom = top + rotatedHeight;
  const visible = right > 0 && bottom > 0 && left < viewport.width && top < viewport.height;

  return visible ? { x, y, width, height, left, top, bottom } : undefined;
}

const labelGap = 4;
const labelHeight = 18;
const labelWidthLimit = 180;

function PeerEditingTarget({
  target,
  viewport,
}: {
  readonly target: EditingTarget;
  readonly viewport: RoomPresenceViewport;
}) {
  const { id, editor, geometry, slot } = target;
  const screen = projectEditingTarget(geometry, viewport);
  if (!screen) {
    return null;
  }

  const color = participantColor(editor.actorId);
  const label = editor.displayName + ' · 正在编辑';
  const maxWidth = Math.min(labelWidthLimit, Math.max(0, viewport.width - labelGap * 2));
  const offset = slot * (labelHeight + 2);
  const above = screen.top - labelHeight - labelGap - offset;
  const preferredTop = above >= labelGap ? above : screen.bottom + labelGap + offset;
  const labelTop = Math.max(labelGap, Math.min(preferredTop, viewport.height - labelHeight));
  const labelLeft = Math.max(labelGap, Math.min(screen.left, viewport.width - maxWidth - labelGap));

  return (
    <div
      role="status"
      aria-label={label}
      data-peer-target={id}
      data-peer-state="editing"
      className="room-peer-editing__target"
      style={{ left: screen.x, top: screen.y, width: screen.width, height: screen.height }}
    >
      <div
        className="room-peer-editing__outline"
        aria-hidden="true"
        style={{
          inset: -2 - slot * 3,
          borderColor: color,
          transform: geometry.rotation ? `rotate(${geometry.rotation}deg)` : undefined,
        }}
      />
      <span
        className="room-peer-editing__label"
        style={{
          left: labelLeft - screen.x,
          top: labelTop - screen.y,
          maxWidth,
          backgroundColor: color,
          color: cursorLabelColor(color),
        }}
      >
        {label}
      </span>
    </div>
  );
}

export function PeerEditingOverlay({ session, viewport, objectGeometry }: PeerEditingOverlayProps) {
  const { participants, actorId, status } = useRoomEditingSnapshot(session);
  if (status !== 'online' || !objectGeometry?.size) {
    return null;
  }

  const targets = roomEditingTargets(participants, actorId, objectGeometry);
  if (targets.length === 0) {
    return null;
  }

  return (
    <div className="room-peer-editing">
      {targets.map((target) => (
        <PeerEditingTarget
          key={JSON.stringify([target.editor.actorId, target.id])}
          target={target}
          viewport={viewport}
        />
      ))}
    </div>
  );
}
