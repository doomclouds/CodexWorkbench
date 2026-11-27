import type {
  Participant,
  ParticipantChanges,
  ParticipantKey,
  PresenceInput,
  RoomAccess,
  RoomEvent,
  RoomEventPayload,
} from '../domain/index.js';

const maxParticipants = 64;
const maxPresenceSlots = 256;
const maxSubscriptions = 64;
const presenceTtlMs = 18_000;
const tombstoneTtlMs = 30_000;
const minimumUpdateGapMs = 40;

interface PresenceSlot {
  readonly key: ParticipantKey;
  readonly sequence: bigint;
  readonly updatedAt: number;
  readonly releaseAt: number;
  readonly participant?: Participant;
}

export interface RoomListener {
  readonly deliver: (event: RoomEvent) => void;
  readonly close: () => void;
  readonly recheck?: () => void;
}

function peerKey({ actorId, viewId }: ParticipantKey): string {
  return JSON.stringify([actorId, viewId]);
}

function absent(old: PresenceSlot, now: number, sequence = old.sequence): PresenceSlot {
  return { key: old.key, sequence, updatedAt: now, releaseAt: now + tombstoneTtlMs };
}

function acceptUpdate(previous: PresenceSlot, sequence: bigint, now: number): boolean {
  const throttled =
    previous.participant !== undefined && now - previous.updatedAt < minimumUpdateGapMs;

  return previous.sequence < sequence && !throttled;
}

export class RoomMemory {
  private readonly slots = new Map<string, PresenceSlot>();
  private readonly listeners = new Set<RoomListener>();
  private readonly pending: RoomEvent[] = [];
  private delivering = false;
  private sequence = 0n;
  public baselineRevision: bigint;

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

  event(payload: RoomEventPayload, now: number): RoomEvent {
    return {
      boardId: this.boardId,
      roomInstanceId: this.roomInstanceId,
      sequence: this.sequence,
      serverTimeUnixMs: now,
      payload,
    };
  }

  publish(payload: RoomEventPayload, now: number): void {
    this.sequence++;
    this.pending.push(this.event(payload, now));
    if (this.delivering) {
      return;
    }

    this.delivering = true;
    try {
      for (const event of this.pending) {
        for (const listener of [...this.listeners]) {
          listener.deliver(event);
        }
      }
    } finally {
      this.delivering = false;
      this.pending.length = 0;
    }
  }

  listen(listener: RoomListener): (() => void) | undefined {
    if (this.listeners.size >= maxSubscriptions) {
      return undefined;
    }

    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    for (const listener of [...this.listeners]) {
      listener.close();
    }

    this.listeners.clear();
    this.slots.clear();
    this.pending.length = 0;
  }

  recheck(): void {
    for (const listener of [...this.listeners]) {
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
      } else if (slot.releaseAt <= now) {
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
    if (previous && !acceptUpdate(previous, input.sequence, now)) {
      return false;
    }
    if (!previous && this.slots.size >= maxPresenceSlots) {
      return false;
    }
    if (!previous?.participant && this.snapshot().length >= maxParticipants) {
      return false;
    }

    const participant = {
      key,
      displayName: access.displayName,
      role: access.role,
      sequence: input.sequence,
      expiresAtUnixMs: now + presenceTtlMs,
      cursor: input.cursor,
      viewport: input.viewport,
      following: input.following,
    };
    this.slots.set(id, {
      key,
      sequence: participant.sequence,
      updatedAt: now,
      releaseAt: participant.expiresAtUnixMs + tombstoneTtlMs,
      participant,
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

    this.slots.set(id, { key, sequence, updatedAt: now, releaseAt: now + tombstoneTtlMs });
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
