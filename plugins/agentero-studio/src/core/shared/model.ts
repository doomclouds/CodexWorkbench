import type {
  Artifact,
  Feedback,
  HistoryEntry,
  Role,
  ShareMember,
} from '../../contracts/studio.js';

export type ArtifactMetadata = Omit<Artifact, 'type'> & { type: string };
export interface Snapshot<Content> {
  artifact: ArtifactMetadata;
  content: Content;
}
export interface SavedVersion<Content> extends Snapshot<Content> {
  entry: HistoryEntry;
}
export interface AssetRecord {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface UnitClock {
  version: number;
  incarnationStart: number;
  sourceRevision?: number;
}
export interface SharingMember extends Omit<ShareMember, 'active' | 'online'> {
  credential: string;
  roleToken: string;
  grantId?: string;
  ownerAssigned?: boolean;
  removed?: boolean;
}
export interface SharingState {
  enabled: boolean;
  generation: number;
  tokens: Partial<Record<Exclude<Role, 'owner'>, string>>;
  access?: 'local' | 'lan';
  roleEnabled?: Partial<Record<Exclude<Role, 'owner'>, boolean>>;
  members?: Record<string, SharingMember>;
  retiredTokens?: Record<string, 'link-reset' | 'sharing-closed'>;
}
export type FeedbackRecord<Anchor> = Omit<Feedback, 'anchor'> & {
  anchor: Anchor;
  creationReceipt?: { operationId: string; fingerprint: string };
};
export interface ArtifactState<
  Content,
  Anchor = unknown,
  Source = unknown,
> extends Snapshot<Content> {
  schemaVersion: 2;
  feedback: FeedbackRecord<Anchor>[];
  history: SavedVersion<Content>[];
  operations: { id: string; fingerprint: string; historyId: string }[];
  unitClocks?: Record<string, UnitClock>;
  deletedFeedbackReceipts?: { operationId: string; fingerprint: string; contextId: string }[];
  guestNames?: Record<string, { name: string; key: string }>;
  sources: Record<string, Source[]>;
  sharing: SharingState;
  assets: Record<string, AssetRecord>;
}
export interface ContentChange {
  id: string;
  before: unknown;
  after: unknown;
}
export interface UndoUnitContext {
  current: unknown;
  changesWereReversed(didChange: (before: unknown, after: unknown) => boolean): boolean;
}
export interface ContentOperation {
  op: string;
  id?: string;
  ids?: string[];
  versionId?: string;
  preset?: string;
  data?: Record<string, unknown>;
}
export interface FeedbackSnapshot<Anchor, Source> {
  anchor: Anchor;
  versions: Record<string, number>;
  sources: Source[];
}

export interface ProductAdapter<Content, Operation extends ContentOperation, Anchor, Source> {
  type: string;
  validate(content: Content): void;
  versionOf(content: Content, id: string): number;

  targets(content: Content, operation: Operation): string[] | undefined;

  apply(content: Content, operation: Operation, baseline?: Content): string[];

  rebaseUpdate?(
    operation: Operation,
    base: unknown,
    current: unknown,
  ): { operation: Operation; local: unknown };

  syncVersions?(
    content: Content,
    previous: Content,
    clocks: Record<string, UnitClock>,
    initialize?: boolean,
  ): void;
  diff(before: Content, after: Content): ContentChange[];
  readUnit(content: Content, id: string): unknown;
  restoreUnit(content: Content, change: ContentChange, history?: readonly Content[]): void;
  undoUnit?(
    content: Content,
    change: ContentChange,
    history: readonly Content[],
    context: UndoUnitContext,
  ): void;
  restore(current: Content, saved: Content, history?: readonly Content[]): Content;

  validateRestore?(current: Content, restored: Content, baseline: Content, mode?: 'undo'): void;
  snapshotFeedback(
    artifactId: string,
    feedbackId: string,
    snapshots: readonly Snapshot<Content>[],
    anchor: unknown,
    versions?: Record<string, number>,
    clocks?: Record<string, UnitClock>,
  ): FeedbackSnapshot<Anchor, Source>;
}
export interface MutationArguments<Operation> {
  operationId: unknown;
  operations: Operation[];
  expectedRevision?: unknown;
  expectedVersions?: unknown;
  summary?: unknown;
  merge?: unknown;
}
export interface MutationResult<Content> {
  snapshot: Snapshot<Content>;
  historyEntry: HistoryEntry;
  changed: boolean;
}
