import { createRoot } from 'react-dom/client';
import { createArchiveImportService } from '../data/archive-import/index.js';
import {
  createBoardCatalogService,
  createCatalogManagementService,
  createWorkbenchPreferencesService,
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
import type { BoardEditReceipt, WhiteboardPayloadResult } from '../data/whiteboard/index.js';
import {
  boardRoomClock,
  copyShareLink,
  createBoardDraftStorage,
  downloadBoardFile,
  observeBoardRoomVisibility,
  prepareBoardImage,
  prepareBoardVideo,
  readCanvasClipboard,
  readDocumentImageFile,
  readHtmlSource,
  renderBrowserVectorExport,
} from '../platform/browser/index.js';
import { connectMcpApp, createMcpCommandId, observeMcpRoomEvents } from '../platform/mcp/index.js';
import { StudioApp } from './index.js';
import type { StudioAppProps } from './index.js';
import { resolveMcpPayload, restoreMcpContent } from './mcp-whiteboard-assets.js';

type Bridge = Awaited<ReturnType<typeof connectMcpApp>>;

function services(bridge: Bridge) {
  const { assets, postProtobuf } = bridge;
  const scene = createWhiteboardService(postProtobuf);
  const edits = createWhiteboardEditService(postProtobuf);
  const history = createBoardHistoryService(postProtobuf, undefined, renderBrowserVectorExport);

  function resolvePayloads(payloads: readonly WhiteboardPayloadResult[], signal?: AbortSignal) {
    return Promise.all(payloads.map((item) => resolveMcpPayload(item, assets, signal)));
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
    async getScene(boardId, signal) {
      try {
        return await scene.getScene(boardId, signal);
      } catch (error) {
        if (!signal?.aborted) {
          bridge.handleBoardLoadFailure(boardId, error);
        }
        throw error;
      }
    },
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
        await edits.editContent(restoreMcpContent(command, assets), signal),
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

async function mount(bridge: Bridge) {
  const { postProtobuf, navigation, preferences } = bridge;
  if (!(await preferences.initialize(createWorkbenchPreferencesService(postProtobuf)))) {
    return;
  }

  const room = createBoardRoomService(postProtobuf, { waitForEvents: observeMcpRoomEvents });

  function createRoomSession(boardId: string) {
    return createBoardRoomSession({
      boardId,
      viewId: createMcpCommandId(),
      service: room,
      clock: boardRoomClock,
      visibility: observeBoardRoomVisibility,
      observation: 'snapshot',
    });
  }

  root.render(
    <StudioApp
      {...services(bridge)}
      catalog={createBoardCatalogService(postProtobuf, observeBoardRoomVisibility)}
      catalogManagement={createCatalogManagementService(postProtobuf)}
      feedbackService={createBoardFeedbackService(postProtobuf)}
      createRoomSession={createRoomSession}
      archiveImport={createArchiveImportService(bridge.postArchive, postProtobuf)}
      sharingService={createBoardSharingService(postProtobuf)}
      copyShareLink={copyShareLink}
      exportBoard={createWhiteboardExportService(postProtobuf, renderBrowserVectorExport)}
      downloadExport={bridge.downloadFile}
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
root.render(
  <div className="studio-mcp-startup" role="status">
    <span className="studio-mcp-startup__spinner" aria-hidden="true" />
    <span className="studio-mcp-startup__label">正在连接鹿鸣工作台…</span>
  </div>,
);
connectMcpApp(() => root.unmount())
  .then(mount)
  .catch((error: unknown) => {
    const message = (error instanceof Error && error.message) || '鹿鸣面板连接失败。';
    root.render(
      <div className="studio-mcp-startup">
        <p className="studio-mcp-startup__error" role="alert">
          {message}
        </p>
      </div>,
    );
  });
