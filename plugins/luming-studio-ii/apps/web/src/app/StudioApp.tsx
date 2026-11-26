import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import type { ArchiveImportService } from '../data/archive-import/index.js';
import type { BoardCatalogService, CatalogManagementService } from '../data/catalog/index.js';
import { createCatalogBoardRename } from '../data/catalog/index.js';
import type { ExportBoard, ExportBoardFile, WhiteboardService } from '../data/whiteboard/index.js';
import type { StudioLocation } from '../platform/browser/index.js';
import './app.css';
import { studioPages } from './routes.js';
import { AppShell } from './shell/index.js';
import { useArchiveImport } from './workflows/archive-import/useArchiveImport.js';

type StudioLayout = 'list' | 'grid';
type StudioTheme = 'light' | 'dark';
type BoardPageProps = ComponentProps<typeof WhiteboardPage>;

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
}

export interface StudioAppProps {
  readonly catalog: BoardCatalogService;
  readonly catalogManagement?: CatalogManagementService;
  readonly service: WhiteboardService;
  readonly navigation: StudioNavigation;
  readonly preferences: StudioPreferences;
  readonly createCommandId: () => string;
  readonly archiveImport?: ArchiveImportService;
  readonly exportBoard?: ExportBoard;
  readonly downloadExport?: (file: ExportBoardFile) => void;
  readonly editService?: BoardPageProps['editService'];
  readonly historyService?: BoardPageProps['historyService'];
  readonly feedbackService?: BoardPageProps['feedbackService'];
  readonly prepareImage?: BoardPageProps['prepareImage'];
  readonly readHtmlSource?: BoardPageProps['readHtmlSource'];
}

const {
  whiteboard: WhiteboardPage,
  workbench: WorkbenchPage,
  'recycle-bin': RecycleBinPage,
} = studioPages;

export function StudioApp({
  catalog,
  catalogManagement,
  service,
  navigation,
  preferences,
  createCommandId,
  archiveImport,
  exportBoard,
  downloadExport,
  editService,
  historyService,
  feedbackService,
  prepareImage,
  readHtmlSource,
}: StudioAppProps) {
  const [location, setLocation] = useState(navigation.read);
  const [layout, setLayout] = useState(preferences.layout);
  const [resolvedTheme, setTheme] = useState(preferences.resolvedTheme);
  const routeGeneration = useRef(0);
  const renameBoard = useMemo(
    () =>
      catalogManagement && createCatalogBoardRename(catalog, catalogManagement, createCommandId),
    [catalog, catalogManagement, createCommandId],
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
        routeGeneration.current += 1;
        setLocation(navigation.read());
      }),
    [navigation],
  );

  function navigate(target: StudioLocation) {
    navigation.write(target);
    routeGeneration.current += 1;
    setLocation(target);
  }

  function handleOpenBoard(boardId: string) {
    navigate({ kind: 'whiteboard', boardId });
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
        <WhiteboardPage
          boardId={location.boardId}
          service={service}
          createCommandId={createCommandId}
          onBack={openWorkbench}
          exportBoard={exportBoard}
          downloadExport={downloadExport}
          editService={editService}
          historyService={historyService}
          feedbackService={feedbackService}
          prepareImage={prepareImage}
          renameBoard={renameBoard}
          readHtmlSource={readHtmlSource}
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
        readRouteGeneration={() => routeGeneration.current}
        onOpenTrash={catalogManagement ? openRecycleBin : undefined}
        archiveImport={importFlow.workbench}
        preferences={pagePreferences}
      />
    );
  }

  return (
    <AppShell
      resolvedTheme={resolvedTheme}
      notice={importFlow.feedback}
      onDismissNotice={importFlow.dismissFeedback}
    >
      {renderPage()}
    </AppShell>
  );
}
