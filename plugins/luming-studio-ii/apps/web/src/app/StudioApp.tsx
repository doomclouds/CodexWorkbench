import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import type { ArchiveImportService } from '../data/archive-import/index.js';
import type { BoardCatalogService, CatalogManagementService } from '../data/catalog/index.js';
import { createCatalogBoardRename, createCatalogDirectory } from '../data/catalog/index.js';
import type { BoardSharingService } from '../data/sharing/index.js';
import type {
  ExportBoard,
  RequestBoardDownload,
  WhiteboardService,
} from '../data/whiteboard/index.js';
import type { StudioLocation } from '../platform/browser/index.js';
import './app.css';
import { createCatalogThumbnailRenderer } from './catalog-thumbnails.js';
import { createWorkbenchBoardLinkCopy } from './copy-workbench-board-link.js';
import { studioPages } from './routes.js';
import { AppShell } from './shell/index.js';
import { RoomWhiteboard, type CreateRoomSession } from './WhiteboardApp.js';
import { useArchiveImport } from './workflows/archive-import/useArchiveImport.js';
import { useBoardCreation } from './workflows/board-creation/useBoardCreation.js';

type StudioLayout = 'list' | 'grid';
type StudioTheme = 'light' | 'dark';
type BoardPageProps = ComponentProps<typeof WhiteboardPage>;
type GuestShell = NonNullable<ComponentProps<typeof AppShell>['guest']>;
type RenderGuestBoard = GuestShell['renderBoard'];
type BoardAccess = Parameters<RenderGuestBoard>[1];

interface GuestPorts extends Pick<
  BoardPageProps,
  'service' | 'exportBoard' | 'editService' | 'historyService' | 'feedbackService'
> {
  readonly sharingService: BoardSharingService;
  readonly createRoomSession?: CreateRoomSession;
  readonly readEntry: () => GuestShell['entry'] | undefined;
  readonly replaceEntry: (boardId?: string) => void;
  readonly isAccessDenied: GuestShell['isAccessDenied'];
  readonly subscribeRefresh: GuestShell['subscribeRefresh'];
}

interface StudioNavigation {
  readonly read: () => StudioLocation;
  readonly readBoardView?: () => BoardPageProps['initialBoardView'];
  readonly write: (location: StudioLocation) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

interface StudioPreferences {
  readonly layout: StudioLayout;
  readonly resolvedTheme: StudioTheme;
  readonly pinnedOnly?: boolean;
  readonly rememberLayout: (layout: StudioLayout) => void;
  readonly rememberPinnedOnly?: (pinnedOnly: boolean) => void;
  readonly rememberTheme: (theme: StudioTheme) => void;
  readonly subscribeTheme?: (listener: (theme: StudioTheme) => void) => () => void;
}

export interface StudioAppProps {
  readonly catalog: BoardCatalogService;
  readonly catalogManagement?: CatalogManagementService;
  readonly service: WhiteboardService;
  readonly navigation: StudioNavigation;
  readonly preferences: StudioPreferences;
  readonly createCommandId: () => string;
  readonly createRoomSession?: CreateRoomSession;
  readonly onViewContext?: BoardPageProps['onViewContext'];
  readonly archiveImport?: ArchiveImportService;
  readonly exportBoard?: ExportBoard;
  readonly downloadExport?: RequestBoardDownload;
  readonly downloadObjectFile?: BoardPageProps['downloadObjectFile'];
  readonly clipboard?: BoardPageProps['clipboard'];
  readonly localDrafts?: BoardPageProps['localDrafts'];
  readonly readDocumentAsset?: BoardPageProps['readDocumentAsset'];
  readonly readDocumentImageFile?: BoardPageProps['readDocumentImageFile'];
  readonly editService?: BoardPageProps['editService'];
  readonly historyService?: BoardPageProps['historyService'];
  readonly feedbackService?: BoardPageProps['feedbackService'];
  readonly suggestions?: BoardPageProps['suggestions'];
  readonly onAttachReviewSource?: BoardPageProps['onAttachReviewSource'];
  readonly prepareImage?: BoardPageProps['prepareImage'];
  readonly prepareVideo?: BoardPageProps['prepareVideo'];
  readonly readHtmlSource?: BoardPageProps['readHtmlSource'];
  readonly sharingService?: BoardSharingService;
  readonly copyShareLink?: (url: string) => Promise<void>;
  readonly guest?: GuestPorts;
}

const {
  whiteboard: WhiteboardPage,
  workbench: WorkbenchPage,
  'recycle-bin': RecycleBinPage,
} = studioPages;

interface GuestWhiteboardProps extends BoardPageProps {
  readonly access: BoardAccess;
  readonly createRoomSession?: CreateRoomSession;
}

function GuestWhiteboard({ access, service, ...props }: GuestWhiteboardProps) {
  const visibleService = useMemo<WhiteboardService>(() => {
    if (access.canEdit) {
      return service;
    }

    return {
      ...service,
      async getScene(boardId, signal) {
        const scene = await service.getScene(boardId, signal);

        return { ...scene, canEdit: false };
      },
    };
  }, [access.canEdit, service]);

  return <RoomWhiteboard {...props} service={visibleService} commentAccess={access.canComment} />;
}

export function StudioApp({
  catalog,
  catalogManagement,
  service,
  navigation,
  preferences,
  createCommandId,
  createRoomSession,
  onViewContext,
  archiveImport,
  exportBoard,
  downloadExport,
  downloadObjectFile,
  clipboard,
  localDrafts,
  readDocumentAsset,
  readDocumentImageFile,
  editService,
  historyService,
  feedbackService,
  suggestions,
  onAttachReviewSource,
  prepareImage,
  prepareVideo,
  readHtmlSource,
  sharingService,
  copyShareLink,
  guest,
}: StudioAppProps) {
  const [route, setRoute] = useState(() => ({
    location: navigation.read(),
    guestEntry: guest?.readEntry(),
  }));
  const { location, guestEntry } = route;
  const [layout, setLayout] = useState(preferences.layout);
  const [resolvedTheme, setTheme] = useState(preferences.resolvedTheme);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const subscribeTheme = preferences.subscribeTheme;
  const initialPinnedOnly = preferences.pinnedOnly;
  const directory = useMemo(
    () => createCatalogDirectory(catalog, initialPinnedOnly),
    [catalog, initialPinnedOnly],
  );
  const routeGeneration = useRef(0);
  const shareEntry = useRef<string>(undefined);
  const renameBoard = useMemo(
    () =>
      catalogManagement && createCatalogBoardRename(catalog, catalogManagement, createCommandId),
    [catalog, catalogManagement, createCommandId],
  );
  const copyBoardLink = useMemo(
    () =>
      sharingService && copyShareLink
        ? createWorkbenchBoardLinkCopy(sharingService, copyShareLink, createCommandId)
        : undefined,
    [sharingService, copyShareLink, createCommandId],
  );
  const renderThumbnail = useMemo(
    () => catalog.getBoardThumbnail && createCatalogThumbnailRenderer(catalog.getBoardThumbnail),
    [catalog],
  );
  const importFlow = useArchiveImport({
    service: archiveImport,
    createCommandId,
    readRouteGeneration: () => routeGeneration.current,
    onOpenBoard: handleOpenBoard,
  });
  const [creationNotice, setCreationNotice] = useState<ComponentProps<typeof AppShell>['notice']>();
  const dismissCreationNotice = useCallback(() => setCreationNotice(undefined), []);
  const creation = useBoardCreation({
    service: catalog,
    createCommandId,
    onOpenBoard: handleOpenBoard,
    readRouteGeneration: () => routeGeneration.current,
    onLateConfirmation(action) {
      directory.reload();
      if (action === 'create') {
        setCreationNotice({ kind: 'success', message: '作品已创建，可从 Luming Studio II 打开。' });
      }
    },
  });

  const handleHistoryNavigation = useEffectEvent(() => {
    const next = navigation.read();
    if (location.kind === 'whiteboard' && next.kind === 'workbench') {
      directory.setPinnedOnly(false);
    }

    shareEntry.current = undefined;
    routeGeneration.current += 1;
    setRoute({ location: next, guestEntry: guest?.readEntry() });
  });

  useEffect(() => navigation.subscribe(() => handleHistoryNavigation()), [navigation]);

  useEffect(() => subscribeTheme?.(setTheme), [subscribeTheme]);

  function navigate(target: StudioLocation, openSharingBoard?: string) {
    navigation.write(target);
    shareEntry.current = openSharingBoard;
    routeGeneration.current += 1;
    setRoute({ location: target, guestEntry: guest?.readEntry() });
  }

  function navigateGuest(boardId?: string) {
    guest?.replaceEntry(boardId);
    routeGeneration.current += 1;
    setRoute({ location: navigation.read(), guestEntry: guest?.readEntry() });
  }

  function exitGuest() {
    navigateGuest();
  }

  function handleOpenBoard(boardId: string) {
    navigate({ kind: 'whiteboard', boardId });
  }

  function handleOpenBoardSharing(boardId: string) {
    navigate({ kind: 'whiteboard', boardId }, boardId);
  }

  function consumeShareEntry(boardId: string) {
    if (shareEntry.current !== boardId) {
      return false;
    }

    shareEntry.current = undefined;
    return true;
  }

  function openWorkbench() {
    navigate({ kind: 'workbench' });
  }

  function handleReturnFromBoard() {
    directory.setPinnedOnly(false);
    openWorkbench();
  }

  function openRecycleBin() {
    navigate({ kind: 'recycle-bin' });
  }

  function handleReturnFromRecycleBin() {
    directory.setPinnedOnly(false, true);
    openWorkbench();
  }

  function changeLayout(next: StudioLayout) {
    preferences.rememberLayout(next);
    setLayout(next);
  }

  function changeTheme(next: StudioTheme) {
    preferences.rememberTheme(next);
    setTheme(next);
  }

  const theme = { resolvedTheme, onThemeChange: changeTheme };
  const searchExpansion = { expanded: searchExpanded, onExpandedChange: setSearchExpanded };

  function renderPage() {
    if (location.kind === 'whiteboard') {
      return (
        <RoomWhiteboard
          boardId={location.boardId}
          service={service}
          createCommandId={createCommandId}
          createRoomSession={createRoomSession}
          fitOnMount
          initialBoardView={navigation.readBoardView?.()}
          onViewContext={onViewContext}
          onBack={handleReturnFromBoard}
          exportBoard={exportBoard}
          downloadExport={downloadExport}
          downloadObjectFile={downloadObjectFile}
          clipboard={clipboard}
          localDrafts={localDrafts}
          readDocumentAsset={readDocumentAsset}
          readDocumentImageFile={readDocumentImageFile}
          editService={editService}
          historyService={historyService}
          feedbackService={feedbackService}
          suggestions={suggestions}
          onAttachReviewSource={onAttachReviewSource}
          prepareImage={prepareImage}
          prepareVideo={prepareVideo}
          renameBoard={renameBoard}
          readHtmlSource={readHtmlSource}
          sharingService={sharingService}
          copyShareLink={copyShareLink}
          theme={theme}
          consumeShareEntry={() => consumeShareEntry(location.boardId)}
        />
      );
    }

    const pagePreferences = {
      ...theme,
      layout,
      onLayoutChange: changeLayout,
    };

    if (location.kind === 'recycle-bin') {
      return (
        <RecycleBinPage
          management={catalogManagement}
          renderThumbnail={renderThumbnail}
          createCommandId={createCommandId}
          onBack={handleReturnFromRecycleBin}
          preferences={pagePreferences}
          initialQuery={directory.getSnapshot().query}
          onQueryChange={directory.setQuery}
          searchExpansion={searchExpansion}
        />
      );
    }

    return (
      <WorkbenchPage
        catalog={catalog}
        directory={directory}
        renderThumbnail={renderThumbnail}
        management={catalogManagement}
        createCommandId={createCommandId}
        onOpenBoard={handleOpenBoard}
        copyBoardLink={copyBoardLink}
        onOpenSharing={handleOpenBoardSharing}
        creation={creation}
        onOpenTrash={catalogManagement ? openRecycleBin : undefined}
        archiveImport={importFlow.workbench}
        preferences={{ ...pagePreferences, onPinnedOnlyChange: preferences.rememberPinnedOnly }}
        searchExpansion={searchExpansion}
      />
    );
  }

  function renderGuestBoard(boardId: string, access: BoardAccess, recheckAccess: () => void) {
    if (!guest) {
      return null;
    }

    return (
      <GuestWhiteboard
        key={`${boardId}:${access.role}:${access.canEdit}:${access.canComment}`}
        access={access}
        boardId={boardId}
        service={guest.service}
        createCommandId={createCommandId}
        createRoomSession={guest.createRoomSession}
        onRoomAccessLost={recheckAccess}
        fitOnMount
        initialBoardView={navigation.readBoardView?.()}
        onViewContext={onViewContext}
        exportBoard={guest.exportBoard}
        downloadExport={downloadExport}
        downloadObjectFile={downloadObjectFile}
        clipboard={clipboard}
        readDocumentAsset={readDocumentAsset}
        readDocumentImageFile={access.canEdit ? readDocumentImageFile : undefined}
        editService={access.canEdit ? guest.editService : undefined}
        historyService={guest.historyService}
        feedbackService={guest.feedbackService}
        prepareImage={access.canEdit ? prepareImage : undefined}
        prepareVideo={access.canEdit ? prepareVideo : undefined}
        readHtmlSource={access.canEdit ? readHtmlSource : undefined}
        sharingService={guest.sharingService}
        copyShareLink={copyShareLink}
        theme={theme}
        lanSharing={access.scope === 'lan'}
      />
    );
  }

  const guestShell =
    guest && guestEntry
      ? {
          entry: guestEntry,
          service: guest.sharingService,
          isAccessDenied: guest.isAccessDenied,
          subscribeRefresh: guest.subscribeRefresh,
          onJoin: navigateGuest,
          onExit: exitGuest,
          renderBoard: renderGuestBoard,
        }
      : undefined;

  return (
    <AppShell
      resolvedTheme={resolvedTheme}
      notice={importFlow.feedback ?? creationNotice}
      onDismissNotice={importFlow.feedback ? importFlow.dismissFeedback : dismissCreationNotice}
      guest={guestShell}
    >
      {!guestEntry && renderPage()}
    </AppShell>
  );
}
