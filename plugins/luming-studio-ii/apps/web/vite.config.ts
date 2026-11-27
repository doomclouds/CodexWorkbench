import { fileURLToPath } from 'node:url';
import { defineConfig, type ProxyOptions, type UserConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const whiteboardRpcPrefix = '/luming.studio.v1.WhiteboardService/';
const boardEditRpcPrefix = '/luming.studio.v1.BoardEditService/';
const boardHistoryRpcPrefix = '/luming.studio.v1.BoardHistoryService/';
const feedbackRpcPrefix = '/luming.studio.v1.FeedbackService/';
const catalogRpcPrefix = '/luming.studio.v1.BoardCatalogService/';
const archiveRpcPrefix = '/luming.studio.v1.BoardArchiveService/';
const sharingRpcPrefix = '/luming.studio.v1.BoardSharingService/';
const suggestionRpcPrefix = '/luming.studio.v1.BoardSuggestionService/';
const roomRpcPrefix = '/luming.studio.v1.BoardRoomService/';
const roomEventPath = '/studio-room-events';
const archiveAssetsPrefix = '/studio-archive-assets/';

const editorPackages = [
  '@blocknote/core',
  '@blocknote/core/locales',
  '@blocknote/react',
  '@blocknote/ariakit',
];

function entry(path: string) {
  return fileURLToPath(new URL(path, import.meta.url));
}

function whiteboardProxy(): Record<string, ProxyOptions> {
  const endpoint = process.env.LUMING_STUDIO_II_WEB_API;
  const token = process.env.LUMING_STUDIO_II_TOKEN;
  if (!endpoint || !token) {
    throw new Error('Set LUMING_STUDIO_II_WEB_API and LUMING_STUDIO_II_TOKEN.');
  }

  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('The whiteboard API must use an HTTP loopback address.');
  }
  if (url.href !== url.origin + '/') {
    throw new Error('Set the whiteboard API to a bare origin.');
  }

  const proxy: ProxyOptions = {
    target: url.origin,
    headers: { authorization: 'Bearer ' + token },
    configure(proxy) {
      proxy.on('proxyReq', (outgoing, incoming) => {
        const incomingUrl = URL.parse(incoming.url ?? '', url.origin);
        const roomEvent = incomingUrl?.pathname === roomEventPath;
        const guestRoom = roomEvent && incomingUrl.searchParams.get('guest') === '1';
        const guest = incoming.headers['x-luming-guest'] === '1' || guestRoom;
        if (guest) {
          outgoing.removeHeader('authorization');
        }

        outgoing.removeHeader('x-luming-guest');
      });
    },
  };

  return {
    [whiteboardRpcPrefix]: proxy,
    [boardEditRpcPrefix]: proxy,
    [boardHistoryRpcPrefix]: proxy,
    [feedbackRpcPrefix]: proxy,
    [catalogRpcPrefix]: proxy,
    [archiveRpcPrefix]: proxy,
    [sharingRpcPrefix]: proxy,
    [suggestionRpcPrefix]: proxy,
    [roomRpcPrefix]: proxy,
    [roomEventPath]: proxy,
    [archiveAssetsPrefix]: proxy,
  };
}

const libraryConfig = {
  optimizeDeps: {
    include: editorPackages,
  },
  build: {
    cssCodeSplit: true,
    lib: {
      entry: {
        'base-ui': entry('./src/ui/base/index.ts'),
        'canvas-ui': entry('./src/ui/domain/canvas/index.ts'),
        'studio-objects': entry('./src/ui/domain/objects/index.ts'),
        'document-object': entry('./src/ui/domain/objects/document/index.ts'),
        'embed-object': entry('./src/ui/domain/objects/embed/index.ts'),
        'media-object': entry('./src/ui/domain/objects/media/index.ts'),
        'sticker-object': entry('./src/ui/domain/objects/sticker/index.ts'),
        'table-object': entry('./src/ui/domain/objects/table/index.ts'),
        'text-object': entry('./src/ui/domain/objects/text/index.ts'),
        'todo-object': entry('./src/ui/domain/objects/todo/index.ts'),
      },
      formats: ['es'],
    },
    rolldownOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', ...editorPackages],
    },
  },
} satisfies UserConfig;

export default defineConfig(({ command, mode }) => {
  if (mode === 'mcp') {
    return {
      plugins: [viteSingleFile()],
      build: {
        outDir: 'dist/mcp',
        rolldownOptions: { input: entry('./mcp.html') },
      },
    };
  }
  if (mode !== 'whiteboard') {
    return libraryConfig;
  }

  return {
    optimizeDeps: libraryConfig.optimizeDeps,
    build: { outDir: 'dist/app' },
    server: command === 'serve' ? { proxy: whiteboardProxy() } : undefined,
  };
});
