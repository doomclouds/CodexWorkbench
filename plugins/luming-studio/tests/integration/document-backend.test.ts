import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { unzipSync, zipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import {
  createStudioService,
  type ComposedStudioService,
} from '../../src/server/studio-composition.js';
import { createStudioServer } from '../../src/server/protocol.js';
import {
  LOCAL_ACTOR,
  type Actor,
  type Board,
  type CommentPin,
  type Feedback,
} from '../../src/contracts/studio.js';
import {
  applyDocumentOperations,
  defaultDocument,
  documentAnchorState,
  documentBlockText,
  documentOperations,
  documentPlainText,
  normalizeDocument,
  type DocumentBlock,
  type DocumentBlockOperation,
  type DocumentContent,
} from '../../src/contracts/document.js';
import { buildBoardHtml } from '../../src/shared/serialization.js';
import { documentHtml } from '../../src/shared/document-serialization.js';
import { archiveState, replaceArchiveState } from '../support/archive-state.js';

const paragraph = (id: string, text: string): DocumentBlock => ({
  id,
  type: 'paragraph',
  props: {},
  content: [{ type: 'text', text, styles: {} }],
  children: [],
});
const content = (...blocks: DocumentBlock[]): DocumentContent => ({ schemaVersion: 1, blocks });
let directory: string;
let service: ComposedStudioService;
let artifactId: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-document-'));
  service = createStudioService({ dataRoot: directory });
  const created = await service.execute('artifact_manage', {
    action: 'create',
    title: '文档区域验证',
    elements: [
      {
        id: 'doc',
        type: 'document',
        text: '方案说明',
        x: 100,
        y: 80,
        w: 700,
        h: 400,
        document: content(paragraph('one', '第一段原文'), paragraph('two', '第二段不变')),
      },
      { id: 'other', type: 'note', text: '不相关内容', x: 1200, y: 80, w: 200, h: 100 },
    ],
  });
  artifactId = created.artifact.id;
});
afterEach(async () => {
  await service.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected test directory');
  }

  await rm(directory, { recursive: true, force: true });
});
const read = (): Promise<Board> => service.execute('artifact_read', { artifactId });
const patch = (
  operations: DocumentBlockOperation[],
  version = 1,
  actor = LOCAL_ACTOR,
  extra: Record<string, unknown> = {},
) =>
  service.execute(
    'artifact_apply',
    {
      artifactId,
      expectedVersions: { doc: version },
      operations: [{ op: 'document', id: 'doc', data: { operations } }],
      ...extra,
    },
    actor,
  );

describe('canonical document JSON and block operations', () => {
  it('retains stable IDs, table JSON, code text and supported formatting without an HTML authority', () => {
    const source = content(
      {
        id: 'code',
        type: 'codeBlock',
        props: { language: 'ts' },
        content: 'const value = 1;\nconsole.log(value);',
      },
      {
        id: 'table',
        type: 'table',
        props: {},
        content: {
          type: 'tableContent',
          columnWidths: [null, 120],
          rows: [
            {
              cells: [
                [{ type: 'text', text: 'A', styles: { bold: true } }],
                {
                  type: 'tableCell',
                  props: { colspan: 1 },
                  content: [{ type: 'text', text: 'B', styles: {} }],
                },
              ],
            },
          ],
        },
      },
    );
    expect(normalizeDocument(source)).toEqual({
      ...source,
      blocks: source.blocks.map((block) => ({ ...block, children: [] })),
    });
    expect(documentBlockText(source.blocks[0]!)).toContain('console.log(value)');
    expect(documentPlainText(source)).toContain('A\tB');
    expect(
      documentBlockText({
        id: 'code-indent',
        type: 'codeBlock',
        props: {},
        content: '  preserved\n',
      }),
    ).toBe('  preserved\n');
    expect(normalizeDocument(defaultDocument('stable')).blocks[0]!.id).toBe('stable');
    expect(() =>
      normalizeDocument(content(paragraph('same', 'a'), paragraph('same', 'b'))),
    ).toThrow('ID');
    expect(() =>
      normalizeDocument(
        content({ ...paragraph('unsafe', 'a'), props: { url: 'javascript:alert(1)' } }),
      ),
    ).toThrow('地址');
    expect(() =>
      normalizeDocument(content({ ...paragraph('unsafe', 'a'), type: 'html' as never })),
    ).toThrow('类型');
  });
  it('derives identity-preserving nested moves, insertions and removals from editor snapshots', () => {
    const a = {
      ...paragraph('a', 'A'),
      children: [paragraph('b', 'B'), paragraph('remove', 'gone')],
    };
    const before = content(a, paragraph('c', 'C'));
    const after = content(
      {
        ...paragraph('b', 'B edited'),
        children: [{ ...paragraph('new', 'new'), children: [paragraph('a', 'A')] }],
      },
      paragraph('c', 'C'),
    );
    const operations = documentOperations(before, after);
    expect(operations.some((op) => op.op === 'move' && op.id === 'b')).toBe(true);
    expect(applyDocumentOperations(before, operations)).toEqual(normalizeDocument(after));
    expect(before.blocks[0]!.children![0]!.id).toBe('b');
    expect(documentOperations(after, after)).toEqual([]);
    expect(() => applyDocumentOperations(before, [{ op: 'move', id: 'a', parentId: 'b' }])).toThrow(
      '自身',
    );
  });
  it('keeps a failed multi-operation batch atomic and rejects duplicate block IDs', () => {
    const before = content(paragraph('one', 'original'));
    expect(() =>
      applyDocumentOperations(before, [
        { op: 'update', id: 'one', changes: { content: 'edited' } },
        { op: 'delete', id: 'missing' },
      ]),
    ).toThrow('不存在');
    expect(documentPlainText(before)).toBe('original');
    expect(() =>
      applyDocumentOperations(before, [{ op: 'insert', block: paragraph('one', 'duplicate') }]),
    ).toThrow('已存在');
  });
  it('handles a long paste and reverse ordering without replacing IDs or paragraph content', () => {
    const before = content(paragraph('existing', '保留的开头'));
    const after = content(
      ...Array.from({ length: 1000 }, (_, index) =>
        paragraph(`p-${index}`, `段落 ${index}：${'长文说明。'.repeat(30)}`),
      ),
      paragraph('existing', '保留的开头'),
    );
    const operations = documentOperations(before, after);
    expect(operations.filter((operation) => operation.op === 'insert')).toHaveLength(1000);
    expect(applyDocumentOperations(before, operations)).toEqual(normalizeDocument(after));
    const reversed = content(...after.blocks.toReversed());
    expect(applyDocumentOperations(after, documentOperations(after, reversed))).toEqual(
      normalizeDocument(reversed),
    );
  });
  it('preserves an explicit numbered-list start and a later restart in the exported HTML', () => {
    const list = content(
      { ...paragraph('first', '第一项'), type: 'numberedListItem', props: { start: 5 } },
      { ...paragraph('second', '第二项'), type: 'numberedListItem' },
      { ...paragraph('restart', '重设编号'), type: 'numberedListItem', props: { start: 9 } },
    );
    const page = new JSDOM(documentHtml(list, '列表导出')).window.document;
    expect(page.querySelector('ol')!.start).toBe(5);
    expect(page.querySelectorAll('li')).toHaveLength(3);
    expect(page.querySelectorAll('li')[2]!.value).toBe(9);
  });
});

describe('document service contracts', () => {
  it.each<CommentPin>([
    { coordinateSpace: 'board', x: -132.75, y: 428.5 },
    { coordinateSpace: 'document', x: 0.23, y: 0.81 },
  ])(
    'preserves a $coordinateSpace pin independently of frozen document context through retry, reopen and archive',
    async (pin) => {
      const anchor = {
        coordinateSpace: 'document' as const,
        elementIds: ['doc'],
        blockIds: ['one'],
        sourceVersion: 1,
        quote: '第一段原文',
        pin,
      };
      const create = {
        artifactId,
        action: 'create',
        operationId: 'stable-comment-position',
        text: '核对原段落',
        anchor,
        versions: { doc: 1 },
      };
      const first = await service.execute('artifact_feedback', create);
      const saved = first.feedback.find((item: Feedback) => item.id === first.contextId)!;
      expect(saved.anchor).toEqual(anchor);
      const revision = (await read()).artifact.revision;
      const retry = await service.execute('artifact_feedback', create);
      expect(retry.contextId).toBe(first.contextId);
      expect(retry.feedback).toEqual(first.feedback);
      expect((await read()).artifact.revision).toBe(revision);
      await expect(
        service.execute('artifact_feedback', {
          ...create,
          anchor: { ...anchor, pin: { ...pin, x: pin.x / 2 } },
        }),
      ).rejects.toMatchObject({ code: 'OPERATION_REUSED' });

      const requested = await service.execute('artifact_feedback', {
        artifactId,
        action: 'send',
        feedbackId: saved.id,
      });
      const attachment = requested.feedback.find(
        (item: Feedback) => item.id === saved.id,
      )!.attachment;
      expect(attachment).toMatchObject({ requestId: expect.any(String), state: 'pending' });
      const retriedAttachment = await service.execute('artifact_feedback', {
        artifactId,
        action: 'send',
        feedbackId: saved.id,
      });
      expect(
        retriedAttachment.feedback.find((item: Feedback) => item.id === saved.id)!.attachment,
      ).toEqual(attachment);

      await patch([{ op: 'update', id: 'one', changes: { content: '当前内容已经修改' } }]);
      const reopened = createStudioService({ dataRoot: directory });
      try {
        const feedback = (
          await reopened.execute('artifact_feedback', {
            artifactId,
            action: 'get',
            feedbackId: saved.id,
          })
        ).feedback.find((item: Feedback) => item.id === saved.id)!;
        expect(feedback.anchor).toEqual(anchor);
        const frozen = await reopened.execute('artifact_read', {
          artifactId,
          mode: 'source',
          elementId: 'doc',
          feedbackId: saved.id,
        });
        expect(documentPlainText(frozen.document)).toBe('第一段原文\n第二段不变');
      } finally {
        await reopened.close();
      }

      const exported = await service.execute('artifact_export', { artifactId, format: 'zip' });
      const imported = await service.importArchive(
        (await service.getExport(exported.exportId)).data,
      );
      const importedId = imported.artifact.id;
      const importedFeedback = (
        await service.execute('artifact_feedback', {
          artifactId: importedId,
          action: 'get',
          feedbackId: saved.id,
        })
      ).feedback.find((item: Feedback) => item.id === saved.id)!;
      expect(importedFeedback.anchor).toEqual(anchor);
      const importedSource = await service.execute('artifact_read', {
        artifactId: importedId,
        mode: 'source',
        elementId: 'doc',
        feedbackId: saved.id,
      });
      expect(documentPlainText(importedSource.document)).toBe('第一段原文\n第二段不变');
    },
  );
  it.each([
    null,
    [],
    {},
    { coordinateSpace: 'html', x: 1, y: 2 },
    { coordinateSpace: 'board', x: undefined, y: 0 },
    { coordinateSpace: 'board', x: '3', y: 0 },
    { coordinateSpace: 'board', x: Infinity, y: 0 },
    { coordinateSpace: 'board', x: 10_000_001, y: 0 },
    { coordinateSpace: 'document', x: -0.01, y: 0.5 },
    { coordinateSpace: 'document', x: 0.5, y: 1.01 },
  ])(
    'rejects an invalid presentation pin without writing feedback or history (%j)',
    async (pin) => {
      const before = await read();
      await expect(
        service.execute('artifact_feedback', {
          artifactId,
          action: 'create',
          text: '无效点位',
          anchor: { coordinateSpace: 'document', elementIds: ['doc'], blockIds: ['one'], pin },
          versions: { doc: 1 },
        }),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
      expect(
        (await service.execute('artifact_feedback', { artifactId, action: 'list' })).feedback,
      ).toEqual([]);
      expect((await read()).artifact.revision).toBe(before.artifact.revision);
    },
  );
  it('requires a document target for block-relative pins while allowing a board point with any source target', async () => {
    await expect(
      service.execute('artifact_feedback', {
        artifactId,
        action: 'create',
        text: '对象不能使用段落坐标',
        anchor: {
          coordinateSpace: 'element',
          elementIds: ['other'],
          x: 0.5,
          y: 0.5,
          pin: { coordinateSpace: 'document', x: 0.2, y: 0.3 },
        },
        versions: { other: 1 },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    const anchor = {
      coordinateSpace: 'element' as const,
      elementIds: ['other'],
      x: 0.5,
      y: 0.5,
      pin: { coordinateSpace: 'board' as const, x: 420, y: 560 },
    };
    const created = await service.execute('artifact_feedback', {
      artifactId,
      action: 'create',
      text: '固定的画布位置',
      anchor,
      versions: { other: 1 },
    });
    expect(created.feedback[0].anchor).toEqual(anchor);
    const source = await service.execute('artifact_read', {
      artifactId,
      mode: 'source',
      elementId: 'other',
      feedbackId: created.contextId,
    });
    expect(source.element.text).toBe('不相关内容');
  });
  it('patches only named blocks, preserves geometry and unrelated objects, and persists across services', async () => {
    const before = await read();
    const saved = await patch([
      { op: 'update', id: 'one', changes: { content: '第一段修改' } },
      { op: 'insert', block: paragraph('three', '新增段落'), afterId: 'one' },
    ]);
    const document = saved.board.elements[0];
    expect(document).toMatchObject({
      id: 'doc',
      x: 100,
      y: 80,
      w: 700,
      h: 400,
      text: '方案说明',
      version: 2,
    });
    expect(document.document.blocks.map((block: DocumentBlock) => block.id)).toEqual([
      'one',
      'three',
      'two',
    ]);
    expect(document.document.blocks[2]).toEqual(before.elements[0]!.document!.blocks[1]);
    expect(saved.board.elements[1]).toEqual(before.elements[1]);
    const reopened = createStudioService({ dataRoot: directory });
    try {
      expect(
        (await reopened.execute('artifact_read', { artifactId })).elements[0].document,
      ).toEqual(document.document);
    } finally {
      await reopened.close();
    }
  });
  it('uses existing permission, CAS, Agent scope and history rather than a content write bypass', async () => {
    const operation: DocumentBlockOperation[] = [
      { op: 'update', id: 'one', changes: { content: '更新' } },
    ];
    await expect(
      patch(operation, 1, { id: 'viewer', name: 'Viewer', kind: 'human', role: 'viewer' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const agent: Actor = { id: 'agent', name: 'Document agent', kind: 'agent', role: 'owner' };
    await expect(patch(operation, 1, agent)).rejects.toMatchObject({ code: 'TASK_REQUIRED' });
    const task = (
      await service.execute(
        'artifact_activity',
        { artifactId, action: 'begin', taskId: 'document-task', scope: { ids: ['other'] } },
        agent,
      )
    ).tasks[0];
    await expect(
      patch(operation, 1, agent, { taskId: task.taskId, generation: task.generation }),
    ).rejects.toMatchObject({ code: 'TASK_SCOPE' });
    await service.execute(
      'artifact_activity',
      {
        artifactId,
        action: 'end',
        taskId: task.taskId,
        generation: task.generation,
        outcome: 'completed',
      },
      agent,
    );
    const results = await Promise.allSettled([
      patch(operation),
      patch([{ op: 'update', id: 'two', changes: { content: '并发另一段' } }]),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason,
    ).toMatchObject({ code: 'CONFLICT' });
    const history = await service.execute('artifact_read', { artifactId, mode: 'history' });
    expect(history.history).toHaveLength(2);
    await service.execute('artifact_apply', {
      artifactId,
      expectedVersions: { doc: 2 },
      operations: [{ op: 'restore', id: 'doc', versionId: history.history[0].id }],
    });
    expect(documentPlainText((await read()).elements[0]!.document!)).toBe('第一段原文\n第二段不变');
  });
  it('freezes exact document blocks and marks later changes or removals without matching similar text', async () => {
    const created = await service.execute('artifact_feedback', {
      artifactId,
      action: 'create',
      text: '请解释这一段',
      anchor: {
        coordinateSpace: 'document',
        elementIds: ['doc'],
        blockIds: ['one'],
        sourceVersion: 1,
        quote: '第一段原文',
      },
      versions: { doc: 1 },
    });
    const feedback = created.feedback[0];
    expect(documentAnchorState(feedback.anchor, (await read()).elements[0])).toBe('current');
    await patch([{ op: 'update', id: 'one', changes: { content: '第一段新内容' } }]);
    expect(documentAnchorState(feedback.anchor, (await read()).elements[0])).toBe('changed');
    await patch(
      [
        { op: 'delete', id: 'one' },
        { op: 'insert', block: paragraph('similar', '第一段原文') },
      ],
      2,
    );
    expect(documentAnchorState(feedback.anchor, (await read()).elements[0])).toBe('missing');
    const frozen = await service.execute('artifact_read', {
      artifactId,
      mode: 'blocks',
      elementId: 'doc',
      feedbackId: feedback.id,
      blockIds: ['one'],
    });
    expect(frozen).toMatchObject({
      version: 1,
      flat: true,
      blocks: [{ id: 'one', content: [{ text: '第一段原文' }] }],
    });
    const source = await service.execute('artifact_read', {
      artifactId,
      mode: 'source',
      elementId: 'doc',
      feedbackId: feedback.id,
    });
    expect(documentPlainText(source.document)).toContain('第一段原文');
    await expect(
      service.execute('artifact_feedback', {
        artifactId,
        action: 'create',
        text: '不匹配',
        anchor: {
          coordinateSpace: 'document',
          elementIds: ['doc'],
          blockIds: ['two'],
          quote: '第一段原文',
        },
        versions: { doc: 3 },
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('keeps images and complete long content in HTML, backup/import and duplication', async () => {
    const image = await service.putAsset(
      artifactId,
      Buffer.from('89504e470d0a1a0a', 'hex'),
      { filename: 'example.png', mimeType: 'image/png' },
      LOCAL_ACTOR,
    );
    const long = Array.from({ length: 80 }, (_, index) =>
      paragraph(`long-${index}`, `第 ${index + 1} 段长文内容`),
    );
    await service.execute('artifact_apply', {
      artifactId,
      expectedVersions: { doc: 1 },
      operations: [
        {
          op: 'update',
          id: 'doc',
          changes: {
            document: content(...long, {
              id: 'picture',
              type: 'image',
              props: { url: image.url, previewWidth: 320, caption: '示例图片' },
              children: [],
            }),
          },
        },
      ],
    });
    const exported = await service.execute('artifact_export', {
      artifactId,
      format: 'html',
      regionId: 'doc',
    });
    const html = new TextDecoder().decode((await service.getExport(exported.exportId)).data);
    expect(html).toContain('第 80 段长文内容');
    expect(html).toContain('data:image/png;base64,');
    expect(html).not.toContain(image.url);
    expect(html).not.toContain('height:400px');
    const boardHtml = buildBoardHtml(await read());
    expect(boardHtml).toContain('第 80 段长文内容');
    expect(boardHtml).toContain('overflow:auto');
    const archive = await service.execute('artifact_export', { artifactId, format: 'zip' });
    const imported = await service.importArchive((await service.getExport(archive.exportId)).data);
    const importedBoard = await service.execute('artifact_read', {
      artifactId: imported.artifact.id,
    });
    const importedImage = importedBoard.elements[0].document.blocks.find(
      (block: DocumentBlock) => block.id === 'picture',
    );
    expect(importedImage.props.url).toContain(`/assets/${imported.artifact.id}/`);
    const cloned = await service.execute('artifact_manage', { action: 'duplicate', artifactId });
    expect(cloned.board.elements[0].document.blocks.at(-1).props.url).toContain(
      `/assets/${cloned.artifact.id}/`,
    );
    await expect(
      service.execute('artifact_manage', { artifactId, action: 'asset-delete', assetId: image.id }),
    ).rejects.toMatchObject({ code: 'REFERENCE_IN_USE' });
  });
  it('exposes frozen JSON in bounded source pages through the real MCP SDK', async () => {
    await patch([{ op: 'update', id: 'one', changes: { content: '🙂 中文文档' } }]);
    const server = createStudioServer(
      {
        execute: (name, args) => service.execute(name, args),
        connection: async () => ({
          baseUrl: 'http://example.test',
          token: 'synthetic',
          actor: LOCAL_ACTOR,
        }),
      },
      '<html></html>',
    );
    const client = new Client({ name: 'document-source-contract', version: '1' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      const encoded = JSON.stringify((await read()).elements[0]!.document);
      const emojiOffset = encoded.indexOf('🙂');
      const emoji = await client.callTool({
        name: 'artifact_read',
        arguments: { artifactId, mode: 'source', elementId: 'doc', offset: emojiOffset, limit: 1 },
      });
      expect((emoji.structuredContent as any).data.json).toBe('🙂');
      let json = '';
      let offset = 0;
      let complete = false;
      while (!complete) {
        const response = await client.callTool({
          name: 'artifact_read',
          arguments: { artifactId, mode: 'source', elementId: 'doc', offset, limit: 64 },
        });
        expect(response.isError, JSON.stringify(response.structuredContent)).not.toBe(true);
        const data = (response.structuredContent as any).data;
        json += data.json;
        complete = data.complete;
        offset = data.nextOffset;
      }

      expect(JSON.parse(json)).toEqual((await read()).elements[0]!.document);
      const blocks = await client.callTool({
        name: 'artifact_read',
        arguments: { artifactId, mode: 'blocks', elementId: 'doc', blockIds: ['two'] },
      });
      expect((blocks.structuredContent as any).data.blocks).toMatchObject([
        { id: 'two', parentId: null, afterId: 'one' },
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });
  it('rejects malformed imported document JSON before publishing and refuses incomplete offline image exports', async () => {
    const exported = await service.execute('artifact_export', { artifactId, format: 'zip' });
    const entries = unzipSync((await service.getExport(exported.exportId)).data);
    const snapshot = await archiveState(entries, directory);
    (snapshot.content as Board).elements[0]!.document!.blocks[1]!.id = 'one';
    await replaceArchiveState(entries, snapshot, directory);
    await expect(service.importArchive(zipSync(entries))).rejects.toMatchObject({
      code: 'INVALID_ARCHIVE',
    });
    expect((await service.execute('artifact_list', {})).artifacts).toHaveLength(1);
    await patch([
      {
        op: 'insert',
        block: {
          id: 'external',
          type: 'image',
          props: { url: 'https://example.com/not-bundled.png' },
        },
      },
    ]);
    await expect(
      service.execute('artifact_export', { artifactId, format: 'html', regionId: 'doc' }),
    ).rejects.toMatchObject({ code: 'ASSET_NOT_EMBEDDED' });
  });
});
