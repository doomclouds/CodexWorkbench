import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  createStudioService,
  type ComposedStudioService,
} from '../../src/server/studio-composition.js';

let directory: string;
let service: ComposedStudioService;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-retired-layout-'));
  service = createStudioService({ dataRoot: directory });
});
afterEach(async () => {
  await service.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected fixture path');
  }

  await rm(directory, { recursive: true, force: true });
});
it.each(['layout-preview', 'layout-cancel'])(
  'explicitly rejects the removed %s request without changing the board',
  async (mode) => {
    const { artifact } = await service.execute('artifact_manage', {
      action: 'create',
      elements: [
        {
          id: 'document',
          type: 'document',
          x: 20,
          y: 30,
          w: 600,
          h: 400,
          text: '保留文档',
          document: {
            schemaVersion: 1,
            blocks: [
              {
                id: 'paragraph',
                type: 'paragraph',
                props: {},
                content: '正文保持完整。',
                children: [],
              },
            ],
          },
        },
      ],
    });
    await service.store.waitForBackground();
    const before = await readFile(service.store.file(artifact.id));
    await expect(
      service.execute('artifact_read', {
        artifactId: artifact.id,
        mode,
        requestId: 'old-preview',
        ids: ['document'],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', message: '自动布局功能已移除。' });
    expect(await readFile(service.store.file(artifact.id))).toEqual(before);
    const current = await service.execute('artifact_read', {
      artifactId: artifact.id,
      mode: 'blocks',
      elementId: 'document',
    });
    expect(current.blocks[0].id).toBe('paragraph');
  },
);
