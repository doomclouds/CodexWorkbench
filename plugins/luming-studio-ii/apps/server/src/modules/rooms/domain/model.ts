export type RoomRole = 'owner' | 'editor' | 'commenter' | 'viewer';

export interface RoomAccess {
  readonly role: RoomRole;
  readonly displayName: string;
  readonly canEdit: boolean;
  readonly boardRevision: bigint;
}

export interface RoomPoint {
  readonly x: number;
  readonly y: number;
}

export interface RoomViewport {
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

export interface ParticipantKey {
  readonly actorId: string;
  readonly viewId: string;
}

export interface GestureGeometry extends RoomPoint {
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

export interface GestureChange {
  readonly objectId: string;
  readonly expectedGeometryVersion: bigint;
  readonly geometry: GestureGeometry;
}

export interface GesturePreview {
  readonly kind: 'move' | 'resize' | 'rotate';
  readonly changes: readonly GestureChange[];
}

export interface PresenceInput {
  readonly viewId: string;
  readonly sequence: bigint;
  readonly cursor?: RoomPoint;
  readonly viewport?: RoomViewport;
  readonly following: boolean;
  readonly gesture?: GesturePreview;
  readonly editingObjectIds?: readonly string[];
}

export interface Participant {
  readonly key: ParticipantKey;
  readonly displayName: string;
  readonly role: RoomRole;
  readonly sequence: bigint;
  readonly expiresAtUnixMs: number;
  readonly activityAtUnixMs?: number;
  readonly cursor?: RoomPoint;
  readonly viewport?: RoomViewport;
  readonly following: boolean;
  readonly gesture?: GesturePreview;
  readonly gestureExpiresAtUnixMs?: number;
  readonly editingObjectIds?: readonly string[];
}

export interface ParticipantChanges {
  readonly upserts: readonly Participant[];
  readonly removals: readonly ParticipantKey[];
}

export interface RoomTimerState {
  readonly version: bigint;
  readonly durationMs: number;
  readonly deadlineUnixMs?: number;
  readonly pausedRemainingMs?: number;
}

export type RoomTimerPhase = 'idle' | 'running' | 'paused' | 'ended';

export interface RoomTimer {
  readonly version: bigint;
  readonly phase: RoomTimerPhase;
  readonly durationMs: number;
  readonly deadlineUnixMs?: number;
  readonly remainingMs: number;
}

export type TimerAction =
  | { readonly kind: 'start' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'resume' }
  | { readonly kind: 'reset' }
  | { readonly kind: 'setDuration'; readonly milliseconds: number }
  | { readonly kind: 'adjustDuration'; readonly milliseconds: number };

export interface TimerCommandKey {
  readonly boardId: string;
  readonly commandId: string;
}

export interface TimerCommand extends TimerCommandKey {
  readonly expectedVersion: bigint;
  readonly action: TimerAction;
}

export type TimerRejection = 'forbidden' | 'invalidAction' | 'commandIdReuse';

export type TimerOutcome =
  | { readonly kind: 'applied'; readonly timer: RoomTimer }
  | { readonly kind: 'conflict'; readonly timer: RoomTimer }
  | { readonly kind: 'rejected'; readonly reason: TimerRejection };

export interface RoomTimerReceipt extends TimerCommandKey {
  readonly outcome: TimerOutcome;
}

export interface StoredTimerReceipt {
  readonly signature: string;
  readonly receipt: RoomTimerReceipt;
}

export interface RoomSnapshot {
  readonly actorId: string;
  readonly canEdit: boolean;
  readonly boardRevision: bigint;
  readonly participants: readonly Participant[];
  readonly timer: RoomTimer;
  readonly agentWorkspaces: readonly AgentWorkspace[];
  readonly onlineAgentIds?: readonly string[];
  readonly readingAgentIds?: readonly string[];
  readonly canReleaseAgentActivity: boolean;
  readonly feedbackVersion?: bigint;
  readonly suggestionsVersion?: bigint;
}

export interface RoomContentChange {
  readonly boardId: string;
  readonly boardRevision: bigint;
  readonly changedObjectIds?: readonly string[];
  readonly removedObjectIds?: readonly string[];
  readonly changedObjects?: readonly Uint8Array[];
  readonly refreshScene?: boolean;
}

export type RoomEventPayload =
  | { readonly kind: 'snapshot'; readonly snapshot: RoomSnapshot }
  | { readonly kind: 'participants'; readonly changes: ParticipantChanges }
  | { readonly kind: 'timer'; readonly timer: RoomTimer }
  | { readonly kind: 'contentChanged'; readonly change: RoomContentChange }
  | { readonly kind: 'feedbackChanged' | 'suggestionsChanged'; readonly version: bigint }
  | {
      readonly kind: 'agentWorkspaces';
      readonly workspaces: readonly AgentWorkspace[];
      readonly onlineAgentIds?: readonly string[];
      readonly readingAgentIds?: readonly string[];
    }
  | { readonly kind: 'accessLost' };

export interface RoomEvent {
  readonly boardId: string;
  readonly roomInstanceId: string;
  readonly sequence: bigint;
  readonly serverTimeUnixMs: number;
  readonly payload: RoomEventPayload;
}

import type { AgentWorkspace } from './agent-activity.js';
