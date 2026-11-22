import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  LOCAL_ACTOR,
  STUDIO_TOOLS,
  type Actor,
  type Board,
  type BoardElement,
  type Operation,
  type StudioClient,
  type ToolName,
} from '../../src/contracts/studio.js';
import { NativeContentQueue } from '../../src/app/features/whiteboard/canvas/sync/content-queue.js';
import {
  sendCanvasSave,
  verifyCanvasSave,
} from '../../src/app/features/whiteboard/save-receipt.js';
import { SqliteArtifactRepository } from '../../src/infrastructure/sqlite-artifact.js';
import {
  createStudioService,
  type ComposedStudioService,
} from '../../src/server/studio-composition.js';

const folderPrefix = 'luming-local-unit-service-';
const target = 'editable-text';
const richHtml = '<p>' + '相邻富内容'.repeat(3_000) + '</p>';
const textElement = { id: target, type: 'text', text: '初稿', x: 10, y: 20, w: 100, h: 40 };
let directory: string;
let service: ComposedStudioService;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), folderPrefix));
  service = createStudioService({ dataRoot: directory });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await service.close();
  const [root, data] = await Promise.all([realpath(tmpdir()), realpath(directory)]);
  if (!data.startsWith(root + sep) || !basename(data).startsWith(folderPrefix)) {
    throw new Error('Unexpected local-save fixture directory');
  }

  await rm(data, { recursive: true, force: true });
});

async function createBoard(neighbors: Partial<BoardElement>[] = []): Promise<Board> {
  const created = await service.execute('artifact_manage', {
    action: 'create',
    elements: [textElement, { id: 'rich', type: 'html', html: richHtml }, ...neighbors],
  });

  return created.board;
}

function update(changes: Partial<BoardElement>): Operation {
  return { op: 'update', id: target, changes };
}

function command(
  board: Board,
  operationId: string,
  version: number,
  changes: Partial<BoardElement>,
) {
  return {
    artifactId: board.artifact.id,
    operationId,
    expectedVersions: { [target]: version },
    operations: [update(changes)],
    summary: '局部保存',
    receiptFormat: 'units-v1',
    merge: 'safe',
  };
}

function canvasSession(initial: Board) {
  let board = initial;
  const call = vi.fn((name: ToolName, args?: Record<string, unknown>) =>
    service.execute(name, args, LOCAL_ACTOR),
  );
  const client: StudioClient = { call: call as StudioClient['call'], embedded: false };
  const queue = new NativeContentQueue({
    send: (args) => sendCanvasSave(client, () => board, args),
    confirm: (args) => verifyCanvasSave(client, () => board, args),
    changed() {},
    accepted(_task, receipt) {
      board = receipt.board;
    },
  });

  return {
    call,
    enqueue: (operation: Operation, summary: string, operationId: string) =>
      queue.enqueue(board, [operation], summary, board.elements, true, undefined, operationId),
  };
}

it('saves Canvas text and x/y at expectedVersions-only without materializing the whole board', async () => {
  const board = await createBoard();
  const artifactId = board.artifact.id;
  const canvas = canvasSession(board);
  const wholeRead = vi.spyOn(SqliteArtifactRepository.prototype, 'readState');
  const localWrite = vi.spyOn(SqliteArtifactRepository.prototype, 'writeLocalUnitMutation');
  const edited = await canvas.enqueue(update({ text: '保存后 中文 😺' }), '改字', 'local-text');
  const moved = await canvas.enqueue(update({ x: 105, y: -88 }), '移动', 'local-position');

  expect(wholeRead).not.toHaveBeenCalled();
  expect(localWrite).toHaveBeenCalledTimes(2);
  expect(localWrite.mock.results).toEqual([
    { type: 'return', value: true },
    { type: 'return', value: true },
  ]);
  const [first, second] = canvas.call.mock.calls;
  expect(canvas.call).toHaveBeenCalledTimes(2);
  expect(first).toEqual([
    STUDIO_TOOLS.apply,
    { ...command(board, 'local-text', 1, { text: '保存后 中文 😺' }), summary: '改字' },
  ]);
  expect(second).toEqual([
    STUDIO_TOOLS.apply,
    { ...command(board, 'local-position', 2, { x: 105, y: -88 }), summary: '移动' },
  ]);

  expect(edited?.board).toMatchObject({
    artifact: { revision: 1 },
    elements: [
      { id: target, text: '保存后 中文 😺', version: 2, x: 10, y: 20 },
      { id: 'rich', html: richHtml },
    ],
  });
  expect(moved?.board).toMatchObject({
    artifact: { revision: 2 },
    elements: [
      { id: target, text: '保存后 中文 😺', version: 3, x: 105, y: -88 },
      { id: 'rich', html: richHtml },
    ],
  });

  const current = await service.execute('artifact_read', { artifactId, mode: 'board' });
  expect(current).toEqual(moved?.board);
  const history = await service.execute('artifact_read', { artifactId, mode: 'history' });
  expect(history.history).toEqual([
    expect.objectContaining({ revision: 0 }),
    expect.objectContaining({ id: edited?.historyEntry?.id, revision: 1, changedIds: [target] }),
    expect.objectContaining({ id: moved?.historyEntry?.id, revision: 2, changedIds: [target] }),
  ]);
  const retained = await service.execute('artifact_read', {
    artifactId,
    mode: 'version',
    versionId: edited?.historyEntry?.id,
  });
  expect(retained.board).toEqual(edited?.board);
});

it('records the original local save for read-only lookup and replay, and refuses operation ID reuse', async () => {
  const board = await createBoard();
  const artifactId = board.artifact.id;
  const first = command(board, 'original', 1, { text: '已确认' });
  const committed = await service.execute('artifact_apply', first);
  expect(committed).toMatchObject({
    receiptFormat: 'units-v1',
    operationId: 'original',
    baseRevision: 0,
    artifact: { id: artifactId, revision: 1 },
    units: [{ id: target, after: { text: '已确认', version: 2 } }],
  });
  await service.execute('artifact_apply', command(board, 'newer', 2, { text: '后续修改' }));

  await expect(
    service.execute('artifact_read', { ...first, mode: 'operation-receipt' }),
  ).resolves.toEqual(committed);
  await expect(service.execute('artifact_apply', first)).resolves.toEqual(committed);
  await expect(
    service.execute('artifact_apply', command(board, 'original', 3, { text: '另一个意图' })),
  ).rejects.toMatchObject({ code: 'OPERATION_REUSED' });
  const current = await service.execute('artifact_read', { artifactId, mode: 'board' });
  expect(current).toMatchObject({
    artifact: { revision: 2 },
    elements: [
      { id: target, text: '后续修改', version: 3 },
      { id: 'rich', html: richHtml },
    ],
  });
});

it('rejects viewer writes and mismatched authorization before persisting a local unit', async () => {
  const board = await createBoard();
  const artifactId = board.artifact.id;
  const actor: Actor = { id: 'viewer', name: '访客', kind: 'human', role: 'viewer' };
  const intent = command(board, 'blocked', 1, { text: '不得提交' });
  const persisted = vi.spyOn(SqliteArtifactRepository.prototype, 'writeLocalUnitMutation');

  await expect(service.execute('artifact_apply', intent, actor)).rejects.toMatchObject({
    code: 'FORBIDDEN',
  });
  await expect(
    service.execute('artifact_apply', intent, LOCAL_ACTOR, {
      actorId: actor.id,
      owner: true,
      viaLan: false,
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(persisted).not.toHaveBeenCalled();
  expect(await service.execute('artifact_read', { artifactId, mode: 'board' })).toEqual(board);
});

it('keeps text writes local but checks locked connected arrows for a coordinate change', async () => {
  const board = await createBoard([
    { id: 'anchor', type: 'text', text: '终点', x: 430, y: 240, w: 40, h: 40 },
    {
      id: 'locked-line',
      type: 'arrow',
      from: target,
      to: 'anchor',
      fromSide: 'right',
      locked: true,
    },
  ]);
  const artifactId = board.artifact.id;
  const wholeRead = vi.spyOn(SqliteArtifactRepository.prototype, 'readState');
  const localWrite = vi.spyOn(SqliteArtifactRepository.prototype, 'writeLocalUnitMutation');

  const text = await service.execute(
    'artifact_apply',
    command(board, 'with-arrow', 1, { text: '调整正文' }),
  );
  expect(text).toMatchObject({ artifact: { revision: 1 } });
  expect(wholeRead).not.toHaveBeenCalled();
  expect(localWrite).toHaveReturnedWith(true);
  localWrite.mockClear();

  await expect(
    service.execute('artifact_apply', command(board, 'locked-position', 2, { x: 200, y: 150 })),
  ).rejects.toMatchObject({ code: 'LOCKED', details: { elementId: 'locked-line' } });
  expect(wholeRead).toHaveBeenCalled();
  expect(localWrite).not.toHaveBeenCalled();
  const current = await service.execute('artifact_read', { artifactId, mode: 'board' });
  expect(current.artifact.revision).toBe(1);
  expect(current.elements[0]).toMatchObject({ x: 10, y: 20, text: '调整正文' });
});

it('retains trusted stale-version merges and same-field conflict semantics through the full fallback', async () => {
  const board = await createBoard();
  const artifactId = board.artifact.id;
  await service.execute('artifact_apply', command(board, 'remote-text', 1, { text: '先保存' }));
  const wholeRead = vi.spyOn(SqliteArtifactRepository.prototype, 'readState');
  const localWrite = vi.spyOn(SqliteArtifactRepository.prototype, 'writeLocalUnitMutation');

  await expect(
    service.execute('artifact_apply', command(board, 'stale-position', 1, { x: 150, y: -125 })),
  ).resolves.toMatchObject({
    artifact: { revision: 2 },
    units: [{ after: { id: target, text: '先保存', x: 150, y: -125, version: 3 } }],
  });
  expect(wholeRead).toHaveBeenCalled();
  expect(localWrite).not.toHaveBeenCalled();

  await expect(
    service.execute('artifact_apply', command(board, 'stale-text', 1, { text: '冲突修改' })),
  ).rejects.toMatchObject({ code: 'CONFLICT' });
  const current = await service.execute('artifact_read', { artifactId, mode: 'board' });
  expect(current.artifact.revision).toBe(2);
  expect(current.elements[0]).toMatchObject({ text: '先保存', x: 150, y: -125 });
});

it('preserves the complete board response for a client without the unit receipt option', async () => {
  const board = await createBoard();
  const { receiptFormat: _format, ...legacy } = command(board, 'legacy', 1, { text: '兼容保存' });
  const wholeRead = vi.spyOn(SqliteArtifactRepository.prototype, 'readState');
  const localWrite = vi.spyOn(SqliteArtifactRepository.prototype, 'writeLocalUnitMutation');

  const result = await service.execute('artifact_apply', legacy);
  expect(result).toMatchObject({
    board: {
      artifact: { id: board.artifact.id, revision: 1 },
      elements: [
        { id: target, text: '兼容保存', version: 2 },
        { id: 'rich', html: richHtml },
      ],
    },
  });
  expect(result).not.toHaveProperty('receiptFormat');
  expect(wholeRead).toHaveBeenCalled();
  expect(localWrite).not.toHaveBeenCalled();
});
