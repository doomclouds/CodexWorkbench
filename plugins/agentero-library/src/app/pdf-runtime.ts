import * as pdfjs from 'pdfjs-dist';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';

// Use the upstream in-page worker implementation: the self-contained MCP App
// does not need an HTTP worker URL, a CDN, eval, or blob-worker CSP allowances.
Object.assign(globalThis, { pdfjsWorker: { WorkerMessageHandler } });
export { pdfjs };
