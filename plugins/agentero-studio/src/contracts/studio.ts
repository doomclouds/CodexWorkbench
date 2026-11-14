import type { Proposal } from './proposals.js';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Role = 'owner' | 'editor' | 'commenter' | 'viewer';
export interface Actor { id: string; name: string; kind: 'human' | 'agent'; role: Role }
export interface ShareMember { id: string; name: string; role: Exclude<Role, 'owner'>; joinedAt: string; lastSeenAt: string; active: boolean; online: boolean }
export interface Artifact {
  id: string; type: string; title: string; revision: number; createdAt: string; updatedAt: string;
  pinned: boolean; trashedAt?: string; thumbnail?: string; sharing?: boolean;
  importedFrom?: { artifactId: string; title: string; createdAt: string; importedAt: string };
}
export interface StyleProfile {
  name: string; paper: string; ink: string; muted: string; accent: string; link: string;
  fontFamily: string; titleFont: string; monoFont: string; [key: string]: string;
}
export type ElementType = 'shape' | 'container' | 'text' | 'stroke' | 'arrow' | 'image' | 'html' | 'table' | 'link' | 'note' | 'sticker' | 'diagram' | 'chart';
export interface BoardElement {
  id: string; type: ElementType; x: number; y: number; w: number; h: number; version: number;
  text?: string; kind?: string; color?: string; stroke?: string; fill?: string; fontSize?: number;
  fontFamily?: string; bold?: boolean; italic?: boolean; textAlign?: 'left' | 'center' | 'right';
  rotation?: number; parentId?: string; groupId?: string; locked?: boolean;
  hollow?: boolean; strokeWidth?: number; heads?: ('none' | 'arrow' | 'circle')[];
  crop?: { zoom: number; x: number; y: number };
  from?: string | [number, number]; to?: string | [number, number]; fromSide?: string; toSide?: string;
  label?: string; dash?: boolean; head?: string; points?: number[]; bends?: (number | 'h' | 'v')[];
  src?: string; video?: string; html?: string; sourceRevision?: number; state?: Json; href?: string;
  data?: Record<string, unknown>; [key: string]: unknown;
}
export interface ArtifactView { artifact: Artifact }
export interface HtmlRegionContent { id: string; version: number; html?: string; sourceRevision?: number; text?: string; state?: Json }
export interface Board extends ArtifactView { elements: BoardElement[]; style: StyleProfile; motion?: Record<string, unknown>; orderVersion?: number }
export interface Anchor { coordinateSpace?: 'board' | 'element' | 'html'; elementIds?: string[]; regionId?: string; targetIds?: string[]; sourceRevision?: number; quote?: string; excerpt?: string; selector?: string; x?: number; y?: number; w?: number; h?: number }
export interface Feedback {
  id: string; artifactId: string; type: 'comment' | 'request'; anchor: Anchor; author: Actor;
  text: string; status: 'open' | 'pending' | 'processing' | 'resolved'; createdAt: string; updatedAt: string;
  replies: { id: string; author: Actor; text: string; createdAt: string }[]; targetViewId?: string;
  versions?: Record<string, number>;
  proposal?: Proposal;
  processingBy?: Actor;
}
export interface HistoryEntry { id: string; revision: number; createdAt: string; actor: Actor; summary: string; changedIds: string[]; restoredFrom?: string }
/** Display grouping only; every version remains independently addressable. */
export interface HistoryBatch extends HistoryEntry { firstVersionId: string; firstRevision: number; firstCreatedAt: string; beforeVersionId?: string; versionIds: string[] }
export interface ViewContext { viewId: string; artifactId: string; selectedIds: string[]; viewport?: { x: number; y: number; zoom: number }; editingIds?: string[]; [key: string]: unknown }
export interface Presence { peerId: string; actor: Actor; peerEpoch?: string; peerSeq?: number; context?: ViewContext; cursor?: { x: number; y: number; surface?: string; t?: number } | null; following?: string; chat?: string; chatExpiresAt?: number; color?: string; visible?: boolean; updatedAt: string }
export interface RoomMessage { peerId: string; actor: Actor; seq: number; topic: string; data: Json; createdAt: string }
export interface CollaborationRoom {
  send(topic: string, data: Json): Promise<boolean>;
  subscribe(topic: string, listener: (message: RoomMessage) => void): () => void;
}
export interface SyncBatch { cursor: string; reset: boolean; events: StudioEvent[]; peers: Presence[]; timer: RoomTimer | null; serverTime: number; actor?: Actor; access?: 'local' | 'lan' }
export interface RoomTimer { durationMs: number; deadline: number | null; remainingMs: number; paused: boolean; source: Actor }
export interface Operation {
  op: 'add' | 'update' | 'delete' | 'layout' | 'style' | 'restore' | 'motion';
  id?: string; element?: Partial<BoardElement>; changes?: Partial<BoardElement>; ids?: string[];
  preset?: string; style?: Partial<StyleProfile>; versionId?: string; data?: Record<string, unknown>;
}
export const TOOL_NAMES = ['studio_open', 'artifact_list', 'artifact_manage', 'artifact_read', 'artifact_apply', 'artifact_feedback', 'artifact_share', 'artifact_export'] as const;
export type ToolName = typeof TOOL_NAMES[number];
export interface ToolResponse<T = unknown> { ok: boolean; data?: T; error?: { code: string; message: string; details?: unknown } }
export interface StudioClient {
  call<T = unknown>(name: ToolName, args?: Record<string, unknown>): Promise<T>;
  request?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  assetUrl?: (reference: string) => string | undefined;
  openLink?: (url: string) => Promise<void>;
  downloadFile?: (blob: Blob, filename: string) => Promise<void>;
  baseUrl?: string; token?: string; embedded: boolean;
}
export interface HtmlSelection { regionId: string; sourceRevision: number; targetIds: string[]; quote: string; excerpt: string; selector?: string; rect?: { x: number; y: number; w: number; h: number }; screenPoint?: { x: number; y: number } }
export interface Connection { baseUrl: string; token: string; actor: Actor; artifactId?: string; access?: 'local' | 'lan' }
export interface StudioEvent { type: string; artifactId: string; cursor?: string; revision?: number; artifact?: Artifact; units?: { id: string; after: unknown | null }[]; [key: string]: unknown }
export const DEFAULT_STYLE: StyleProfile = { name: 'Diagram', paper: '#f5f5f5', ink: '#2d3142', muted: '#4f5d75', accent: '#eb6c36', link: '#2e5aa8', fontFamily: 'Arial, "Microsoft YaHei", sans-serif', titleFont: 'Georgia, "Songti SC", serif', monoFont: 'Consolas, monospace' };
export const LOCAL_ACTOR: Actor = { id: 'local', name: '我', kind: 'human', role: 'owner' };
