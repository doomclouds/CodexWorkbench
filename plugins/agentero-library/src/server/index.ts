import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LibraryService } from '../core/library-service.js';
import { createLibraryServer } from './server.js';

const argumentIndex = process.argv.indexOf('--data-root');
const service = new LibraryService({ dataRoot: argumentIndex >= 0 ? process.argv[argumentIndex + 1] : undefined });
const server = createLibraryServer(service);
let closing: Promise<void> | undefined;
const shutdown = () => closing ??= (async () => { await service.close(); await server.close(); })();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void shutdown().finally(() => process.exit(0)); });
process.stdin.once('end', () => { void shutdown().finally(() => process.exit(0)); });
await server.connect(new StdioServerTransport());
