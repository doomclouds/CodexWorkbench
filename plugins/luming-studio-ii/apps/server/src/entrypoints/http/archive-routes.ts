import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { create, toBinary, type MessageInitShape } from '@bufbuild/protobuf';
import {
  ArchiveImportReceiptSchema,
  ArchiveImportRejectionReason as WireRejection,
  BoardArchiveService,
  ImportBoardArchiveResponseSchema,
} from '@codexworkbench/luming-studio-ii-contracts/archives/service';
import {
  MAX_ARCHIVE_IMPORT_BYTES,
  type ArchiveImportApplication,
  type ArchiveImportReceipt,
  type ArchiveImportRejectionReason,
} from '../../modules/archives/application/index.js';
import { HttpRequestError, mediaType } from './request.js';
import { sendProtobuf, sendStatus } from './response.js';
import { unaryRoute, type HttpActor } from './unary-route.js';

const archiveImportPath = '/' + BoardArchiveService.typeName + '/ImportBoardArchive';
const archiveAssetPrefix = '/studio-archive-assets/';
const archiveContentType = 'application/zip';
const commandHeader = 'x-studio-command-id';
const rejectionCodes: Record<ArchiveImportRejectionReason, WireRejection> = {
  invalidArchive: WireRejection.INVALID_ARCHIVE,
  unsupportedVersion: WireRejection.UNSUPPORTED_VERSION,
  incompatibleContent: WireRejection.INCOMPATIBLE_CONTENT,
  commandIdReuse: WireRejection.COMMAND_ID_REUSE,
  tooLarge: WireRejection.INVALID_ARCHIVE,
};

function receiptMessage({
  commandId,
  outcome,
}: ArchiveImportReceipt): MessageInitShape<typeof ArchiveImportReceiptSchema> {
  if (outcome.kind === 'rejected') {
    return {
      commandId,
      outcome: { case: 'rejected', value: { reason: rejectionCodes[outcome.reason] } },
    };
  }

  const { boardId, title } = outcome;
  return { commandId, outcome: { case: 'imported', value: { boardId, title } } };
}

export function createArchiveReceiptRoute(application: ArchiveImportApplication) {
  return unaryRoute(BoardArchiveService.method.getArchiveImportReceipt, ({ id }, { commandId }) => {
    const receipt = application.getReceipt(id, commandId);

    return {
      result: receipt
        ? { case: 'receipt' as const, value: receiptMessage(receipt) }
        : { case: 'notRecorded' as const, value: { commandId } },
    };
  });
}

async function* archiveChunks(request: IncomingMessage): AsyncGenerator<Uint8Array> {
  for await (const value of request.iterator({ destroyOnReturn: false })) {
    const chunk: unknown = value;
    if (!Buffer.isBuffer(chunk)) {
      throw new TypeError('Expected a binary archive request.');
    }

    yield chunk;
  }
}

async function importArchive(
  application: ArchiveImportApplication,
  actor: HttpActor,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (mediaType(request) !== archiveContentType) {
    sendStatus(response, 415);
    return;
  }
  if (Number(request.headers['content-length']) > MAX_ARCHIVE_IMPORT_BYTES) {
    throw new HttpRequestError(413, 'Archive exceeds the size limit.');
  }

  const commandId = request.headers[commandHeader];
  if (typeof commandId !== 'string') {
    throw new HttpRequestError(400, 'Archive command identifier is required.');
  }

  const receipt = await application.importCurrent(actor.id, commandId, archiveChunks(request));
  if (receipt.outcome.kind === 'rejected' && receipt.outcome.reason === 'tooLarge') {
    sendStatus(response, 413);
    return;
  }

  const schema = ImportBoardArchiveResponseSchema;
  sendProtobuf(response, toBinary(schema, create(schema, { receipt: receiptMessage(receipt) })));
}

function serveArchiveAsset(
  application: ArchiveImportApplication,
  actor: HttpActor,
  path: string,
  response: ServerResponse,
): void {
  const [boardId, assetId, extra] = path.slice(archiveAssetPrefix.length).split('/');
  if (!boardId || !assetId || extra !== undefined) {
    sendStatus(response, 404);
    return;
  }

  const asset = application.getAsset(actor.id, boardId, assetId);
  if (!asset) {
    sendStatus(response, 404);
    return;
  }

  response.writeHead(200, {
    'content-type': asset.mimeType,
    'content-length': asset.bytes.byteLength,
    'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'; sandbox",
    'x-content-type-options': 'nosniff',
  });
  response.end(asset.bytes);
}

interface ArchiveRoute {
  readonly method: 'GET' | 'POST';
  run(actor: HttpActor, request: IncomingMessage, response: ServerResponse): void | Promise<void>;
}

export function archiveRoute(
  path: string,
  application: ArchiveImportApplication,
): ArchiveRoute | undefined {
  if (path === archiveImportPath) {
    return {
      method: 'POST',
      run: (actor, request, response) => importArchive(application, actor, request, response),
    };
  }
  if (path.startsWith(archiveAssetPrefix)) {
    return {
      method: 'GET',
      run: (actor, _request, response) => serveArchiveAsset(application, actor, path, response),
    };
  }

  return undefined;
}
