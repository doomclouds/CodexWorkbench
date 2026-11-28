import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createModelSuggestionSubmitter } from '../entrypoints/http/index.js';
import { connectStudioMcpServer } from '../entrypoints/mcp/index.js';
import {
  createMcpFileAccess,
  createMcpSpool,
  loadMcpRuntime,
} from '../infrastructure/platform/index.js';
import { MAX_ARCHIVE_IMPORT_BYTES } from '../modules/archives/application/index.js';

const dataRootVariable = 'LUMING_STUDIO_II_DATA_ROOT';
const actorVariable = 'LUMING_STUDIO_II_ACTOR';

function dataRoot(): string {
  const args = process.argv.slice(2);
  if (args.length) {
    const [flag, directory] = args;
    if (flag !== '--data-root' || !directory || args.length !== 2) {
      throw new Error('Studio MCP accepts only --data-root <directory>.');
    }

    return directory;
  }

  return process.env[dataRootVariable] ?? join(homedir(), '.codexworkbench', 'luming-studio-ii');
}

function reportFailure(error: unknown) {
  const name = error instanceof Error ? error.name : 'UnknownError';
  process.stderr.write('Studio MCP request failed (' + name + ').\n');
}

const root = dataRoot();
const { dispatchAgentActivity, ...runtime } = await loadMcpRuntime({
  runtimeDirectory: fileURLToPath(new URL('.', import.meta.url)),
  dataRoot: root,
  actorId: process.env[actorVariable] ?? 'local',
});
const server = await connectStudioMcpServer({
  ...runtime,
  ...createMcpFileAccess(root, MAX_ARCHIVE_IMPORT_BYTES),
  dispatchAgentActivity,
  submitSuggestion: createModelSuggestionSubmitter(runtime.dispatchAgentSuggestion),
  now: Date.now,
  allocateId: randomUUID,
  createFile: createMcpSpool,
  onError: reportFailure,
});

function handleClose() {
  server.close().catch((error: unknown) => {
    reportFailure(error);
    process.exitCode = 1;
  });
}

process.once('SIGINT', handleClose);
process.once('SIGTERM', handleClose);
process.stdin.once('end', handleClose);
