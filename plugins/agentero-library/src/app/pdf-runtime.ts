import * as pdfjs from 'pdfjs-dist';
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';
import { launchPdfWorker, type PdfWorkerFailure } from './pdf/worker-controller';

export async function createPdfWorker(options: { signal?: AbortSignal; onFailure?: (error: PdfWorkerFailure) => void } = {}) {
  const owned = await launchPdfWorker(workerSource, { ...options, pdfjsVersion: pdfjs.version });
  try {
    options.signal?.throwIfAborted();
    // Supplying an actual port bypasses PDF.js' automatic fake-worker fallback.
    const worker = pdfjs.PDFWorker.create({ port: owned.port });
    await worker.promise;
    let closed = false;
    return { worker, dispose() { if (closed) return; closed = true; worker.destroy(); owned.dispose(); } };
  } catch (cause) { owned.dispose(); throw cause; }
}
export { pdfjs };
