import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { LibraryStatus } from '../contracts/types.js';
import { atomicJson, readJson } from './files.js';

export interface PdfDiagnosticIdentity { cliPath: string; pdfiumPath: string; cliVersion: string }
export const pdfDiagnosticKey = (identity: PdfDiagnosticIdentity) => createHash('sha256').update(JSON.stringify([identity.cliPath, identity.pdfiumPath, identity.cliVersion])).digest('hex');
const cachePath = (dataRoot: string) => join(dataRoot, 'state', 'pdf-diagnostic.json');

/** Reads are cheap and always observe another MCP instance's atomic update. */
export async function readPdfDiagnostic(dataRoot: string, identity: PdfDiagnosticIdentity): Promise<LibraryStatus['pdfium'] | undefined> {
  try {
    const value = await readJson(cachePath(dataRoot));
    if (!value || typeof value !== 'object') return undefined;
    const data = value as Record<string, unknown>;
    if (data.schemaVersion !== 1 || data.key !== pdfDiagnosticKey(identity) || typeof data.available !== 'boolean' || typeof data.diagnostic !== 'string' || typeof data.checkedAt !== 'string' || !Number.isFinite(Date.parse(data.checkedAt))) return undefined;
    return { configured: !!identity.pdfiumPath, path: identity.pdfiumPath, available: data.available, state: data.available ? 'available' : 'unavailable', checkedAt: data.checkedAt, diagnostic: data.diagnostic };
  } catch { return undefined; } // A missing/corrupt derived cache is unknown, not a configuration failure.
}

export async function writePdfDiagnostic(dataRoot: string, identity: PdfDiagnosticIdentity, result: LibraryStatus['pdfium']): Promise<void> {
  if (typeof result.available !== 'boolean' || !result.checkedAt) throw new Error('Only completed PDF diagnostics can be persisted.');
  await atomicJson(cachePath(dataRoot), { schemaVersion: 1, key: pdfDiagnosticKey(identity), identity, available: result.available, checkedAt: result.checkedAt, diagnostic: result.diagnostic });
}
