import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import type { ArchiveImportService } from '../data/archive-import/index.js';
import type { BoardCatalogService, CatalogManagementService } from '../data/catalog/index.js';
import { createCatalogBoardRename } from '../data/catalog/index.js';
import type { BoardSharingService } from '../data/sharing/index.js';
import type { ExportBoard, ExportBoardFile, WhiteboardService } from '../data/whiteboard/index.js';
import type { StudioLocation } from '../platform/browser/index.js';
import './app.css';
import { createWorkbenchBoardLinkCopy } from './copy-workbench-board-link.js';
import { studioPages } from './routes.js';
import { AppShell } from './shell/index.js';
import { RoomWhiteboard, type CreateRoomSession } from './WhiteboardApp.js';
import { useArchiveImport } from './workflows/archive-import/useArchiveImport.js';

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
  readonly write: (location: StudioLocation) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

interface StudioPreferences {
  readonly layout: StudioLayout;
  readonly resolvedTheme: StudioTheme;
  readonly rememberLayout: (layout: StudioLayout) => void;
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
  readonly downloadExport?: (file: ExportBoardFile) => void;
  readonly editService?: BoardPageProps['editService'];
  readonly historyService?: BoardPageProps['historyService'];
  readonly feedbackService?: BoardPageProps['feedbackService'];
  readonly suggestions?: BoardPageProps['suggestions'];
  readonly onAttachReviewSource?: BoardPageProps['onAttachReviewSource'];
  readonly reviewSourceMode?: BoardPageProps['reviewSourceMode'];
  readonly prepareImage?: BoardPageProps['prepareImage'];
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
  editService,
  historyService,
  feedbackService,
  suggestions,
  onAttachReviewSource,
  reviewSourceMode,
  prepareImage,
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
  const subscribeTheme = preferences.subscribeTheme;
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
  const importFlow = useArchiveImport({
    service: archiveImport,
    createCommandId,
    readRouteGeneration: () => routeGeneration.current,
    onOpenBoard: handleOpenBoard,
  });

  useEffect(
    () =>
      navigation.subscribe(() => {
        shareEntry.current = undefined;
        routeGeneration.current += 1;
        setRoute({ location: navigation.read(), guestEntry: guest?.readEntry() });
      }),
    [guest, navigation],
  );

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

  function openRecycleBin() {
    navigate({ kind: 'recycle-bin' });
  }

  function changeLayout(next: StudioLayout) {
    preferences.rememberLayout(next);
    setLayout(next);
  }

  function changeTheme(next: StudioTheme) {
    preferences.rememberTheme(next);
    setTheme(next);
  }

  function renderPage() {
    if (location.kind === 'whiteboard') {
      return (
        <RoomWhiteboard
          boardId={location.boardId}
          service={service}
          createCommandId={createCommandId}
          createRoomSession={createRoomSession}
          onViewContext={onViewContext}
          onBack={openWorkbench}
          exportBoard={exportBoard}
          downloadExport={downloadExport}
          editService={editService}
          historyService={historyService}
          feedbackService={feedbackService}
          suggestions={suggestions}
          onAttachReviewSource={onAttachReviewSource}
          reviewSourceMode={reviewSourceMode}
          prepareImage={prepareImage}
          renameBoard={renameBoard}
          readHtmlSource={readHtmlSource}
          sharingService={sharingService}
          copyShareLink={copyShareLink}
          consumeShareEntry={() => consumeShareEntry(location.boardId)}
        />
      );
    }

    const pagePreferences = {
      layout,
      resolvedTheme,
      onLayoutChange: changeLayout,
      onThemeChange: changeTheme,
    };

    if (location.kind === 'recycle-bin') {
      return (
        <RecycleBinPage
          management={catalogManagement}
          createCommandId={createCommandId}
          onBack={openWorkbench}
          preferences={pagePreferences}
        />
      );
    }

    return (
      <WorkbenchPage
        catalog={catalog}
        management={catalogManagement}
        createCommandId={createCommandId}
        onOpenBoard={handleOpenBoard}
        copyBoardLink={copyBoardLink}
        onOpenSharing={handleOpenBoardSharing}
        readRouteGeneration={() => routeGeneration.current}
        onOpenTrash={catalogManagement ? openRecycleBin : undefined}
        archiveImport={importFlow.workbench}
        preferences={pagePreferences}
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
        onViewContext={onViewContext}
        exportBoard={guest.exportBoard}
        downloadExport={downloadExport}
        editService={access.canEdit ? guest.editService : undefined}
        historyService={guest.historyService}
        feedbackService={guest.feedbackService}
        prepareImage={access.canEdit ? prepareImage : undefined}
        readHtmlSource={access.canEdit ? readHtmlSource : undefined}
        sharingService={guest.sharingService}
        copyShareLink={copyShareLink}
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
      notice={importFlow.feedback}
      onDismissNotice={importFlow.dismissFeedback}
      guest={guestShell}
    >
      {!guestEntry && renderPage()}
    </AppShell>
  );
}
