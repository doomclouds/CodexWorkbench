import { create, type MessageInitShape } from '@bufbuild/protobuf';
import {
  BoardCatalogService,
  BoardSortOrder,
  CatalogCommandReceiptSchema,
  CatalogRejectionReason,
  type CatalogCommandReceipt,
  type GetCatalogCommandReceiptResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/catalog/service';
import type {
  CatalogApplication,
  CatalogReceipt,
} from '../../modules/catalog/application/index.js';
import { HttpRequestError, requireId } from './request.js';
import { unaryRoute, type RouteEntry } from './unary-route.js';

type ReceiptResponseInit = MessageInitShape<typeof GetCatalogCommandReceiptResponseSchema>;

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

function toCatalogReceipt(receipt: CatalogReceipt): CatalogCommandReceipt {
  if (receipt.kind === 'created') {
    return create(CatalogCommandReceiptSchema, {
      commandId: receipt.commandId,
      outcome: { case: 'created', value: receipt.board },
    });
  }

  const reason =
    receipt.reason === 'invalidTitle'
      ? CatalogRejectionReason.INVALID_TITLE
      : CatalogRejectionReason.COMMAND_ID_REUSE;

  return create(CatalogCommandReceiptSchema, {
    commandId: receipt.commandId,
    outcome: { case: 'rejected', value: { reason } },
  });
}

export function createCatalogRoutes(application: CatalogApplication): readonly RouteEntry[] {
  const { listBoards, createBoard, getCatalogCommandReceipt } = BoardCatalogService.method;

  return [
    unaryRoute(listBoards, (actor, request) => {
      const { query, order, pageSize, cursor } = request;
      const result = application.listBoards(actor, {
        query,
        order: toSortOrder(order),
        pageSize,
        cursor,
      });

      return { boards: [...result.boards], nextCursor: result.nextCursor };
    }),
    unaryRoute(createBoard, (actor, request) => {
      const receipt = application.createBoard(actor, {
        commandId: requireId(request.commandId),
        title: request.title,
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
