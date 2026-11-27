import { BoardEditService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/edits';
import {
  BoardHistoryService as wireService,
  BoardVersionKind,
  type BoardVersionSummary as WireBoardVersionSummary,
  type ExportBoardVersionResponse,
  type ListBoardVersionsResponse,
} from '@codexworkbench/luming-studio-ii-contracts/whiteboard/history';
import type { WhiteboardPayloadResult, WhiteboardPost, WhiteboardScene } from './contracts.js';
import type { BoardEditReceipt } from './edits-types.js';
import {
  readBrowserVectorFile,
  readExportFile,
  readExportRejection,
  wireFormats,
  writeExportScope,
  type ExportBoardFile,
  type ExportBoardFormat,
  type ExportBoardRejection,
  type ExportBoardScope,
  type RenderBrowserVectorExport,
} from './export.js';
import { readBoardEditReceipt } from './protocol/edit-receipt.js';
import { request } from './protocol/index.js';
import { readPayloads } from './protocol/payload.js';
import { readScene } from './protocol/scene.js';
import { matchIdentity, requireField } from './protocol/values.js';

type HistoryVersionKind = 'baseline' | 'geometry' | 'content' | 'image' | 'restore';

export interface BoardHistoryVersion {
  readonly revision: bigint;
  readonly title: string;
  readonly savedAtMillis?: number;
  readonly actorId?: string;
  readonly kind: HistoryVersionKind;
  readonly changedObjectCount: number;
  readonly sourceRevision?: bigint;
}

export interface BoardHistoryPage {
  readonly currentRevision: bigint;
  readonly versions: readonly BoardHistoryVersion[];
  readonly nextBeforeRevision?: bigint;
}

export interface RestoreBoardVersionCommand {
  readonly boardId: string;
  readonly commandId: string;
  readonly revision: bigint;
  readonly expectedCurrentRevision: bigint;
  readonly scope: ExportBoardScope;
}

export interface ExportBoardVersionCommand {
  readonly boardId: string;
  readonly revision: bigint;
  readonly scope: ExportBoardScope;
  readonly format: Exclude<ExportBoardFormat, 'zip'>;
}

export type BoardHistoryExportResult =
  | { readonly kind: 'file'; readonly file: ExportBoardFile }
  | { readonly kind: 'rejected'; readonly reason: ExportBoardRejection }
  | { readonly kind: 'unavailable' };

export interface BoardHistoryService {
  listVersions(boardId: string, before?: bigint, signal?: AbortSignal): Promise<BoardHistoryPage>;
  getVersionScene(
    boardId: string,
    revision: bigint,
    signal?: AbortSignal,
  ): Promise<WhiteboardScene | undefined>;
  getVersionPayloads(
    boardId: string,
    revision: bigint,
    ids: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly WhiteboardPayloadResult[]>;
  restoreVersion(
    command: RestoreBoardVersionCommand,
    signal?: AbortSignal,
  ): Promise<BoardEditReceipt>;
  getRestoreReceipt(
    boardId: string,
    commandId: string,
    signal?: AbortSignal,
  ): Promise<BoardEditReceipt | undefined>;
  exportVersion(
    command: ExportBoardVersionCommand,
    signal?: AbortSignal,
  ): Promise<BoardHistoryExportResult>;
}

const versionKinds = new Map<BoardVersionKind, HistoryVersionKind>([
  [BoardVersionKind.BASELINE, 'baseline'],
  [BoardVersionKind.GEOMETRY, 'geometry'],
  [BoardVersionKind.CONTENT, 'content'],
  [BoardVersionKind.IMAGE, 'image'],
  [BoardVersionKind.RESTORE, 'restore'],
]);
const pageSize = 30;
const maxDateMillis = 8_640_000_000_000_000n;

function readSavedAt(value: bigint | undefined): number | undefined {
  if (value === undefined) {
    return;
  }
  if (value > maxDateMillis) {
    throw new Error('版本历史返回了无效的保存时间。');
  }

  return Number(value);
}

function readVersion({
  revision,
  title,
  savedAtMillis,
  actorId,
  kind,
  changedObjectCount,
  sourceRevision,
}: WireBoardVersionSummary): BoardHistoryVersion {
  return {
    revision: requireField(revision, 'history revision'),
    title,
    savedAtMillis: readSavedAt(savedAtMillis),
    actorId: actorId || undefined,
    kind: requireField(versionKinds.get(kind), 'history version kind'),
    changedObjectCount,
    sourceRevision,
  };
}

function readHistoryPage(
  response: ListBoardVersionsResponse,
  before: bigint | undefined,
): BoardHistoryPage {
  const currentRevision = requireField(response.currentRevision, 'current history revision');
  const versions = response.versions.map(readVersion);
  let previous = before;
  for (const { revision } of versions) {
    if (revision > currentRevision || (previous !== undefined && revision >= previous)) {
      throw new Error('版本历史返回了无效的版次顺序。');
    }

    previous = revision;
  }

  const { nextBeforeRevision } = response;
  if (nextBeforeRevision !== undefined && nextBeforeRevision !== versions.at(-1)?.revision) {
    throw new Error('版本历史返回了无效的分页位置。');
  }

  return { currentRevision, versions, nextBeforeRevision };
}

async function readVersionExport(
  { result }: ExportBoardVersionResponse,
  { format, revision }: ExportBoardVersionCommand,
  render: RenderBrowserVectorExport | undefined,
  signal?: AbortSignal,
): Promise<BoardHistoryExportResult> {
  switch (result.case) {
    case 'file':
      return { kind: 'file', file: readExportFile(result.value, revision, format) };
    case 'browserPng':
      return {
        kind: 'file',
        file: await readBrowserVectorFile(result.value, revision, format, render, signal),
      };
    case 'rejected':
      return { kind: 'rejected', reason: readExportRejection(result.value.reason) };
    case 'unavailable':
      return { kind: 'unavailable' };
    case undefined:
      throw new Error('历史导出服务未返回处理结果。');
  }
}

export function createBoardHistoryService(
  post: WhiteboardPost,
  resolveArchiveAsset: (source: string) => string = (source) => source,
  render?: RenderBrowserVectorExport,
): BoardHistoryService {
  const methods = wireService.method;

  return {
    async listVersions(boardId, beforeRevision, signal) {
      const response = await request(
        post,
        methods.listBoardVersions,
        { boardId, beforeRevision, limit: pageSize },
        signal,
      );

      return readHistoryPage(response, beforeRevision);
    },
    async getVersionScene(boardId, revision, signal) {
      const response = await request(
        post,
        methods.getBoardVersionScene,
        { boardId, revision },
        signal,
      );

      if (!response.scene) {
        return;
      }

      const scene = readScene(response.scene, boardId);
      if (scene.revision !== revision) {
        throw new Error('预览场景的版次与所选记录不一致。');
      }

      return { ...scene, canEdit: false };
    },
    async getVersionPayloads(boardId, revision, ids, signal) {
      const objectIds = [...new Set(ids)];
      if (objectIds.length === 0) {
        return [];
      }

      const response = await request(
        post,
        methods.getBoardVersionPayloads,
        { boardId, revision, objectIds },
        signal,
      );
      matchIdentity(response.boardId, boardId, 'board ID');
      if (response.revision !== revision) {
        throw new Error('预览正文的版次与所选记录不一致。');
      }
      if (response.unavailable) {
        throw new Error('所选版本已无法读取。');
      }

      return readPayloads(response.results, objectIds, resolveArchiveAsset);
    },
    async restoreVersion({ scope, ...command }, signal) {
      const response = await request(
        post,
        methods.restoreBoardVersion,
        { ...command, scope: writeExportScope(scope) },
        signal,
      );

      return readBoardEditReceipt(
        response.receipt,
        command.boardId,
        command.commandId,
        resolveArchiveAsset,
      );
    },
    async getRestoreReceipt(boardId, commandId, signal) {
      const response = await request(
        post,
        BoardEditService.method.getBoardEditReceipt,
        { boardId, commandId },
        signal,
      );

      return response.receipt
        ? readBoardEditReceipt(response.receipt, boardId, commandId, resolveArchiveAsset)
        : undefined;
    },
    async exportVersion(command, signal) {
      const { format, scope, ...source } = command;
      const response = await request(
        post,
        methods.exportBoardVersion,
        { ...source, format: wireFormats[format], scope: writeExportScope(scope) },
        signal,
      );

      return readVersionExport(response, command, render, signal);
    },
  };
}
