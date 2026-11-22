import { STUDIO_HOME_TITLE } from '../contracts/branding.js';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  connectStudio,
  dataDirectory,
  hasActiveLeases,
  readRecord,
  writeRecord,
} from './client.js';

const option = (key: string) => {
  const index = process.argv.indexOf(key);
  return index < 0 ? undefined : process.argv[index + 1];
};

function exitAfterClose(close: () => Promise<void>): void {
  close().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error('Studio 未能正常退出。', error);
      process.exit(1);
    },
  );
}

const root = dataDirectory(option('--data-root'));
const rollbackArtifact = option('--rollback-copy');
const html = await readFile(new URL('./app.html', import.meta.url), 'utf8');
if (process.argv.includes('--rollback-copy')) {
  if (!rollbackArtifact || !option('--data-root')) {
    throw new Error('Supply --rollback-copy <artifactId> and --data-root <directory>.');
  }

  const { createStudioService } = await import('./studio-composition.js');
  const service = createStudioService({ dataRoot: root });
  try {
    const rollbackRoot = await service.store.createLegacyRollback(rollbackArtifact);
    process.stdout.write(
      JSON.stringify({ artifactId: rollbackArtifact, dataRoot: rollbackRoot }) + '\n',
    );
  } finally {
    await service.close();
  }
} else if (process.argv.includes('--serve')) {
  const { startStudioHost } = await import('./http.js');
  const host = await startStudioHost({ dataRoot: root, html, port: Number(option('--port') || 0) });
  await writeRecord(root, {
    origin: host.origin,
    token: host.token,
    pid: process.pid,
    instanceId: randomUUID(),
  });
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      if ((await readRecord(root))?.pid === process.pid) {
        await unlink(join(root, 'service.json')).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') {
            console.error('Studio 未能清理服务记录。', error);
          }
        });
      }
      await host.close();
    })());

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      exitAfterClose(close);
    });
  }
  if (process.argv.includes('--managed')) {
    let lastActive = Date.now();
    setInterval(() => {
      hasActiveLeases(root)
        .then((active) => {
          if (active) {
            lastActive = Date.now();
          } else if (Date.now() - lastActive > 45_000) {
            exitAfterClose(close);
          }
        })
        .catch((error: unknown) => {
          console.error('Studio 无法检查活跃连接。', error);
        });
    }, 10_000).unref();
  }
  process.stderr.write(`${STUDIO_HOME_TITLE}: ${host.origin}\n`);
} else {
  const { createStudioServer } = await import('./protocol.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { createAppTransferSpool } = await import('./studio-composition.js');
  const client = await connectStudio(root, fileURLToPath(import.meta.url));
  const server = createStudioServer(client, html, createAppTransferSpool);
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await client.close();
      await server.close();
    })());

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      exitAfterClose(close);
    });
  }
  process.stdin.once('end', () => {
    exitAfterClose(close);
  });
  await server.connect(new StdioServerTransport());
}
