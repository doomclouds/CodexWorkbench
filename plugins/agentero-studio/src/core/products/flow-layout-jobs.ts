import { Worker as NodeWorker } from 'node:worker_threads';
import { URL as NodeURL } from 'node:url';
import type { ElkNode } from 'elkjs/lib/elk-api.js';
import { StudioError } from '../shared/common.js';

export interface LayoutWorkerResult { graph: ElkNode; threadId: number }
interface Job { stop(error: StudioError): Promise<void> }

/** Explicitly requested layout work is isolated from the service event loop. */
export class FlowLayoutJobs {
  private readonly jobs = new Map<string, Job>();
  private readonly cancelled = new Set<string>();
  private closed = false;
  get activeCount() { return this.jobs.size; }
  private key(artifactId: string, actorId: string, requestId: string) { return JSON.stringify([artifactId, actorId, requestId]); }
  async run(artifactId: string, actorId: string, requestId: string, graph: ElkNode): Promise<LayoutWorkerResult> {
    if (this.closed) throw new StudioError('CLOSED', '布局服务已经关闭。');
    const key = this.key(artifactId, actorId, requestId);
    if (this.cancelled.delete(key)) throw new StudioError('LAYOUT_CANCELLED', '已取消布局计算。');
    if (this.jobs.has(key)) throw new StudioError('BUSY', '这次布局仍在计算，请等待完成或取消。');
    if (this.jobs.size >= 2) throw new StudioError('BUSY', '已有两项布局正在计算，请稍后重试。');
    const worker = new NodeWorker(new NodeURL('./flow-layout-worker.mjs', import.meta.url), { workerData: { graph }, stdout: true, stderr: true });
    // The engine reports failures through messages; incidental logs cannot corrupt MCP stdout.
    worker.stdout.resume(); worker.stderr.resume();
    return new Promise<LayoutWorkerResult>((resolve, reject) => {
      let ending: Promise<void> | undefined;
      const finish = (result?: LayoutWorkerResult, error?: StudioError): Promise<void> => ending ??= (async () => {
        clearTimeout(timer);
        await worker.terminate();
        worker.removeAllListeners(); this.jobs.delete(key);
        if (error) reject(error); else resolve(result!);
      })();
      const timer = setTimeout(() => { void finish(undefined, new StudioError('LAYOUT_TIMEOUT', '布局计算超过 15 秒，请缩小选区后重试。')); }, 15_000);
      this.jobs.set(key, { stop: error => finish(undefined, error) });
      worker.once('message', (message: { ok: true; graph: ElkNode; threadId: number } | { ok: false; error: string }) => {
        if (message.ok) void finish({ graph: message.graph, threadId: message.threadId });
        else void finish(undefined, new StudioError('LAYOUT_FAILED', `布局计算失败：${message.error}`));
      });
      worker.once('error', error => { void finish(undefined, new StudioError('LAYOUT_FAILED', `布局线程无法运行：${error.message}`)); });
      worker.once('exit', () => { if (!ending) void finish(undefined, new StudioError('LAYOUT_FAILED', '布局线程提前退出，未得到预览。')); });
    });
  }
  async cancel(artifactId: string, actorId: string, requestId: string): Promise<boolean> {
    const job = this.jobs.get(this.key(artifactId, actorId, requestId));
    if (!job) {
      // Cancel can overtake the snapshot read before the worker has been registered.
      this.cancelled.add(this.key(artifactId, actorId, requestId));
      while (this.cancelled.size > 200) this.cancelled.delete(this.cancelled.values().next().value!);
      return false;
    }
    await job.stop(new StudioError('LAYOUT_CANCELLED', '已取消布局计算。')); return true;
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.jobs.values()].map(job => job.stop(new StudioError('LAYOUT_CANCELLED', '布局服务关闭，计算已取消。'))));
  }
}
