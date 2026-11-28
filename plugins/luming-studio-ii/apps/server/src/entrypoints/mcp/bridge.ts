import { fromBinary } from '@bufbuild/protobuf';
import { WhiteboardService } from '@codexworkbench/luming-studio-ii-contracts/whiteboard/service';
import { BridgeError, invalidArgument, tooLarge } from './errors.js';
import { appOperation, archiveMediaType } from './operations.js';
import { createPanelViewBridge } from './panel-view.js';
import type { BridgeInput } from './schema.js';
import { createTransfers, decodeChunk, type TransferFile } from './transfers.js';

export interface LocalRequest {
  readonly route: string;
  readonly method: 'GET' | 'POST';
  readonly mediaType?: string;
  readonly commandId?: string;
  readonly body?: Uint8Array | Blob;
}

export interface AppBridgeOptions {
  readonly now: () => number;
  readonly allocateId: () => string;
  readonly createFile: () => Promise<TransferFile>;
  readonly dispatch: (request: LocalRequest, signal: AbortSignal) => Promise<Response>;
}

interface Session {
  readonly id: string;
  readonly expiresAtMillis: number;
  readonly boardId?: string;
}

type Request = Extract<BridgeInput, { action: 'request' }>;

const maximumSessions = 32;
const sessionLifetimeMillis = 30 * 60_000;

function boardFromMessage(bytes: Uint8Array): string {
  try {
    return fromBinary(WhiteboardService.method.getBoardScene.input, bytes, {
      readUnknownFields: false,
    }).boardId;
  } catch (error) {
    throw new BridgeError('INVALID_ARGUMENT', '面板请求包含无效的白板消息。', { cause: error });
  }
}

async function validateBoard(
  boardId: string | undefined,
  boardField: number | undefined,
  body: Uint8Array | Blob | undefined,
): Promise<void> {
  if (!boardId || boardField === undefined) {
    return;
  }

  const bytes = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body;
  if (!bytes || boardFromMessage(bytes) !== boardId) {
    throw invalidArgument('请求白板不属于当前面板。');
  }
}

export function createAppBridge(options: AppBridgeOptions) {
  const sessions = new Map<string, Session>();
  const transfers = createTransfers(options.allocateId, options.createFile);
  const panelViews = createPanelViewBridge(options);

  async function closeSession(id: string) {
    sessions.delete(id);
    await Promise.all([transfers.closeSession(id), panelViews.close(id)]);
  }

  async function connect(boardId?: string) {
    const now = options.now();
    const expired = [...sessions.values()].filter((session) => session.expiresAtMillis <= now);
    await Promise.all(expired.map(({ id }) => closeSession(id)));
    if (sessions.size >= maximumSessions) {
      throw tooLarge('打开的 Studio 面板数已达到上限。');
    }

    const id = options.allocateId();
    const expiresAtMillis = now + sessionLifetimeMillis;
    sessions.set(id, { id, expiresAtMillis, boardId });

    return { id, expiresAtMillis };
  }

  async function readSession(id: string): Promise<Session> {
    const session = sessions.get(id);
    if (!session || session.expiresAtMillis <= options.now()) {
      await closeSession(id);
      throw new BridgeError('SESSION_EXPIRED', 'Studio 面板会话已过期，请重新连接。');
    }

    return session;
  }

  async function request(session: Session, input: Request, signal: AbortSignal) {
    const operation = appOperation(input.service, input.method);
    if (!operation) {
      throw invalidArgument('该业务操作未开放给 Studio 面板。');
    }

    const { route, mediaType, maximumBytes, boardField } = operation;
    if (input.body !== undefined && input.uploadId !== undefined) {
      throw invalidArgument('内联内容和分块上传只能使用一种。');
    }

    const requiresCommand = mediaType === archiveMediaType;
    if (requiresCommand !== (input.commandId !== undefined)) {
      throw invalidArgument('归档导入必须携带原命令 ID。');
    }
    if (requiresCommand && input.body === undefined && input.uploadId === undefined) {
      throw invalidArgument('缺少需要导入的归档文件。');
    }

    async function dispatch(body: Uint8Array | Blob | undefined) {
      await validateBoard(session.boardId, boardField, body);
      signal.throwIfAborted();
      await readSession(session.id);
      const local: LocalRequest = {
        route,
        mediaType,
        commandId: input.commandId,
        method: 'POST',
        body,
      };
      const response = await options.dispatch(local, signal);
      const result = await transfers.receive(session.id, response, signal);
      await readSession(session.id);

      return result;
    }

    return input.uploadId
      ? transfers.withUpload(session.id, input.uploadId, maximumBytes, dispatch)
      : dispatch(input.body === undefined ? undefined : decodeChunk(input.body));
  }

  async function execute(
    input: BridgeInput,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    if (input.action === 'connect') {
      return { session: await connect(input.boardId) };
    }

    const session = await readSession(input.sessionId);
    switch (input.action) {
      case 'request':
        return { response: await request(session, input, signal) };
      case 'view':
        await panelViews.update(session, input, signal);
        return {};
      case 'asset': {
        if (session.boardId && session.boardId !== input.boardId) {
          throw invalidArgument('素材不属于当前面板的白板。');
        }

        const route = '/studio-archive-assets/' + input.boardId + '/' + input.assetId;
        const response = await options.dispatch({ method: 'GET', route }, signal);
        const result = await transfers.receive(session.id, response, signal);
        await readSession(session.id);

        return { response: result };
      }
      case 'upload':
        return { transfer: await transfers.upload(input) };
      case 'download':
        return { chunk: await transfers.download(session.id, input.transferId, input.offset) };
      case 'release':
        await transfers.release(session.id, input.transferId);
        return {};
      case 'close':
        await closeSession(session.id);
        return {};
    }
  }

  async function close(): Promise<void> {
    await Promise.all([...sessions.keys()].map((id) => closeSession(id)));
  }

  return { connect, execute, close };
}
