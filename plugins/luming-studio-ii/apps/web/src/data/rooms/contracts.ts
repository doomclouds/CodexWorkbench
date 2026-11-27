export interface BoardRoomPoint {
  readonly x: number;
  readonly y: number;
}

export interface BoardRoomViewport {
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
}

export interface BoardRoomParticipantKey {
  readonly actorId: string;
  readonly viewId: string;
}

export interface BoardRoomGestureGeometry extends BoardRoomPoint {
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

export interface BoardRoomGestureChange {
  readonly id: string;
  readonly expectedVersion: number;
  readonly geometry: BoardRoomGestureGeometry;
}

export interface BoardRoomGesturePreview {
  readonly kind: 'move' | 'resize' | 'rotate';
  readonly changes: readonly BoardRoomGestureChange[];
}

export interface BoardRoomPresence {
  readonly cursor?: BoardRoomPoint;
  readonly viewport?: BoardRoomViewport;
  readonly following: boolean;
  readonly gesture?: BoardRoomGesturePreview;
}

export interface BoardRoomParticipant extends BoardRoomParticipantKey, BoardRoomPresence {
  readonly displayName: string;
  readonly role: string;
  readonly sequence: bigint;
  readonly expiresAtMillis: number;
  readonly activityAtMillis?: number;
  readonly gestureExpiresAtMillis?: number;
}

export interface BoardRoomTimer {
  readonly version: bigint;
  readonly phase: 'idle' | 'running' | 'paused' | 'ended';
  readonly durationMs: number;
  readonly deadlineUnixMs?: number;
  readonly remainingMs: number;
}

export type BoardRoomTimerAction =
  | { readonly kind: 'start' | 'pause' | 'resume' | 'reset' }
  | { readonly kind: 'setDuration'; readonly durationMs: number }
  | { readonly kind: 'adjustDuration'; readonly deltaMs: number };

export interface BoardRoomTimerCommand {
  readonly commandId: string;
  readonly expectedVersion: bigint;
  readonly action: BoardRoomTimerAction;
}

export type BoardRoomTimerReceipt =
  | {
      readonly commandId: string;
      readonly kind: 'applied' | 'conflict';
      readonly timer: BoardRoomTimer;
    }
  | {
      readonly commandId: string;
      readonly kind: 'rejected';
      readonly reason: 'forbidden' | 'invalidAction' | 'commandIdReuse';
    };

interface RoomEventHeader {
  readonly boardId: string;
  readonly instanceId: string;
  readonly sequence: bigint;
  readonly serverTimeUnixMs: number;
}

type RoomEventPayload =
  | {
      readonly kind: 'snapshot';
      readonly actorId: string;
      readonly canEdit: boolean;
      readonly revision: bigint;
      readonly participants: readonly BoardRoomParticipant[];
      readonly timer: BoardRoomTimer;
      readonly agentWorkspaces?: readonly BoardRoomAgentWorkspace[];
      readonly canReleaseAgentActivity?: boolean;
      readonly feedbackVersion?: bigint;
      readonly suggestionsVersion?: bigint;
    }
  | {
      readonly kind: 'participants';
      readonly upserts: readonly BoardRoomParticipant[];
      readonly removals: readonly BoardRoomParticipantKey[];
    }
  | { readonly kind: 'timer'; readonly timer: BoardRoomTimer }
  | { readonly kind: 'contentChanged'; readonly change: BoardRoomContentChange }
  | { readonly kind: 'feedbackChanged' | 'suggestionsChanged'; readonly version: bigint }
  | { readonly kind: 'agentWorkspaces'; readonly workspaces: readonly BoardRoomAgentWorkspace[] }
  | { readonly kind: 'accessLost' };

export type BoardRoomEvent = RoomEventHeader & RoomEventPayload;

export type BoardRoomPost = (
  path: string,
  body: Uint8Array,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

export type BoardRoomEventPort = (
  boardId: string,
  viewId: string,
  callbacks: {
    readonly onEvent: (text: string) => void;
    readonly onDisconnect: (reason?: 'accessLost') => void;
  },
  signal: AbortSignal,
) => void;

export interface BoardRoomStreamObserver {
  readonly onEvent: (event: BoardRoomEvent) => void;
  readonly onDisconnect: (reason?: 'accessLost', error?: unknown) => void;
}

export interface BoardRoomTimerReply {
  readonly receipt?: BoardRoomTimerReceipt;
  readonly serverTimeUnixMs: number;
}

export interface BoardRoomService {
  subscribe(
    boardId: string,
    viewId: string,
    observer: BoardRoomStreamObserver,
    signal: AbortSignal,
  ): void;
  getRoom(boardId: string, signal?: AbortSignal): Promise<BoardRoomEvent>;
  updatePresence(
    boardId: string,
    viewId: string,
    sequence: bigint,
    presence: BoardRoomPresence,
    signal?: AbortSignal,
  ): Promise<boolean>;
  leavePresence(
    boardId: string,
    viewId: string,
    sequence: bigint,
    signal?: AbortSignal,
  ): Promise<boolean>;
  changeTimer(
    boardId: string,
    command: BoardRoomTimerCommand,
    signal?: AbortSignal,
  ): Promise<BoardRoomTimerReply>;
  getTimerReceipt(
    boardId: string,
    commandId: string,
    signal?: AbortSignal,
  ): Promise<BoardRoomTimerReply>;
  releaseAgentWorkspace?(
    boardId: string,
    target: BoardRoomAgentWorkspaceTarget,
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface BoardRoomClock {
  readonly now: () => number;
  readonly schedule: (delayMs: number, task: () => void) => () => void;
}

export interface BoardRoomState {
  readonly status: 'connecting' | 'online' | 'reconnecting' | 'accessLost';
  readonly viewId: string;
  readonly actorId?: string;
  readonly boardRevision?: bigint;
  readonly canEdit: boolean;
  readonly participants: readonly BoardRoomParticipant[];
  readonly timer?: BoardRoomTimer;
  readonly notice?: string;
  readonly agentWorkspaces?: readonly BoardRoomAgentWorkspace[];
  readonly canReleaseAgentActivity?: boolean;
  readonly feedbackUpdateKey?: string;
  readonly suggestionsUpdateKey?: string;
}

export interface BoardRoomObserver {
  readonly onContentChanged?: (change: BoardRoomContentChange) => void;
  readonly onAccessLost?: () => void;
}

export interface BoardRoomSession {
  open(observer?: BoardRoomObserver): () => void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): BoardRoomState;
  publishPresence(presence: BoardRoomPresence): void;
  changeTimer(command: BoardRoomTimerCommand, signal?: AbortSignal): Promise<BoardRoomTimerReceipt>;
  getTimerReceipt(
    commandId: string,
    signal?: AbortSignal,
  ): Promise<BoardRoomTimerReceipt | undefined>;
  now(): number;
  releaseAgentWorkspace?(target: BoardRoomAgentWorkspaceTarget): Promise<void>;
  schedule(delayMs: number, task: () => void): () => void;
}

export interface BoardRoomSessionOptions {
  readonly boardId: string;
  readonly viewId: string;
  readonly service: BoardRoomService;
  readonly clock: BoardRoomClock;
  readonly observation?: 'snapshot';
}

import type { BoardRoomContentChange } from './room-message.js';
import type { BoardRoomAgentWorkspace, BoardRoomAgentWorkspaceTarget } from './agent-workspaces.js';
