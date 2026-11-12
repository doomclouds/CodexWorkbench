import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { lock } from 'proper-lockfile';
import { LibraryError } from '../contracts/errors.js';
import { containedPath } from './files.js';

/** Shared by all plugin MCP processes, outside the Vault and installation. */
export async function withPaperDocumentLock<T>(dataRoot: string, vaultPath: string, paperPath: string, run: (check: () => void, signal: AbortSignal) => Promise<T>, label = '这篇论文'): Promise<T> {
  const actual = await containedPath(vaultPath, paperPath, true);
  const identity = process.platform === 'win32' ? actual.toLowerCase() : actual;
  const key = createHash('sha256').update(identity).digest('hex');
  const directory = await containedPath(dataRoot, 'state/document-locks', true);
  await mkdir(directory, { recursive: true });
  const target = join(directory, key), controller = new AbortController();
  let compromised: Error | undefined;
  let release: () => Promise<void>;
  try {
    release = await lock(target, { realpath: false, stale: 60_000, update: 5000, retries: 0,
      onCompromised: error => { compromised = error; controller.abort(); } });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') throw new LibraryError('DOCUMENT_BUSY', `另一个插件进程正在处理${label}，请完成后重试；当前内容未被覆盖。`, true);
    throw error;
  }
  const check = () => { if (compromised) throw new LibraryError('DOCUMENT_LOCK_LOST', '论文操作锁已失效，请核实当前版本；不会自动重试保存。', false); };
  try {
    check(); const result = await run(check, controller.signal); check(); return result;
  } catch (error) {
    check(); throw error;
  } finally {
    // Never throw from the heartbeat callback or terminate a host MCP process.
    if (!compromised) await release();
  }
}
