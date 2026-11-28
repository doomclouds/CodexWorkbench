import type {
  AgentWorkspace,
  Participant,
  ParticipantChanges,
  ParticipantKey,
  PresenceInput,
  RoomAccess,
  RoomEvent,
  RoomEventPayload,
} from '../domain/index.js';
import { RoomEventJournal, type RoomEventCursor } from './room-event-journal.js';

const maxParticipants = 64;
const maxPresenceSlots = 256;
const maxSubscriptions = 64;
const presenceTtlMs = 18_000;
const gestureTtlMs = 1200;
const snapshotGestureBudget = 128;
const tombstoneTtlMs = 30_000;
const minimumUpdateGapMs = 40;

interface PresenceSlot {
  readonly key: ParticipantKey;
  readonly sequence: bigint;
  readonly updatedAt: number;
  readonly releaseAt: number;
  readonly participant?: Participant;
  readonly streamCount?: number;
}

export interface RoomListener {
  readonly deliver: (event: RoomEvent) => void;
  readonly close: () => void;
  readonly recheck?: () => void;
}

interface PresenceConnection {
  readonly key: ParticipantKey;
  readonly now: () => number;
}

function moved(previous: Participant, next: PresenceInput): boolean {
  const cursor = previous.cursor;
  const view = previous.viewport;
  return (
    cursor?.x !== next.cursor?.x ||
    cursor?.y !== next.cursor?.y ||
    view?.centerX !== next.viewport?.centerX ||
    view?.centerY !== next.viewport?.centerY ||
    view?.zoom !== next.viewport?.zoom ||
    previous.following !== next.following
  );
}

function peerKey({ actorId, viewId }: ParticipantKey): string {
  return JSON.stringify([actorId, viewId]);
}

function absent(old: PresenceSlot, now: number, sequence = old.sequence): PresenceSlot {
  return {
    key: old.key,
    sequence,
    updatedAt: now,
    releaseAt: now + tombstoneTtlMs,
    streamCount: old.streamCount,
  };
}

function acceptUpdate(previous: PresenceSlot, sequence: bigint, now: number): boolean {
  const throttled =
    previous.participant !== undefined && now - previous.updatedAt < minimumUpdateGapMs;

  return previous.sequence < sequence && !throttled;
}

export class RoomMemory {
  private readonly slots = new Map<string, PresenceSlot>();
  private readonly listeners = new Map<RoomListener, boolean>();
  private readonly pending: { ownerEvent: RoomEvent; publicEvent?: RoomEvent }[] = [];
  private readonly ownerJournal = new RoomEventJournal();
  private readonly publicJournal = new RoomEventJournal();
  private delivering = false;
  private sequence = 0n;
  private publicSequence = 0n;
  public baselineRevision: bigint;
  public agentWorkspaces: readonly AgentWorkspace[] = [];
  public onlineAgentIds: readonly string[] = [];
  public readingAgentIds: readonly string[] = [];
  public feedbackVersion = 0n;
  public suggestionsVersion = 0n;

  constructor(
    private readonly boardId: string,
    private readonly roomInstanceId: string,
    baselineRevision: bigint,
  ) {
    this.baselineRevision = baselineRevision;
  }

  get active(): boolean {
    return this.listeners.size > 0 || this.slots.size > 0;
  }

  snapshot(): readonly Participant[] {
    const participants: Participant[] = [];
    for (const slot of this.slots.values()) {
      if (slot.participant) {
        participants.push(slot.participant);
      }
    }

    return participants;
  }

  currentParticipants(now: number): readonly Participant[] {
    let budget = snapshotGestureBudget;
    return this.snapshot().map((participant) => {
      const { gesture, gestureExpiresAtUnixMs } = participant;
      if (!gesture || gestureExpiresAtUnixMs === undefined) {
        return participant;
      }
      if (gestureExpiresAtUnixMs <= now || gesture.changes.length > budget) {
        return { ...participant, gesture: undefined, gestureExpiresAtUnixMs: undefined };
      }

      budget -= gesture.changes.length;
      return participant;
    });
  }

  private cursor(owner: boolean): RoomEventCursor {
    return {
      roomInstanceId: this.roomInstanceId + (owner ? ':owner' : ':member'),
      sequence: owner ? this.sequence : this.publicSequence,
    };
  }

  event(payload: RoomEventPayload, now: number, owner = true): RoomEvent {
    return {
      boardId: this.boardId,
      ...this.cursor(owner),
      serverTimeUnixMs: now,
      payload,
    };
  }

  replay(cursor: RoomEventCursor, owner: boolean): readonly RoomEvent[] | undefined {
    const journal = owner ? this.ownerJournal : this.publicJournal;

    return journal.after(cursor, this.cursor(owner));
  }

  publish(payload: RoomEventPayload, now: number): void {
    this.sequence++;
    const ownerEvent = this.event(payload, now);
    this.ownerJournal.append(ownerEvent);
    let publicEvent: RoomEvent | undefined;
    if (payload.kind !== 'suggestionsChanged') {
      this.publicSequence++;
      publicEvent = this.event(payload, now, false);
      this.publicJournal.append(publicEvent);
    }
    this.pending.push({ ownerEvent, publicEvent });
    if (this.delivering) {
      return;
    }

    this.delivering = true;
    try {
      for (const publication of this.pending) {
        [...this.listeners].forEach(([listener, owner]) => {
          const event = owner ? publication.ownerEvent : publication.publicEvent;
          if (event) {
            listener.deliver(event);
          }
        });
      }
    } finally {
      this.delivering = false;
      this.pending.length = 0;
    }
  }

  private retainStream(key: ParticipantKey, now: number): boolean {
    const id = peerKey(key);
    const previous = this.slots.get(id);
    if (!previous && this.slots.size >= maxPresenceSlots) {
      return false;
    }

    const slot: PresenceSlot = previous ?? { key, sequence: 0n, updatedAt: now, releaseAt: now };
    this.slots.set(id, { ...slot, streamCount: (slot.streamCount ?? 0) + 1 });

    return true;
  }

  private releaseStream(key: ParticipantKey, now: number): void {
    const id = peerKey(key);
    const previous = this.slots.get(id);
    if (!previous?.streamCount) {
      return;
    }

    if (previous.streamCount > 1) {
      this.slots.set(id, { ...previous, streamCount: previous.streamCount - 1 });
      return;
    }

    this.slots.set(id, { ...absent(previous, now), streamCount: 0 });
    if (previous.participant) {
      this.change({ upserts: [], removals: [key] }, now);
    }
  }

  listen(
    listener: RoomListener,
    owner = true,
    connection?: PresenceConnection,
  ): (() => void) | undefined {
    if (this.listeners.size >= maxSubscriptions) {
      return undefined;
    }
    if (connection && !this.retainStream(connection.key, connection.now())) {
      return undefined;
    }

    this.listeners.set(listener, owner);

    return () => {
      if (this.listeners.delete(listener) && connection) {
        this.releaseStream(connection.key, connection.now());
      }
    };
  }

  close(): void {
    const listeners = [...this.listeners.keys()];
    this.listeners.clear();
    for (const listener of listeners) {
      listener.close();
    }

    this.slots.clear();
    this.pending.length = 0;
  }

  recheck(): void {
    for (const listener of [...this.listeners.keys()]) {
      listener.recheck?.();
    }
  }

  private change(changes: ParticipantChanges, now: number): void {
    this.publish({ kind: 'participants', changes }, now);
  }

  sweep(now: number): void {
    const removals: ParticipantKey[] = [];
    for (const [id, slot] of this.slots) {
      if (slot.participant) {
        if (slot.participant.expiresAtUnixMs <= now) {
          this.slots.set(id, absent(slot, now));
          removals.push(slot.key);
        }
      } else if (!slot.streamCount && slot.releaseAt <= now) {
        this.slots.delete(id);
      }
    }

    if (removals.length) {
      this.change({ upserts: [], removals }, now);
    }
  }

  update(actorId: string, input: PresenceInput, access: RoomAccess, now: number): boolean {
    this.sweep(now);
    const key = { actorId, viewId: input.viewId };
    const id = peerKey(key);
    const previous = this.slots.get(id);
    if (previous?.streamCount === 0) {
      return false;
    }
    if (previous && !acceptUpdate(previous, input.sequence, now)) {
      return false;
    }
    if (!previous && this.slots.size >= maxPresenceSlots) {
      return false;
    }
    if (!previous?.participant && this.snapshot().length >= maxParticipants) {
      return false;
    }

    const prior = previous?.participant;
    const editingObjectIds = input.editingObjectIds?.length
      ? [...new Set(input.editingObjectIds)].sort()
      : undefined;
    const participant = {
      key,
      displayName: access.displayName,
      role: access.role,
      sequence: input.sequence,
      expiresAtUnixMs: now + presenceTtlMs,
      activityAtUnixMs: prior && !moved(prior, input) ? (prior.activityAtUnixMs ?? now) : now,
      cursor: input.cursor,
      viewport: input.viewport,
      following: input.following,
      gesture: input.gesture,
      gestureExpiresAtUnixMs: input.gesture && now + gestureTtlMs,
      editingObjectIds,
    };
    this.slots.set(id, {
      key,
      sequence: participant.sequence,
      updatedAt: now,
      releaseAt: participant.expiresAtUnixMs + tombstoneTtlMs,
      participant,
      streamCount: previous?.streamCount,
    });
    this.change({ upserts: [participant], removals: [] }, now);

    return true;
  }

  leave(key: ParticipantKey, sequence: bigint, now: number): boolean {
    this.sweep(now);
    const id = peerKey(key);
    const previous = this.slots.get(id);
    if (previous && previous.sequence >= sequence) {
      return false;
    }
    if (!previous && this.slots.size >= maxPresenceSlots) {
      return false;
    }

    const next = previous
      ? absent(previous, now, sequence)
      : { key, sequence, updatedAt: now, releaseAt: now + tombstoneTtlMs };
    this.slots.set(id, next);
    if (previous?.participant) {
      this.change({ upserts: [], removals: [key] }, now);
    }

    return true;
  }

  revoke(key: ParticipantKey, now: number): void {
    const id = peerKey(key);
    const slot = this.slots.get(id);
    if (slot?.participant) {
      this.slots.set(id, absent(slot, now));
      this.change({ upserts: [], removals: [key] }, now);
    }
  }
}
