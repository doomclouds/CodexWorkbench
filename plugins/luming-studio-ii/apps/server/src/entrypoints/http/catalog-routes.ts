import { create, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardCatalogService,
  BoardLifecycleAction,
  BoardSortOrder,
  CatalogCommandReceiptSchema,
  CatalogRejectionReason,
  type CatalogCommandReceipt,
  type GetCatalogCommandReceiptResponseSchema,
  type ManageBoardRequest,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import type {
  CatalogApplication,
  CatalogChangeEvents,
  CatalogReceipt,
  CatalogRejectionReason as ApplicationRejection,
  ManageBoardCommand,
} from '../../modules/catalog/application/index.js';
import { WhiteboardAccessError } from '../../modules/whiteboard/application/index.js';
import { createCatalogPreferenceRoutes } from './catalog-preferences.js';
import { HttpRequestError, requireId } from './request.js';
import { unaryRoute, type RouteEntry } from './unary-route.js';

type ReceiptResponseInit = MessageInitShape<typeof GetCatalogCommandReceiptResponseSchema>;
type ReceiptOutcomeInit = NonNullable<
  MessageInitShape<typeof CatalogCommandReceiptSchema>['outcome']
>;
type ManageOperation = ManageBoardCommand['operation'];

const catalogRejections: Record<ApplicationRejection, CatalogRejectionReason> = {
  invalidTitle: CatalogRejectionReason.INVALID_TITLE,
  commandIdReuse: CatalogRejectionReason.COMMAND_ID_REUSE,
  forbidden: CatalogRejectionReason.FORBIDDEN,
  entryVersionChanged: CatalogRejectionReason.ENTRY_VERSION_CHANGED,
  stateChanged: CatalogRejectionReason.STATE_CHANGED,
  invalidCommand: CatalogRejectionReason.INVALID_COMMAND,
};

function toSortOrder(order: BoardSortOrder): 'recent' | 'title' {
  switch (order) {
    case BoardSortOrder.UNSPECIFIED:
    case BoardSortOrder.RECENT:
      return 'recent';
    case BoardSortOrder.TITLE:
      return 'title';
    default:
      throw new HttpRequestError(400, 'Unsupported board sort order');
  }
}

function toReceiptOutcome(receipt: CatalogReceipt): ReceiptOutcomeInit {
  switch (receipt.kind) {
    case 'created':
      return { case: 'created', value: receipt.board };
    case 'changed':
      return { case: 'changed', value: receipt.board };
    case 'purged':
      return {
        case: 'purged',
        value: {
          items: receipt.items.map((item) => ({
            boardId: item.boardId,
            outcome: item.deleted
              ? { case: 'deleted', value: true }
              : { case: 'rejected', value: { reason: catalogRejections[item.reason] } },
          })),
        },
      };
    case 'rejected':
      return { case: 'rejected', value: { reason: catalogRejections[receipt.reason] } };
  }
}

function toCatalogReceipt(receipt: CatalogReceipt): CatalogCommandReceipt {
  return create(CatalogCommandReceiptSchema, {
    commandId: receipt.commandId,
    outcome: toReceiptOutcome(receipt),
  });
}

function requireEntryVersion(value: bigint | undefined): bigint {
  if (value === undefined) {
    throw new HttpRequestError(400, 'Catalogue entry version is required');
  }

  return value;
}

function requireThumbnailRevision(revision: bigint | undefined): bigint {
  if (revision === undefined) {
    throw new HttpRequestError(400, 'The saved preview revision is required.');
  }

  return revision;
}

function toManageOperation(operation: ManageBoardRequest['operation']): ManageOperation {
  switch (operation.case) {
    case 'title':
      return { kind: 'rename', title: operation.value };
    case 'pinned':
      return { kind: 'pin', pinned: operation.value };
    case 'lifecycle':
      if (operation.value === BoardLifecycleAction.TRASH) {
        return { kind: 'trash' };
      }
      if (operation.value === BoardLifecycleAction.RESTORE) {
        return { kind: 'restore' };
      }

      throw new HttpRequestError(400, 'Unsupported catalogue lifecycle action');
    case undefined:
      throw new HttpRequestError(400, 'Catalogue operation is required');
  }
}

export const boardCreateRoutePath =
  '/' + BoardCatalogService.typeName + '/' + BoardCatalogService.method.createBoard.name;

export function createCatalogRoutes(
  application: CatalogApplication,
  changes?: CatalogChangeEvents,
): readonly RouteEntry[] {
  const {
    listBoards,
    listTrashedBoards,
    getBoardThumbnail,
    createBoard,
    duplicateBoard,
    manageBoard,
    purgeBoards,
    getCatalogCommandReceipt,
  } = BoardCatalogService.method;

  return [
    ...createCatalogPreferenceRoutes(application),
    unaryRoute(listBoards, (actor, request) => {
      const { query, order, pageSize, cursor, pinnedOnly, offset } = request;
      const result = application.listBoards(actor, {
        query,
        order: toSortOrder(order),
        pageSize,
        cursor,
        pinnedOnly,
        offset,
      });

      return {
        boards: [...result.boards],
        nextCursor: result.nextCursor,
        catalogCursor: changes?.cursor,
      };
    }),
    unaryRoute(listTrashedBoards, (actor, request) => {
      const { query, order, pageSize, cursor, pinnedOnly, offset } = request;
      const result = application.listTrashedBoards(actor, {
        query,
        order: toSortOrder(order),
        pageSize,
        cursor,
        pinnedOnly,
        offset,
      });

      return { boards: [...result.boards], nextCursor: result.nextCursor };
    }),
    unaryRoute(getBoardThumbnail, (actor, { boardId, revision, trashed }) => {
      const result = application.getBoardThumbnail(actor, {
        boardId: requireId(boardId),
        revision: requireThumbnailRevision(revision),
        trashed,
      });

      if (result.kind === 'forbidden') {
        throw new WhiteboardAccessError();
      }

      return { thumbnail: result.kind === 'thumbnail' ? result.thumbnail : undefined };
    }),
    unaryRoute(createBoard, (actor, request) => {
      if (actor.kind === 'agent' && !actor.creationAuthorId) {
        throw new WhiteboardAccessError();
      }

      const receipt = application.createBoard(
        {
          id: actor.id,
          creationAuthorId: actor.kind === 'agent' ? actor.creationAuthorId : undefined,
        },
        {
          commandId: requireId(request.commandId),
          title: request.title,
        },
      );

      return { receipt: toCatalogReceipt(receipt) };
    }),
    unaryRoute(duplicateBoard, (actor, request) => {
      const receipt = application.duplicateBoard(actor, {
        commandId: requireId(request.commandId),
        sourceBoardId: requireId(request.sourceBoardId),
      });

      return { receipt: toCatalogReceipt(receipt) };
    }),
    unaryRoute(manageBoard, (actor, request) => {
      const receipt = application.manageBoard(actor, {
        commandId: requireId(request.commandId),
        boardId: requireId(request.boardId),
        expectedEntryVersion: requireEntryVersion(request.expectedEntryVersion),
        operation: toManageOperation(request.operation),
      });

      return { receipt: toCatalogReceipt(receipt) };
    }),
    unaryRoute(purgeBoards, (actor, request) => {
      const receipt = application.purgeBoards(actor, {
        commandId: requireId(request.commandId),
        targets: request.targets.map(({ boardId, expectedEntryVersion }) => ({
          boardId: requireId(boardId),
          expectedEntryVersion: requireEntryVersion(expectedEntryVersion),
        })),
      });

      return { receipt: toCatalogReceipt(receipt) };
    }),
    unaryRoute(getCatalogCommandReceipt, (actor, request): ReceiptResponseInit => {
      const commandId = requireId(request.commandId);
      const receipt = application.getReceipt(actor, commandId);

      return {
        result: receipt
          ? { case: 'receipt', value: toCatalogReceipt(receipt) }
          : { case: 'notRecorded', value: { commandId } },
      };
    }),
  ];
}
