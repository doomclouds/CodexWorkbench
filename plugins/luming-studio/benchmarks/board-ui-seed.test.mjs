import assert from 'node:assert/strict';
import test from 'node:test';
import { seedExpandedBoard } from './board-ui-seed.mjs';

test('seeds a large non-ASCII board in ordered UTF-8 and operation-bounded requests', async () => {
  const html = '鹿'.repeat(700_000);
  const elements = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: 'huge-' + index, type: 'html', html })),
    ...Array.from({ length: 201 }, (_, index) => ({ id: 'text-' + index, type: 'text' })),
  ];
  let revision = 0;
  const applied = [];
  const seen = [];

  async function tool(name, args) {
    if (name === 'artifact_manage') {
      assert.deepEqual(args, { action: 'create', type: 'whiteboard', title: 'Expanded' });
      return { artifact: { id: 'fixture', revision } };
    }

    const requestBytes = Buffer.byteLength(JSON.stringify(args));
    assert.equal(name, 'artifact_apply');
    assert.equal(args.expectedRevision, revision);
    assert(args.operations.length <= 200);
    assert(requestBytes <= 9 * 1024 * 1024);
    applied.push(...args.operations.map((operation) => operation.element));
    revision++;
    seen.push({ operations: args.operations.length, requestBytes, revision });
    const artifact = { id: 'fixture', revision };
    return revision % 2 ? { artifact } : { board: { artifact } };
  }

  const result = await seedExpandedBoard(tool, 'Expanded', elements);
  assert.deepEqual(applied, elements);
  assert.deepEqual(
    seen.map((request) => request.operations),
    [4, 200, 2],
  );
  assert.deepEqual(result, { artifact: { id: 'fixture', revision: 3 }, seedRequests: seen });
});
