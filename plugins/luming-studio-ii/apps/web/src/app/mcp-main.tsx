import { createRoot } from 'react-dom/client';
import { createArchiveImportService } from '../data/archive-import/index.js';
import {
  createBoardCatalogService,
  createCatalogManagementService,
} from '../data/catalog/index.js';
import { createBoardFeedbackService } from '../data/feedback/index.js';
import { createBoardRoomService, createBoardRoomSession } from '../data/rooms/index.js';
import { createBoardSharingService } from '../data/sharing/index.js';
import { createSuggestionService, type SuggestionService } from '../data/suggestions/index.js';
import {
  createBoardHistoryService,
  createWhiteboardEditService,
  createWhiteboardExportService,
  createWhiteboardService,
} from '../data/whiteboard/index.js';
import type {
  BoardEditReceipt,
  EditObjectContentCommand,
  WhiteboardDocumentBlock,
  WhiteboardPayloadResult,
} from '../data/whiteboard/index.js';
import {
  boardRoomClock,
  copyShareLink,
  createBoardDraftStorage,
  downloadBoardFile,
  prepareBoardImage,
  prepareBoardVideo,
  readCanvasClipboard,
  readDocumentImageFile,
  readHtmlSource,
  renderBrowserVectorExport,
} from '../platform/browser/index.js';
import {
  connectMcpApp,
  createMcpCommandId,
  observeMcpRoomSnapshots,
} from '../platform/mcp/index.js';
import { StudioApp } from './index.js';
import type { StudioAppProps } from './index.js';

type Bridge = Awaited<ReturnType<typeof connectMcpApp>>;
type Assets = Bridge['assets'];
type Fields = Readonly<Record<string, unknown>>;

function fields(value: unknown): Fields | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Fields;
  }
}

function resolveField(source: unknown, assets: Assets, signal?: AbortSignal): unknown {
  return typeof source === 'string' ? assets.resolve(source, signal) : source;
}

async function resolveBlock(
  value: unknown,
  assets: Assets,
  signal?: AbortSignal,
): Promise<unknown> {
  const block = fields(value);
  if (!block) {
    return value;
  }

  const props = fields(block.props);
  const children = Array.isArray(block.children)
    ? await Promise.all(block.children.map((child: unknown) => resolveBlock(child, assets, signal)))
    : block.children;
  const mapped =
    props && block.type === 'image'
      ? { ...props, url: await resolveField(props.url, assets, signal) }
      : block.props;

  return { ...block, props: mapped, children };
}

async function resolvePayload(
  result: WhiteboardPayloadResult,
  assets: Assets,
  signal?: AbortSignal,
): Promise<WhiteboardPayloadResult> {
  if (result.kind !== 'loaded' || result.payload.body.kind === 'ink') {
    return result;
  }

  const { payload } = result;
  const { kind, value } = result.payload.body;
  let next: Fields;
  try {
    switch (kind) {
      case 'image':
        next = { ...value, src: await resolveField(value.src, assets, signal) };
        break;
      case 'video': {
        const [src, poster] = await Promise.all([
          resolveField(value.src, assets, signal),
          resolveField(value.poster, assets, signal),
        ]);
        next = { ...value, src, poster };
        break;
      }
      case 'document': {
        const content = fields(value.document);
        if (!content || !Array.isArray(content.blocks)) {
          return result;
        }

        const blocks = await Promise.all(
          content.blocks.map((block: unknown) => resolveBlock(block, assets, signal)),
        );
        next = { ...value, document: { ...content, blocks } };
        break;
      }
      case 'embed':
      case 'extension':
      case 'link':
      case 'sticker':
      case 'table':
      case 'text':
      case 'todo':
        return result;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof Error)) {
      throw error;
    }

    return { kind: 'unavailable', id: payload.id, reason: 'assetUnavailable' };
  }

  return { kind: 'loaded', payload: { ...payload, body: { kind, value: next } } };
}

function restoreBlock(block: WhiteboardDocumentBlock, assets: Assets): WhiteboardDocumentBlock {
  const { type, props, children } = block;
  const next =
    type === 'image' && typeof props.url === 'string'
      ? { ...props, url: assets.restore(props.url) }
      : props;

  return { ...block, props: next, children: children?.map((child) => restoreBlock(child, assets)) };
}

function restoreContent(
  command: EditObjectContentCommand,
  assets: Assets,
): EditObjectContentCommand {
  const { edit } = command;
  if (edit.kind !== 'document') {
    return command;
  }

  const { value } = edit;
  const { document } = value;
  return {
    ...command,
    edit: {
      kind: 'document',
      value: {
        ...value,
        document: {
          ...document,
          blocks: document.blocks.map((block) => restoreBlock(block, assets)),
        },
      },
    },
  };
}

function services(bridge: Bridge) {
  const { assets, postProtobuf } = bridge;
  const scene = createWhiteboardService(postProtobuf);
  const edits = createWhiteboardEditService(postProtobuf);
  const history = createBoardHistoryService(postProtobuf, undefined, renderBrowserVectorExport);

  function resolvePayloads(payloads: readonly WhiteboardPayloadResult[], signal?: AbortSignal) {
    return Promise.all(payloads.map((item) => resolvePayload(item, assets, signal)));
  }

  async function resolveReceipt(
    receipt: BoardEditReceipt,
    signal?: AbortSignal,
  ): Promise<BoardEditReceipt> {
    if (receipt.kind === 'rejected') {
      return receipt;
    }

    return { ...receipt, payloads: await resolvePayloads(receipt.payloads, signal) };
  }

  const service: StudioAppProps['service'] = {
    ...scene,
    async getPayloads(boardId, ids, signal) {
      return resolvePayloads(await scene.getPayloads(boardId, ids, signal), signal);
    },
  };
  const editService: StudioAppProps['editService'] = {
    async uploadDocumentImage(command, signal) {
      if (!edits.uploadDocumentImage) {
        throw new Error('当前白板服务暂未提供文档图片上传。');
      }

      return edits.uploadDocumentImage(command, signal);
    },
    async editGeometry(command, signal) {
      return resolveReceipt(await edits.editGeometry(command, signal), signal);
    },
    async editContent(command, signal) {
      return resolveReceipt(
        await edits.editContent(restoreContent(command, assets), signal),
        signal,
      );
    },
    async reverseEdit(command, signal) {
      if (!edits.reverseEdit) {
        throw new Error('当前白板服务暂未提供撤销或重做。');
      }

      return resolveReceipt(await edits.reverseEdit(command, signal), signal);
    },
    async attachImage(command, signal) {
      return resolveReceipt(await edits.attachImage(command, signal), signal);
    },
    async attachVideo(command, signal) {
      if (!edits.attachVideo) {
        throw new Error('当前白板服务暂未提供视频上传。');
      }

      return resolveReceipt(await edits.attachVideo(command, signal), signal);
    },
    async getReceipt(boardId, commandId, signal) {
      const receipt = await edits.getReceipt(boardId, commandId, signal);
      return receipt && resolveReceipt(receipt, signal);
    },
  };
  const historyService: StudioAppProps['historyService'] = {
    ...history,
    async getVersionPayloads(boardId, revision, ids, signal) {
      return resolvePayloads(
        await history.getVersionPayloads(boardId, revision, ids, signal),
        signal,
      );
    },
    async restoreVersion(command, signal) {
      return resolveReceipt(await history.restoreVersion(command, signal), signal);
    },
    async getRestoreReceipt(boardId, commandId, signal) {
      const receipt = await history.getRestoreReceipt(boardId, commandId, signal);
      return receipt && resolveReceipt(receipt, signal);
    },
  };

  const review = createSuggestionService(postProtobuf, editService);
  const suggestions: SuggestionService = {
    ...review,
    async previewSuggestion(query, signal) {
      const result = await review.previewSuggestion(query, signal);
      if (result.kind !== 'preview') {
        return result;
      }

      const { frame } = result;
      const payloads = await resolvePayloads(frame.changes.payloads, signal);
      return { ...result, frame: { ...frame, changes: { ...frame.changes, payloads } } };
    },
    async acceptSuggestion(command, signal) {
      return resolveReceipt(await review.acceptSuggestion(command, signal), signal);
    },
  };

  return { service, editService, historyService, suggestions };
}

function mount(bridge: Bridge) {
  const { postProtobuf, navigation, preferences } = bridge;
  const room = createBoardRoomService(postProtobuf, { observeSnapshots: observeMcpRoomSnapshots });

  function createRoomSession(boardId: string) {
    return createBoardRoomSession({
      boardId,
      viewId: createMcpCommandId(),
      service: room,
      clock: boardRoomClock,
      observation: 'snapshot',
    });
  }

  root.render(
    <StudioApp
      {...services(bridge)}
      catalog={createBoardCatalogService(postProtobuf)}
      catalogManagement={createCatalogManagementService(postProtobuf)}
      feedbackService={createBoardFeedbackService(postProtobuf)}
      createRoomSession={createRoomSession}
      archiveImport={createArchiveImportService(bridge.postArchive, postProtobuf)}
      sharingService={createBoardSharingService(postProtobuf)}
      copyShareLink={copyShareLink}
      exportBoard={createWhiteboardExportService(postProtobuf, renderBrowserVectorExport)}
      downloadExport={downloadBoardFile}
      downloadObjectFile={downloadBoardFile}
      clipboard={{ writeText: copyShareLink, readText: readCanvasClipboard }}
      localDrafts={{ actorId: 'mcp-owner', storage: createBoardDraftStorage(createMcpCommandId) }}
      readDocumentAsset={(boardId, source, signal) =>
        bridge.assets.readImage(boardId, source, signal)
      }
      readDocumentImageFile={readDocumentImageFile}
      readHtmlSource={readHtmlSource}
      prepareImage={prepareBoardImage}
      prepareVideo={prepareBoardVideo}
      createCommandId={createMcpCommandId}
      navigation={navigation}
      preferences={{ ...preferences, ...preferences.read() }}
      onViewContext={bridge.updateViewContext}
      onAttachReviewSource={bridge.attachReviewSource}
    />,
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('缺少白板面板挂载点。');
}

const root = createRoot(container);
root.render(<p role="status">正在连接鹿鸣工作台…</p>);
connectMcpApp(() => root.unmount())
  .then(mount)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '鹿鸣面板连接失败。';
    root.render(<p role="alert">{message}</p>);
  });
