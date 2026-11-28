import { McpPanelViewService } from '@codexworkbench/luming-studio-ii-contracts/rooms/service';
import { BridgeError, invalidArgument } from './errors.js';
import { callModelRpc, type ModelToolOptions } from './model-tool.js';
import type { BridgeInput } from './schema.js';

const { updatePanelView, readPanelView } = McpPanelViewService.method;
const clearTimeoutMillis = 2_000;

type UpdateInput = Extract<BridgeInput, { action: 'view' }>;
type DispatchOptions = Pick<ModelToolOptions, 'dispatch'>;

interface Lease {
  readonly id: string;
  readonly boardId?: string;
  readonly expiresAtMillis: number;
}

interface ViewBinding {
  readonly viewId: string;
  readonly sequence: number;
  readonly expiresAtMillis: number;
}

export function createPanelViewBridge(options: DispatchOptions) {
  const bindings = new Map<string, ViewBinding>();

  return {
    async update(lease: Lease, { viewId, sequence, state }: UpdateInput, signal: AbortSignal) {
      const before = bindings.get(lease.id);
      if (before && before.viewId !== viewId) {
        throw invalidArgument('请求视图不属于当前面板。');
      }
      if (state && lease.boardId && state.boardId !== lease.boardId) {
        throw invalidArgument('请求白板不属于当前面板。');
      }
      if (sequence < (before?.sequence ?? 0) || (!before && !state)) {
        return;
      }

      bindings.set(lease.id, { viewId, sequence, expiresAtMillis: lease.expiresAtMillis });
      await callModelRpc(
        options,
        updatePanelView,
        {
          sessionId: lease.id,
          sessionExpiresAtMillis: BigInt(lease.expiresAtMillis),
          viewId,
          sequence: BigInt(sequence),
          update: state ? { case: 'state', value: state } : { case: 'clear', value: true },
        },
        signal,
      );
    },
    async close(sessionId: string) {
      const binding = bindings.get(sessionId);
      if (!binding) {
        return;
      }

      bindings.delete(sessionId);
      await callModelRpc(
        options,
        updatePanelView,
        {
          sessionId,
          viewId: binding.viewId,
          sequence: BigInt(binding.sequence),
          sessionExpiresAtMillis: BigInt(binding.expiresAtMillis),
          update: { case: 'clear', value: true },
        },
        AbortSignal.timeout(clearTimeoutMillis),
      );
    },
  };
}

export async function readActivePanelView(
  options: DispatchOptions,
  boardId: string,
  viewId: string,
  signal: AbortSignal,
) {
  const { state, updatedAtMillis } = await callModelRpc(
    options,
    readPanelView,
    { boardId, viewId },
    signal,
    16 * 1024,
  );

  if (!state) {
    return;
  }
  if (state.boardId !== boardId || !state.viewport || updatedAtMillis === undefined) {
    throw new BridgeError('UNAVAILABLE', '白板视图结果无法核对。');
  }

  const { selectedIds, selectedCount, viewport, focusedObjectId, returnViewport } = state;
  const camera = ({ x, y, zoom }: typeof viewport) => ({ x, y, zoom });
  return {
    boardId,
    viewId,
    source: 'live-panel',
    contexts: [
      {
        boardId,
        viewId,
        selectedIds,
        selectedCount,
        viewport: camera(viewport),
        focusedObjectId,
        returnViewport: returnViewport && camera(returnViewport),
        updatedAtMillis: updatedAtMillis.toString(),
      },
    ],
  };
}
