import type {
  EditObjectContentCommand,
  WhiteboardDocumentBlock,
  WhiteboardPayloadResult,
} from '../data/whiteboard/index.js';

interface AssetUrls {
  resolve(source: string, signal?: AbortSignal): Promise<string>;
  restore(source: string): string;
}

type Fields = Readonly<Record<string, unknown>>;

function fields(value: unknown): Fields | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Fields;
  }
}

function resolveField(source: unknown, assets: AssetUrls, signal?: AbortSignal): unknown {
  return typeof source === 'string' ? assets.resolve(source, signal) : source;
}

async function resolveBlock(
  value: unknown,
  assets: AssetUrls,
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

export async function resolveMcpPayload(
  result: WhiteboardPayloadResult,
  assets: AssetUrls,
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

function restoreBlock(block: WhiteboardDocumentBlock, assets: AssetUrls): WhiteboardDocumentBlock {
  const { type, props, children } = block;
  const next =
    type === 'image' && typeof props.url === 'string'
      ? { ...props, url: assets.restore(props.url) }
      : props;

  return { ...block, props: next, children: children?.map((child) => restoreBlock(child, assets)) };
}

export function restoreMcpContent(
  command: EditObjectContentCommand,
  assets: AssetUrls,
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
