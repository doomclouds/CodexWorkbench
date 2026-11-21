import type { ArtifactMetadata, ArtifactState, Snapshot } from '../shared/model.js';

export type { ArtifactMetadata, ArtifactState, SavedVersion } from '../shared/model.js';

export type ArtifactAuthorization = Pick<
  ArtifactState<unknown>,
  'artifact' | 'sharing' | 'guestNames'
>;

type ReadOptions = { maxExpandedBytes?: number };

export interface ArtifactUnitRequest {
  revision: number;
  ids: readonly string[];
  includeFields: boolean;
  includeOrder: boolean;
  maximumElements: number;
  maximumBytes: number;
}

export interface ArtifactUnitProjection {
  snapshot: Snapshot<unknown> | null;
  order: readonly string[];
}

export interface StudioRepository<Content = unknown, Anchor = unknown, Source = unknown> {
  readonly root: string;
  folder(id: string): string;
  readLegacyArtifact(id: string): Promise<ArtifactMetadata | undefined>;
  trashLegacyArtifact(id: string, expectedRevision?: unknown): Promise<ArtifactMetadata>;
  catalog(): Promise<ArtifactMetadata[]>;
  readAuthorization(id: string): Promise<ArtifactAuthorization>;
  read(id: string, options?: ReadOptions): Promise<ArtifactState<Content, Anchor, Source>>;
  readProjection<Projection>(
    id: string,
    pick: (state: Readonly<ArtifactState<Content, Anchor, Source>>) => Projection,
    options?: ReadOptions,
  ): Promise<Projection>;
  readUnitProjection?(
    id: string,
    select: (authorization: ArtifactAuthorization) => ArtifactUnitRequest | undefined,
  ): Promise<ArtifactUnitProjection | undefined>;
  write(state: ArtifactState<Content, Anchor, Source>): Promise<void>;
  transaction<Result>(
    id: string,
    run: (state: ArtifactState<Content, Anchor, Source>) => Promise<Result> | Result,
  ): Promise<Result>;
  withSnapshotLock<Result>(
    id: string,
    run: (state: ArtifactState<Content, Anchor, Source>) => Promise<Result> | Result,
  ): Promise<Result>;
  withProjectionLock<Projection, Result>(
    id: string,
    pick: (state: Readonly<ArtifactState<Content, Anchor, Source>>) => Projection,
    run: (projection: Projection) => Promise<Result> | Result,
  ): Promise<Result>;
  purge(id: string, beforeDelete: () => Promise<void>): Promise<void>;
}
