import { bridgeMaximumBytes } from './schema.js';

export const protobufMediaType = 'application/protobuf';
export const archiveMediaType = 'application/zip';

const normalRequestBytes = 1024 * 1024;
const imageRequestBytes = 8 * 1024 * 1024 + 32 * 1024;
const namespace = 'luming.studio.v1.';

interface Operation {
  readonly route: string;
  readonly mediaType: string;
  readonly maximumBytes: number;
  readonly boardField?: number;
}

const boardMethods = [
  [
    'WhiteboardService',
    ['GetBoardScene', 'GetObjectPayloads', 'MoveObjects', 'GetCommandReceipt', 'ExportBoard'],
  ],
  [
    'BoardEditService',
    ['EditBoardGeometry', 'EditObjectContent', 'AttachBoardImage', 'GetBoardEditReceipt'],
  ],
  [
    'BoardHistoryService',
    [
      'ListBoardVersions',
      'GetBoardVersionScene',
      'GetBoardVersionPayloads',
      'RestoreBoardVersion',
      'ExportBoardVersion',
    ],
  ],
  ['FeedbackService', ['ListThreads', 'GetThread', 'ApplyFeedback', 'GetFeedbackReceipt']],
  ['BoardSharingService', ['GetBoardSharing', 'UpdateBoardSharing', 'GetBoardSharingReceipt']],
  [
    'BoardSuggestionService',
    [
      'CreateBoardReviewSource',
      'ListBoardSuggestions',
      'PreviewBoardSuggestion',
      'AcceptBoardSuggestion',
      'RejectBoardSuggestion',
    ],
  ],
  [
    'BoardRoomService',
    [
      'GetBoardRoom',
      'UpdateBoardPresence',
      'LeaveBoardPresence',
      'ChangeBoardTimer',
      'GetBoardTimerReceipt',
    ],
  ],
] as const;

const libraryMethods = [
  [
    'BoardCatalogService',
    [
      'ListBoards',
      'ListTrashedBoards',
      'CreateBoard',
      'DuplicateBoard',
      'ManageBoard',
      'PurgeBoards',
      'GetCatalogCommandReceipt',
    ],
  ],
  ['BoardArchiveService', ['GetArchiveImportReceipt']],
] as const;

const archiveOperation = namespace + 'BoardArchiveService/ImportBoardArchive';
const operations = new Map<string, Operation>();

type ServiceMethods = readonly [string, readonly string[]];

function registerMethods(methods: readonly ServiceMethods[], boardField?: number): void {
  for (const [service, names] of methods) {
    for (const name of names) {
      const key = namespace + service + '/' + name;
      operations.set(key, {
        route: '/' + key,
        mediaType: protobufMediaType,
        maximumBytes: name === 'AttachBoardImage' ? imageRequestBytes : normalRequestBytes,
        boardField,
      });
    }
  }
}

registerMethods(boardMethods, 1);
registerMethods(libraryMethods);
operations.set(archiveOperation, {
  route: '/' + archiveOperation,
  mediaType: archiveMediaType,
  maximumBytes: bridgeMaximumBytes,
});

export function appOperation(service: string, method: string): Operation | undefined {
  return operations.get(service + '/' + method);
}
