import type { Artifact, Feedback, HistoryEntry, Role } from '../../contracts/studio.js';

/** Studio owns this envelope; each product owns only Content and its adapter. */
export type ArtifactMetadata = Omit<Artifact, 'type'> & { type: string };
export interface Snapshot<Content> { artifact: ArtifactMetadata; content: Content }
export interface SavedVersion<Content> extends Snapshot<Content> { entry: HistoryEntry }
export interface AssetRecord { id: string; filename: string; mimeType: string; size: number }
export interface SharingState { enabled: boolean; generation: number; tokens: Partial<Record<Exclude<Role, 'owner'>, string>> }
export type FeedbackRecord<Anchor> = Omit<Feedback, 'anchor'> & { anchor: Anchor; creationReceipt?: { operationId: string; fingerprint: string } };
export interface ArtifactState<Content, Anchor = unknown, Source = unknown> extends Snapshot<Content> {
  schemaVersion: 2;
  feedback: FeedbackRecord<Anchor>[];
  history: SavedVersion<Content>[];
  operations: { id: string; fingerprint: string; historyId: string }[];
  sources: Record<string, Source[]>;
  sharing: SharingState;
  assets: Record<string, AssetRecord>;
}
export interface ContentChange { id: string; before: unknown; after: unknown }
export interface ContentOperation { op: string; versionId?: string; preset?: string; data?: Record<string, unknown> }
export interface FeedbackSnapshot<Anchor, Source> { anchor: Anchor; versions: Record<string, number>; sources: Source[] }
/** No whiteboard concepts belong to this contract: IDs can be paragraphs, cells, etc. */
export interface ProductAdapter<Content, Operation extends ContentOperation, Anchor, Source> {
  type: string;
  validate(content: Content): void;
  versionOf(content: Content, id: string): number;
  /** undefined means a whole-content change, which requires a current revision. */
  targets(content: Content, operation: Operation): string[] | undefined;
  /** The original batch content keeps explicit unlocks from bypassing locks in the same commit. */
  apply(content: Content, operation: Operation, baseline?: Content): string[];
  diff(before: Content, after: Content): ContentChange[];
  readUnit(content: Content, id: string): unknown;
  restoreUnit(content: Content, change: ContentChange): void;
  restore(current: Content, saved: Content): Content;
  snapshotFeedback(artifactId: string, feedbackId: string, snapshots: readonly Snapshot<Content>[], anchor: unknown, versions?: Record<string, number>): FeedbackSnapshot<Anchor, Source>;
}
export interface MutationArguments<Operation> {
  operationId: unknown; operations: Operation[]; expectedRevision?: unknown;
  expectedVersions?: unknown; summary?: unknown;
}
export interface MutationResult<Content> { snapshot: Snapshot<Content>; historyEntry: HistoryEntry; changed: boolean }
