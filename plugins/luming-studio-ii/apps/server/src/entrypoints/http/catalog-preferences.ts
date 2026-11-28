import {
  BoardCatalogService,
  type WorkbenchPreferences as WirePreferences,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import type {
  CatalogApplication,
  WorkbenchPreferences,
} from '../../modules/catalog/application/index.js';
import { WhiteboardAccessError } from '../../modules/whiteboard/application/index.js';
import { HttpRequestError } from './request.js';
import { canReadTrashedBoard, unaryRoute, type HttpActor } from './unary-route.js';

function requireLocalActor(actor: HttpActor) {
  if (!canReadTrashedBoard(actor)) {
    throw new WhiteboardAccessError();
  }
}

function readChanges(changes: WirePreferences | undefined): WorkbenchPreferences {
  const { layout, theme, pinnedOnly } = changes ?? {};
  if (layout !== undefined && layout !== 'grid' && layout !== 'list') {
    throw new HttpRequestError(400, 'Unsupported workbench layout.');
  }
  if (theme !== undefined && theme !== 'light' && theme !== 'dark') {
    throw new HttpRequestError(400, 'Unsupported workbench theme.');
  }
  if (layout === undefined && theme === undefined && pinnedOnly === undefined) {
    throw new HttpRequestError(400, 'Workbench preferences changes are required.');
  }

  return { layout, theme, pinnedOnly };
}

export function createCatalogPreferenceRoutes(application: CatalogApplication) {
  const { getWorkbenchPreferences, updateWorkbenchPreferences } = BoardCatalogService.method;

  return [
    unaryRoute(getWorkbenchPreferences, (actor) => {
      requireLocalActor(actor);

      return { preferences: application.readPreferences(actor) };
    }),
    unaryRoute(updateWorkbenchPreferences, (actor, { changes }) => {
      requireLocalActor(actor);
      application.updatePreferences(actor, readChanges(changes));

      return {};
    }),
  ];
}
