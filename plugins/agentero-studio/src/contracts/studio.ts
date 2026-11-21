import type { Proposal } from './proposals.js';
import type { DocumentContent } from './document.js';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
export interface Actor {
  id: string;
  name: string;
  kind: 'human' | 'agent';
  role: Role;
  presentationId?: string;
}
export interface ShareMember {
  id: string;
  name: string;
  role: Exclude<Role, 'owner'>;
  joinedAt: string;
  lastSeenAt: string;
  active: boolean;
  online: boolean;
}
export interface Artifact {
  id: string;
  type: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  trashedAt?: string;
  thumbnail?: string;
  sharing?: boolean;
  storageStatus?: 'unsupported';
  importedFrom?: { artifactId: string; title: string; createdAt: string; importedAt: string };
}
export interface StyleProfile {
  name: string;
  paper: string;
  ink: string;
  muted: string;
  accent: string;
  link: string;
  fontFamily: string;
  titleFont: string;
  monoFont: string;
  [key: string]: string;
}

export const ELEMENT_TYPES = [
  'shape',
  'container',
  'text',
  'stroke',
  'arrow',
  'image',
  'html',
  'document',
  'table',
  'link',
  'note',
  'sticker',
  'diagram',
  'chart',
  'todo',
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];
export interface BoardElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  version: number;
  text?: string;
  kind?: string;
  color?: string;
  stroke?: string;
  fill?: string;
  fontSize?: number;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  rotation?: number;
  parentId?: string;
  groupId?: string;
  locked?: boolean;
  hollow?: boolean;
  strokeWidth?: number;
  heads?: ('none' | 'arrow' | 'circle')[];
  crop?: { zoom: number; x: number; y: number };
  from?: string | [number, number];
  to?: string | [number, number];
  fromSide?: string;
  toSide?: string;
  label?: string;
  dash?: boolean;
  head?: string;
  points?: number[];
  bends?: (number | 'h' | 'v')[];

  labelOffset?: { x: number; y: number };
  labelSize?: { w: number; h: number };
  src?: string;
  video?: string;
  html?: string;
  sourceRevision?: number;
  state?: Json;
  href?: string;
  document?: DocumentContent;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface ArtifactView {
  artifact: Artifact;
}
export interface HtmlRegionContent {
  id: string;
  version: number;
  html?: string;
  sourceRevision?: number;
  text?: string;
  state?: Json;
}
export interface Board extends ArtifactView {
  elements: BoardElement[];
  style: StyleProfile;
  motion?: Record<string, unknown>;
  orderVersion?: number;
}

export interface CommentPin {
  coordinateSpace: 'board' | 'document' | 'todo';
  x: number;
  y: number;
}

export function isCommentPin(value: unknown): value is CommentPin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const pin = value as Record<string, unknown>;
  if (
    pin.coordinateSpace !== 'board' &&
    pin.coordinateSpace !== 'document' &&
    pin.coordinateSpace !== 'todo'
  ) {
    return false;
  }

  return [pin.x, pin.y].every(
    (coordinate) =>
      typeof coordinate === 'number' &&
      Number.isFinite(coordinate) &&
      (pin.coordinateSpace === 'board'
        ? Math.abs(coordinate) <= 10_000_000
        : coordinate >= 0 && coordinate <= 1),
  );
}

export interface Anchor {
  coordinateSpace?: 'board' | 'element' | 'html' | 'document' | 'todo';
  elementIds?: string[];
  regionId?: string;
  targetIds?: string[];
  sourceRevision?: number;
  blockIds?: string[];
  itemId?: string;
  sourceVersion?: number;
  quote?: string;
  excerpt?: string;
  selector?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  pin?: CommentPin;
}
export interface FeedbackAttachment {
  requestId: string;
  contentKey: string;
  state: 'pending' | 'attached';
  requestedAt: string;
  requestedBy: Actor;
  attachedAt?: string;
  attachedBy?: Actor;
}
export interface Feedback {
  id: string;
  artifactId: string;
  type: 'comment' | 'request';
  anchor: Anchor;
  author: Actor;
  text: string;
  status: 'open' | 'pending' | 'processing' | 'resolved';
  createdAt: string;
  updatedAt: string;
  replies: { id: string; author: Actor; text: string; createdAt: string }[];
  targetViewId?: string;
  versions?: Record<string, number>;
  proposal?: Proposal;
  processingBy?: Actor;
  attachment?: FeedbackAttachment;
}
export interface HistoryEntry {
  id: string;
  revision: number;
  createdAt: string;
  actor: Actor;
  summary: string;
  changedIds: string[];
  restoredFrom?: string;
  restoreMode?: 'undo';
}

export interface HistoryBatch extends HistoryEntry {
  firstVersionId: string;
  firstRevision: number;
  firstCreatedAt: string;
  beforeVersionId?: string;
  versionIds: string[];
}
export interface AgentActivityScope {
  ids?: string[];
  rect?: { x: number; y: number; w: number; h: number };
}

export const AGENT_TASK_LEASE_MS = 10 * 60_000;
export const AGENT_TASK_STALE_MS = 2 * 60_000;
export const AGENT_TASK_FADE_MS = 500;

export type AgentTaskPhase = 'preparing' | 'writing' | 'verifying';
export type AgentTaskOutcome = 'completed' | 'failed' | 'cancelled' | 'expired' | 'released';
export interface AgentTaskBinding {
  taskId: string;
  generation: string;
}
export interface AgentTaskReleaseTarget extends AgentTaskBinding {
  artifactId: string;
  targetActorId: string;
}
export interface AgentTask extends AgentTaskBinding {
  scope: AgentActivityScope;
  phase: AgentTaskPhase;
  label?: string;
  startedAt: number;
  lastActivityAt: number;
  lastProgressAt: number;
  expiresAt: number;
  endedAt?: number;
  outcome?: AgentTaskOutcome;
}
export interface ViewContext {
  viewId: string;
  artifactId: string;
  selectedIds: string[];
  viewport?: { x: number; y: number; zoom: number };
  editingIds?: string[];
  savingIds?: string[];
  agentTasks?: AgentTask[];
  [key: string]: unknown;
}
export interface Presence {
  peerId: string;
  actor: Actor;
  peerEpoch?: string;
  peerSeq?: number;
  context?: ViewContext;
  cursor?: { x: number; y: number; surface?: string; t?: number } | null;
  following?: string;
  color?: string;
  visible?: boolean;
  updatedAt: string;
}
export interface RoomMessage {
  peerId: string;
  actor: Actor;
  seq: number;
  topic: string;
  data: Json;
  createdAt: string;
}

export type CollaborationStateEvent =
  | {
      type: 'document';
      document: { artifact: Artifact };
      epoch?: string;
      cursor?: string;
      operationId?: string;
      actorId?: string;
      commitRevision?: number;
      changedIds?: string[];
      unitVersions?: Record<string, number>;
    }
  | { type: 'peers'; peers: Presence[] }
  | { type: 'reset'; reason: 'pause' | 'reset' | 'close' };
export interface CollaborationRoom {
  send(topic: string, data: Json): Promise<boolean>;
  subscribe(topic: string, listener: (message: RoomMessage) => void): () => void;
  subscribeState?(listener: (event: CollaborationStateEvent) => void): () => void;
}
export interface SyncBatch {
  cursor: string;
  reset: boolean;
  events: StudioEvent[];
  peers: Presence[];
  timer: RoomTimer | null;
  serverTime: number;
  actor?: Actor;
  access?: 'local' | 'lan';
}
export interface RoomTimer {
  durationMs: number;
  deadline: number | null;
  remainingMs: number;
  paused: boolean;
  source: Actor;
}
export interface Operation {
  op: 'add' | 'update' | 'delete' | 'layout' | 'style' | 'restore' | 'motion' | 'document' | 'todo';
  id?: string;
  element?: Partial<BoardElement>;
  changes?: Partial<BoardElement>;
  ids?: string[];
  preset?: string;
  style?: Partial<StyleProfile>;
  versionId?: string;
  data?: Record<string, unknown>;
}

export const STUDIO_TOOLS = {
  open: 'studio_open',
  list: 'artifact_list',
  manage: 'artifact_manage',
  read: 'artifact_read',
  apply: 'artifact_apply',
  feedback: 'artifact_feedback',
  share: 'artifact_share',
  export: 'artifact_export',
  activity: 'artifact_activity',
} as const;

export const TOOL_NAMES = [
  STUDIO_TOOLS.open,
  STUDIO_TOOLS.list,
  STUDIO_TOOLS.manage,
  STUDIO_TOOLS.read,
  STUDIO_TOOLS.apply,
  STUDIO_TOOLS.feedback,
  STUDIO_TOOLS.share,
  STUDIO_TOOLS.export,
  STUDIO_TOOLS.activity,
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export interface ToolFailure {
  code: string;
  message: string;
  details?: unknown;
}
export type ToolResponse<T = unknown> =
  | { ok: true; data: T; error?: never }
  | { ok: false; error: ToolFailure; data?: never };

type VersionReference =
  | { versionId: string | number; revision?: number | string }
  | { revision: number | string; versionId?: string | number };
type DiffReference =
  | ({ adjacent: true } & VersionReference)
  | { fromVersionId: string | number; toVersionId?: string | number; adjacent?: false };

interface ArtifactReadInputs {
  board: { mode: 'board' };
  document: { mode?: 'document' };
  version: { mode: 'version' } & VersionReference;
  history: { mode: 'history' };
  diff: { mode: 'diff'; ids?: readonly string[] } & DiffReference;
  units: { mode: 'units'; atRevision: number; ids: readonly string[] };
  source: { mode: 'source'; regionId: string; sourceRevision?: number; feedbackId?: string };
}
export interface ArtifactDiffUnit {
  id: string;
  before?: unknown;
  after?: unknown;
}
interface ArtifactReadUnit {
  id: string;
  after: unknown;
}
export interface ArtifactUnits {
  artifact: Artifact;
  units: ArtifactReadUnit[];
}
export type ArtifactSource =
  | { html: string; document?: never }
  | {
      html?: never;
      artifactId: string;
      elementId?: string;
      version: number;
      document: DocumentContent;
      text?: string;
    };
export interface ArtifactReadResults {
  board: Board;
  document: Board;
  version: { board: Board };
  history: { history: HistoryEntry[]; batches: HistoryBatch[] };
  diff: { units: ArtifactDiffUnit[]; fromRevision: number | null; toRevision: number };
  units: ArtifactUnits;
  source: ArtifactSource;
}
export type ArtifactReadMode = keyof ArtifactReadInputs;
export type ArtifactReadRequest = { artifactId: string } & ArtifactReadInputs[ArtifactReadMode];
type RequestedMode<Request> = Request extends { mode: infer Mode extends ArtifactReadMode }
  ? Mode
  : 'document';
export type ArtifactReadResult<Request extends ArtifactReadRequest> =
  ArtifactReadResults[RequestedMode<Request>];
export type OtherStudioTool = Exclude<ToolName, typeof STUDIO_TOOLS.read>;
export type StudioToolArguments =
  | [name: typeof STUDIO_TOOLS.read, args: ArtifactReadRequest]
  | [name: OtherStudioTool, args?: Record<string, unknown>];

export interface StudioToolCall {
  <Request extends ArtifactReadRequest>(
    name: typeof STUDIO_TOOLS.read,
    args: Request,
  ): Promise<ArtifactReadResult<Request>>;
  <T = unknown>(name: OtherStudioTool, args?: Record<string, unknown>): Promise<T>;
  (...args: StudioToolArguments): Promise<unknown>;
}
interface StudioAssetState {
  status: 'loading' | 'ready' | 'error';
  message?: string;
}

export interface StudioClient {
  call: StudioToolCall;
  request?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  assetUrl?: (reference: string) => string | undefined;
  subscribeAssets?: (listener: () => void) => () => void;
  assetState?: (reference: string) => StudioAssetState | undefined;
  downloadFile?: (blob: Blob, filename: string) => Promise<void>;
  baseUrl?: string;
  token?: string;
  embedded: boolean;
}
export interface HtmlSelection {
  regionId: string;
  sourceRevision: number;
  targetIds: string[];
  quote: string;
  excerpt: string;
  selector?: string;
  rect?: { x: number; y: number; w: number; h: number };
  screenPoint?: { x: number; y: number };
}
export interface Connection {
  baseUrl: string;
  token: string;
  actor: Actor;
  artifactId?: string;
  access?: 'local' | 'lan';
}
export interface StudioUnitPatch {
  baseVersion: number;
  version: number;
  changes: Record<string, unknown>;
  removedKeys: string[];
}
export type StudioUnitEvent =
  | { id: string; after: unknown | null; patch?: never }
  | { id: string; patch: StudioUnitPatch; after?: never };
export interface StudioEvent {
  type: string;
  artifactId: string;
  cursor?: string;
  revision?: number;
  operationId?: string;
  actorId?: string;
  changedIds?: string[];
  unitVersions?: Record<string, number>;
  artifact?: Artifact;
  units?: StudioUnitEvent[];
  [key: string]: unknown;
}

export const DEFAULT_STYLE: StyleProfile = {
  name: 'Diagram',
  paper: '#f5f5f5',
  ink: '#2d3142',
  muted: '#4f5d75',
  accent: '#eb6c36',
  link: '#2e5aa8',
  fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
  titleFont: 'Georgia, "Songti SC", serif',
  monoFont: 'Consolas, monospace',
};
export const LOCAL_ACTOR: Actor = { id: 'local', name: '我', kind: 'human', role: 'owner' };
