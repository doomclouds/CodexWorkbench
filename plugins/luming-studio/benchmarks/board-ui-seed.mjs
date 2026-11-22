import assert from 'node:assert/strict';

const maxSeedOperations = 200;
const maxSeedBytes = 9 * 1024 * 1024;
const operationBudget = maxSeedBytes - 1024;

function seedBatches(elements) {
  const batches = [];
  let operations = [];
  let bytes = 0;
  for (const element of elements) {
    const operation = { op: 'add', element };
    const size = Buffer.byteLength(JSON.stringify(operation)) + 1;
    assert(size <= operationBudget, 'A seed object exceeds the tool request byte budget');
    if (operations.length === maxSeedOperations || bytes + size > operationBudget) {
      batches.push(operations);
      operations = [];
      bytes = 0;
    }
    operations.push(operation);
    bytes += size;
  }
  if (operations.length) {
    batches.push(operations);
  }

  return batches;
}

export async function seedExpandedBoard(tool, title, elements) {
  const { artifact } = await tool('artifact_manage', {
    action: 'create',
    type: 'whiteboard',
    title,
  });
  const requests = [];
  let current = artifact;
  for (const operations of seedBatches(elements)) {
    const args = {
      artifactId: current.id,
      expectedRevision: current.revision,
      operationId: 'board-ui-seed-' + requests.length,
      receiptFormat: 'units-v1',
      operations,
    };
    const requestBytes = Buffer.byteLength(JSON.stringify(args));
    assert(requestBytes <= maxSeedBytes, 'Expanded seed request exceeds the tool byte limit');
    const response = await tool('artifact_apply', args);
    const next = response.artifact ?? response.board?.artifact;
    assert.equal(next?.id, current.id, 'Expanded seed receipt belongs to a different board');
    assert.equal(next.revision, current.revision + 1, 'Expanded seed did not save a new revision');
    requests.push({ operations: operations.length, requestBytes, revision: next.revision });
    current = next;
  }

  return { artifact: current, seedRequests: requests };
}
