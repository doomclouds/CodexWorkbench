import { expect, it } from 'vitest';
import type { BoardElement } from '../src/contracts/studio.js';
import { prepareFlowLayout, finishFlowLayout } from '../src/core/products/flow-layout.js';
import { FlowLayoutJobs } from '../src/core/products/flow-layout-jobs.js';

it('uses the stable model order for an otherwise ambiguous cycle rather than moving the entry after its return edge', async () => {
  const node = (id: string, x: number): BoardElement => ({ id, type: 'shape', x, y: 20, w: 150, h: 80, version: 1, text: id });
  const nodes = [node('entry', 80), node('check', 350), node('process', 680), node('finish', 300)];
  const edge = (id: string, from: string, to: string): BoardElement => ({ id, type: 'arrow', x: 0, y: 0, w: 1, h: 1, version: 1, from, to });
  const elements = [...nodes, edge('entry-check', 'entry', 'check'), edge('check-process', 'check', 'process'), edge('check-finish', 'check', 'finish'), edge('process-finish', 'process', 'finish'), edge('return', 'finish', 'entry')];
  const prepared = prepareFlowLayout(elements, { ids: nodes.map(item => item.id), requestId: 'cycle-order' });
  const jobs = new FlowLayoutJobs();
  try {
    const result = await jobs.run('board', 'owner', 'cycle-order', prepared.graph!);
    const preview = finishFlowLayout(prepared, result.graph);
    expect(preview.skipped).toEqual([]);
    const positions = Object.fromEntries(elements.map(item => [item.id, { ...item, ...preview.operations.find(operation => operation.id === item.id)?.changes }]));
    expect(positions.entry.x).toBeLessThan(positions.check.x); expect(positions.check.x).toBeLessThan(positions.process.x); expect(positions.process.x).toBeLessThan(positions.finish.x);
    expect(positions.return).toMatchObject({ from: 'finish', to: 'entry' });
  } finally { await jobs.close(); }
});
