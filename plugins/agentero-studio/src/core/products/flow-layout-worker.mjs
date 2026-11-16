// ELK 0.12.1 is unmodified third-party code (EPL-2.0 OR GPL-3.0-or-later).
// Source: https://github.com/kieler/elkjs/tree/624ae90aa37110033a8af59c5ccbb292708b4317
import { parentPort, workerData, threadId } from 'node:worker_threads';
import ELK from 'elkjs/lib/elk.bundled.js';

try {
  const elk = new ELK({ algorithms: ['layered'] });
  const graph = await elk.layout(workerData.graph);
  parentPort.postMessage({ ok: true, graph, threadId });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
} finally {
  parentPort.close();
}
