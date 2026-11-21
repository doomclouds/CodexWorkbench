import type { Artifact, StudioClient } from '../../../contracts/studio';
import type { ProductDescriptor, StudioDocument } from '../../product-contract';
import type { StudioViewRequests } from '../../shared/studio-view-scope';

export type LibraryFilter = 'recent' | 'pinned' | 'trash';
export type LibraryArtifactAction = 'pin' | 'copyLink' | 'duplicate' | 'trash' | 'restore';
type LibraryHome = 'library' | 'trash';

export interface PurgeConfirmation {
  targets: { id: string; title: string }[];
  all: boolean;
}

type CreationProduct = Pick<ProductDescriptor, 'id' | 'defaultTitle'>;

export interface LibraryListResult {
  artifacts: Artifact[];
  nextCursor?: string;
}

export interface LibraryOptions {
  client: StudioClient;
  previewClient: StudioClient;
  ownerId: string | null;
  activeId: string;
  initialView?: string;
  canManage: boolean;
  busy: string;
  setBusy: (busy: string) => void;
  clearError: () => void;
  reportError: (cause: unknown, retry?: () => void) => void;
  describeError: (cause: unknown) => string;
  inform: (message: string) => void;
  scope: StudioViewRequests;
  isMounted: () => boolean;
  getDocument: () => StudioDocument | null;
  acceptDocument: (document: StudioDocument) => void;
  resolveProduct: (id?: string) => CreationProduct | undefined;
  openArtifact: (id: string, document?: StudioDocument) => void;
  goHome: () => void;
  navigateHome: (view: LibraryHome) => void;
  copyArtifactLink: (artifact: Artifact) => Promise<void>;
}
