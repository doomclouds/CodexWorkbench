import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createStudioToolCall,
  decodeAppTransportResult,
} from '../../src/app/transport/tool-response';
import { DEFAULT_STYLE, STUDIO_TOOLS, type Board } from '../../src/contracts/studio';
import { defaultDocument } from '../../src/contracts/document';

const importedBoard: Board = {
  artifact: {
    id: 'imported',
    type: 'whiteboard',
    title: '导入的白板',
    revision: 2,
    createdAt: '',
    updatedAt: '',
    pinned: false,
    importedFrom: {
      artifactId: 'original',
      title: '导入的白板',
      createdAt: '',
      importedAt: '2026-11-21T00:00:00.000Z',
    },
  },
  elements: [],
  style: DEFAULT_STYLE,
};

function clientWith(envelope: unknown) {
  return createStudioToolCall(async (_name, _args, read) => read(Response.json(envelope)));
}

describe('Studio tool response contracts', () => {
  it('checks the read-only receipt identity and rejects an old unsupported read response', async () => {
    const args = {
      artifactId: 'imported',
      mode: 'operation-receipt',
      operationId: 'original-intent',
      operations: [{ op: 'add' }],
    } as const;
    const receipt = {
      operationId: args.operationId,
      board: importedBoard,
      historyEntry: {
        id: 'version-2',
        revision: 2,
        createdAt: '',
        actor: { id: 'owner', name: 'Owner', kind: 'human', role: 'owner' },
        summary: '',
        changedIds: [],
      },
    };
    await expect(clientWith({ ok: true, data: receipt })(STUDIO_TOOLS.read, args)).resolves.toEqual(
      receipt,
    );
    await expect(
      clientWith({ ok: true, data: { ...receipt, operationId: 'another' } })(
        STUDIO_TOOLS.read,
        args,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      clientWith({ ok: true, data: importedBoard })(STUDIO_TOOLS.read, args),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      clientWith({
        ok: false,
        error: { code: 'INVALID_ARGUMENT', message: '不支持的白板读取方式。' },
      })(STUDIO_TOOLS.read, args),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('infers complete Board results and accepts the persisted import provenance shape', async () => {
    const call = clientWith({ ok: true, data: importedBoard });
    const board = await call(STUDIO_TOOLS.read, { artifactId: 'imported' });

    expectTypeOf(board).toEqualTypeOf<Board>();
    expect(board).toEqual(importedBoard);
    expect(JSON.stringify(board)).toBe(JSON.stringify(importedBoard));
    await expect(
      call(STUDIO_TOOLS.read, { artifactId: 'imported', mode: 'board' }),
    ).resolves.toEqual(importedBoard);
  });

  it('infers a historical snapshot wrapper and rejects an unwrapped version response', async () => {
    const args = { artifactId: 'imported', mode: 'version', versionId: 'v2' } as const;
    const result = await clientWith({ ok: true, data: { board: importedBoard } })(
      STUDIO_TOOLS.read,
      args,
    );

    expectTypeOf(result).toEqualTypeOf<{ board: Board }>();
    expect(result.board).toEqual(importedBoard);
    await expect(
      clientWith({ ok: true, data: importedBoard })(STUDIO_TOOLS.read, args),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('fails isolated history and board-shape changes at the response boundary', async () => {
    const brokenBoard = { ...importedBoard, elements: [{ id: 'incomplete', type: 'text' }] };

    await expect(
      clientWith({ ok: true, data: brokenBoard })(STUDIO_TOOLS.read, {
        artifactId: 'imported',
        mode: 'board',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
    await expect(
      clientWith({ ok: true, data: { history: [], batches: [false] } })(STUDIO_TOOLS.read, {
        artifactId: 'imported',
        mode: 'history',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 200 });
  });

  it('accepts the server wire shape for motion introduced or removed between history versions', async () => {
    const args = {
      artifactId: 'imported',
      mode: 'diff',
      fromVersionId: 'v1',
      toVersionId: 'v2',
    } as const;
    const introduced = { id: '$motion', after: { mode: 'linear' } };
    const removed = { id: '$motion', before: { mode: 'linear' } };
    const change = { fromRevision: 1, toRevision: 2 };

    await expect(
      clientWith({ ok: true, data: { ...change, units: [introduced] } })(STUDIO_TOOLS.read, args),
    ).resolves.toStrictEqual({ ...change, units: [introduced] });
    await expect(
      clientWith({ ok: true, data: { ...change, units: [removed] } })(STUDIO_TOOLS.read, args),
    ).resolves.toStrictEqual({ ...change, units: [removed] });
  });

  it('keeps precise unit removal null distinct from a missing after field', async () => {
    const args = {
      artifactId: 'imported',
      mode: 'units',
      atRevision: 2,
      ids: ['removed'],
    } as const;
    const removal = { artifact: importedBoard.artifact, units: [{ id: 'removed', after: null }] };

    await expect(clientWith({ ok: true, data: removal })(STUDIO_TOOLS.read, args)).resolves.toEqual(
      removal,
    );
    await expect(
      clientWith({ ok: true, data: { ...removal, units: [{ id: 'removed' }] } })(
        STUDIO_TOOLS.read,
        args,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('decodes both HTML and native document sources reachable through a regionId read', async () => {
    const args = { artifactId: 'imported', mode: 'source', regionId: 'region' } as const;
    const html = {
      html: '<main>资料</main>',
      regionId: 'region',
      sourceRevision: 1,
      version: 1,
      artifactId: 'imported',
    };
    const native = {
      artifactId: 'imported',
      elementId: 'region',
      version: 2,
      document: defaultDocument(),
      text: '',
    };

    await expect(clientWith({ ok: true, data: html })(STUDIO_TOOLS.read, args)).resolves.toEqual(
      html,
    );
    await expect(clientWith({ ok: true, data: native })(STUDIO_TOOLS.read, args)).resolves.toEqual(
      native,
    );
    await expect(
      clientWith({ ok: true, data: { ...native, document: 'invalid' } })(STUDIO_TOOLS.read, args),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it.each([
    { ok: true },
    { ok: 'true', data: {} },
    { ok: true, data: {}, error: { code: 'CONFLICT', message: 'conflict' } },
    { ok: false, data: {}, error: { code: 'CONFLICT', message: 'conflict' } },
  ])('rejects an ambiguous tool envelope (%j)', async (envelope) => {
    await expect(
      clientWith(envelope)(STUDIO_TOOLS.read, { artifactId: 'imported' }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 200,
    });
  });

  it('checks the embedded reply against the action that requested it', () => {
    const receipt = { transferId: 'upload-one', nextOffset: 42 };

    expect(decodeAppTransportResult('upload', receipt)).toEqual(receipt);
    expect(() => decodeAppTransportResult('request', receipt)).toThrow(/界面响应/);
    expect(() => decodeAppTransportResult('release', { released: 'true' })).toThrow(/界面响应/);
  });
});
