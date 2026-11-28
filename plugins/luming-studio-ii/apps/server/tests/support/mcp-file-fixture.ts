import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpFileAccess } from '../../src/infrastructure/platform/index.js';

export async function openMcpFileFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'luming-mcp-files-')));

  return {
    root,
    access: createMcpFileAccess(root, 32),
    close: () => rm(root, { recursive: true }),
  };
}
