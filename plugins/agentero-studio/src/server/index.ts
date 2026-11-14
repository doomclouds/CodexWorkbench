import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { connectStudio, dataDirectory, hasActiveLeases, readRecord, writeRecord } from './client.js';
import { createStudioServer } from './protocol.js';

const option = (key: string) => { const index = process.argv.indexOf(key); return index < 0 ? undefined : process.argv[index + 1]; };
const root = dataDirectory(option('--data-root'));
const html = await readFile(new URL('./app.html', import.meta.url), 'utf8');
if (process.argv.includes('--serve')) {
  const { startStudioHost } = await import('./http.js');
  const host = await startStudioHost({ dataRoot: root, html, port: Number(option('--port') || 0) });
  await writeRecord(root, { origin: host.origin, token: host.token, pid: process.pid, instanceId: randomUUID() });
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    if ((await readRecord(root))?.pid === process.pid) await unlink(join(root, 'service.json')).catch(() => {});
    await host.close();
  })();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void close().finally(() => process.exit(0)); });
  if (process.argv.includes('--managed')) {
    let lastActive = Date.now();
    setInterval(() => { void hasActiveLeases(root).then(active => { if (active) lastActive = Date.now(); else if (Date.now() - lastActive > 45_000) void close().finally(() => process.exit(0)); }); }, 10_000).unref();
  }
  process.stderr.write(`Agentero Studio: ${host.origin}\n`);
} else {
  const client = await connectStudio(root, fileURLToPath(import.meta.url));
  const server = createStudioServer(client, html);
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => { await client.close(); await server.close(); })();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void close().finally(() => process.exit(0)); });
  process.stdin.once('end', () => { void close().finally(() => process.exit(0)); });
  await server.connect(new StdioServerTransport());
}
