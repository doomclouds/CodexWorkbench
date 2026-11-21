import { expect, it } from 'vitest';
import type { Artifact, BoardElement } from '../../src/contracts/studio.js';
import { queryWhiteboard } from '../../src/core/products/whiteboard-query.js';

const artifact: Artifact = {
  id: 'project',
  type: 'whiteboard',
  title: '项目',
  revision: 7,
  createdAt: '2026-11-19T00:00:00Z',
  updatedAt: '2026-11-19T00:01:00Z',
  pinned: false,
};

const element = (id: string, fields: Partial<BoardElement> = {}): BoardElement => ({
  id,
  type: 'text',
  x: 0,
  y: 0,
  w: 80,
  h: 50,
  version: 3,
  ...fields,
});

it('locates two-character words and returns exact IDs for the matching child units', () => {
  const elements = [
    element('brief', {
      type: 'document',
      text: '需求方案',
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: 'heading',
            type: 'heading',
            props: {},
            content: '背景',
            children: [{ id: 'lesson', type: 'paragraph', props: {}, content: '核对架构方案' }],
          },
        ],
      },
    }),
    element('table', {
      type: 'table',
      text: '需求方案',
      data: {
        rows: [
          ['进度', '架构评审'],
          ['已看', '再次确认架构'],
        ],
        rowIds: ['row-a', 'row-b'],
        columnIds: ['col-a', 'col-b'],
        other: 'private-cell-state',
      },
    }),
    element('tasks', {
      type: 'todo',
      text: '待办',
      data: {
        items: [
          {
            id: 'task-a',
            text: '确认架构约定',
            checked: false,
            sourceRef: { elementId: 'source-private' },
          },
        ],
      },
    }),
  ];
  const result = queryWhiteboard({ artifact, elements }, { query: '架构' });
  expect(result.artifact).toEqual({
    id: artifact.id,
    title: artifact.title,
    revision: artifact.revision,
  });
  expect(result.items).toMatchObject([
    { id: 'brief', blockId: 'lesson', snippet: '核对架构方案', version: 3 },
    { id: 'table', rowId: 'row-a', columnId: 'col-b', snippet: '架构评审' },
    { id: 'table', rowId: 'row-b', columnId: 'col-b', snippet: '再次确认架构' },
    { id: 'tasks', itemId: 'task-a', snippet: '确认架构约定' },
  ]);
  const output = JSON.stringify(result);
  expect(output).not.toContain('private-cell-state');
  expect(output).not.toContain('source-private');
  expect(result.items[0]).not.toHaveProperty('document');
});

it('searches the static HTML text without leaking attributes, scripts, styles, or state', () => {
  const html = {
    artifact,
    elements: [
      element('diagram', {
        type: 'html',
        text: '接口图',
        sourceRevision: 12,
        html:
          '<style>.alpha { content: "hidden-style" }</style><script><template> hidden-script </template></script>' +
          '<template><script> ignored-raw </script><template> hidden-template </template></template>' +
          '<!-- hidden-comment --><p aria-label="hidden > attribute">架<em>构</em> &amp; 测&#x8bd5;</p>' +
          '<iframe>hidden-frame</iframe><script>unclosed-script',
        state: { secret: 'hidden-state' },
      }),
    ],
  };
  expect(queryWhiteboard(html, { query: '架构 & 测试' }).items).toMatchObject([
    { id: 'diagram', snippet: '架构 & 测试', sourceRevision: 12 },
  ]);

  for (const term of ['hidden', 'ignored', 'unclosed']) {
    expect(queryWhiteboard(html, { query: term }).items).toEqual([]);
  }
});

it('uses rendered arrow and rotated bounds for range discovery and filters by type or ID', () => {
  const elements = [
    element('start', { type: 'shape', w: 30, h: 30 }),
    element('end', { type: 'shape', x: 150, w: 30, h: 30 }),
    element('flow', { type: 'arrow', x: 700, y: 700, from: 'start', to: 'end', label: '传递' }),
    element('rotated', { type: 'shape', x: 20, y: 100, w: 60, h: 20, rotation: 90 }),
  ];
  const flow = queryWhiteboard(
    { artifact, elements },
    { rect: { x: 70, y: 8, w: 20, h: 12 }, type: 'arrow' },
  ).items;
  expect(flow).toHaveLength(1);
  expect(flow[0]).toMatchObject({ id: 'flow', label: '传递' });
  expect(flow[0]!.bounds.x).toBeLessThan(70);
  expect(
    queryWhiteboard(
      { artifact, elements },
      { rect: { x: 44, y: 79, w: 12, h: 12 }, ids: ['rotated'] },
    ).items.map((item) => item.id),
  ).toEqual(['rotated']);
});

it('filters both visually contained objects and explicit children by parent', () => {
  const elements = [
    element('frame', { type: 'container', w: 300, h: 250 }),
    element('within', { type: 'note', x: 20, y: 50, text: '复查' }),
    element('overlap', { type: 'note', x: 260, y: 50, text: '复查' }),
    element('attached', { type: 'sticker', x: 500, parentId: 'frame', text: '复查' }),
  ];
  expect(
    queryWhiteboard({ artifact, elements }, { parentId: 'frame', query: '复查' }).items.map(
      (item) => item.id,
    ),
  ).toEqual(['within', 'attached']);
  expect(() => queryWhiteboard({ artifact, elements }, { parentId: 'missing' })).toThrow('不存在');
});

it('resumes in stable order after a byte-limited page without dropping exact matches', () => {
  const elements = Array.from({ length: 45 }, (_, i) =>
    element('node-' + i, {
      text: '复查😀「接口」'.repeat(40) + '最后标记',
    }),
  );
  const board = { artifact, elements };
  const normal = queryWhiteboard(board, { limit: 300 });
  expect(normal.items).toHaveLength(20);
  expect(normal.nextOffset).toBe(20);

  const found: string[] = [];
  let offset: number | undefined = 0;
  while (offset !== undefined) {
    const page = queryWhiteboard(board, { query: '最后', offset, limit: 4, maxBytes: 650 });
    expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(650);
    expect(page.items[0]?.snippet).toContain('最后');
    expect(page.items.length).toBe(1);
    found.push(...page.items.map((item) => item.id));
    offset = page.nextOffset;
  }

  expect(found).toEqual(elements.map((item) => item.id));
  expect(() => queryWhiteboard(board, { maxBytes: 5 })).toThrow('字节预算');
});
