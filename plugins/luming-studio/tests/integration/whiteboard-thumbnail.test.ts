import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { expect, it, vi } from 'vitest';
import { LOCAL_ACTOR } from '../../src/contracts/studio.js';
import { initialWhiteboard, whiteboardProduct } from '../../src/core/products/whiteboard.js';
import { createState } from '../../src/core/shared/history.js';
import { MAX_THUMBNAIL_BYTES } from '../../src/core/shared/thumbnails.js';
import { SqliteArtifactRepository } from '../../src/infrastructure/sqlite-artifact.js';
import { startStudioHost, type StudioHost } from '../../src/server/http.js';

const ARTIFACT_ID = 'cover-fixture';
const DATE = '2026-11-22T00:00:00.000Z';

function snapshot(elements: unknown) {
  return {
    artifact: {
      id: ARTIFACT_ID,
      title: 'Architecture board',
      type: 'whiteboard',
      createdAt: DATE,
      updatedAt: DATE,
      revision: 0,
      pinned: false,
    },
    content: initialWhiteboard(elements),
  };
}

function confirmOverview(svg: string, title: string) {
  expect(svg).toContain('width="560" height="320"');
  expect(svg).toContain(title);
  expect(svg).toContain('data-studio-id="preview-0"');
  expect(svg).not.toContain('<foreignObject');
  expect(svg).not.toContain('data:image/');
  expect(Buffer.byteLength(svg)).toBeLessThan(MAX_THUMBNAIL_BYTES);
}

it('uses the unchanged detailed SVG for ordinary covers', async () => {
  const board = snapshot([{ id: 'typed', type: 'text', text: 'Visible typed text' }]);
  const resources = { assetDataUri: vi.fn(), renderSvgPng: vi.fn() };
  const cover = await whiteboardProduct.thumbnail!(board, resources);
  const detailed = await whiteboardProduct.export(
    board,
    'svg',
    { padding: 16, svgRegions: true },
    resources,
  );

  expect(cover).toEqual(detailed);
  expect(cover.data).toContain('data-studio-id="typed"');
});

it('falls back when inlining media makes the detailed cover oversized while preserving SVG export', async () => {
  const asset = `/assets/${ARTIFACT_ID}/hero`;
  const dataUri = 'data:image/png;base64,' + 'A'.repeat(MAX_THUMBNAIL_BYTES);
  const board = snapshot([{ id: 'hero', type: 'image', src: asset, text: 'Hero image' }]);
  const resources = { assetDataUri: vi.fn(async () => dataUri), renderSvgPng: vi.fn() };
  const cover = await whiteboardProduct.thumbnail!(board, resources);

  expect(resources.assetDataUri).toHaveBeenCalledWith(asset);
  confirmOverview(cover.data, 'Hero image');
  const detailed = await whiteboardProduct.export(board, 'svg', { padding: 16 }, resources);
  expect(detailed.data).toContain(dataUri);
  expect(Buffer.byteLength(detailed.data)).toBeGreaterThan(MAX_THUMBNAIL_BYTES);
});

function thumbnailRequest(host: StudioHost, revision: number) {
  return fetch(`${host.origin}/api/thumbnails/${ARTIFACT_ID}?revision=${revision}`, {
    headers: { Authorization: `Bearer ${host.token}` },
  });
}

async function expectHttpOverview(host: StudioHost, revision: number) {
  const response = await thumbnailRequest(host, revision);
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/svg+xml');
  confirmOverview(await response.text(), 'Release architecture');
}

it('serves a bounded cover before and after a real SQLite v1 board migrates', async () => {
  const root = resolve(await mkdtemp(join(tmpdir(), 'studio-large-thumbnail-')));
  if (!root.startsWith(resolve(tmpdir()) + sep)) {
    throw new Error('Unexpected thumbnail test directory');
  }

  const folder = join(root, 'artifacts', ARTIFACT_ID);
  let host: StudioHost | undefined;
  try {
    await mkdir(folder, { recursive: true });
    const html = '<h1>Release architecture</h1><p>' + '图'.repeat(730_000) + '</p>';
    const { artifact, content } = snapshot([{ id: 'rich', type: 'html', html, w: 720, h: 420 }]);
    const state = createState(artifact, content, LOCAL_ACTOR, 'Fixture', ['rich']);
    const source = new SqliteArtifactRepository(join(folder, 'artifact.sqlite'), true, 1);
    try {
      source.writeState(state);
    } finally {
      source.close();
    }

    host = await startStudioHost({ dataRoot: root });
    await expectHttpOverview(host, 0);
    const save = await fetch(`${host.origin}/api/tools/artifact_apply`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${host.token}`,
        'X-Studio-Actor': 'human',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        artifactId: ARTIFACT_ID,
        operationId: 'migrate-cover',
        expectedRevision: 0,
        operations: [
          { op: 'add', element: { id: 'note', type: 'text', text: 'Migration trigger' } },
        ],
      }),
    });
    expect(save.status).toBe(200);
    const reply = (await save.json()) as { ok?: boolean };
    expect(reply.ok).toBe(true);

    const generations = join(root, 'artifact-generations', ARTIFACT_ID);
    const { generation } = JSON.parse(await readFile(join(generations, 'active.json'), 'utf8'));
    const active = new SqliteArtifactRepository(
      join(generations, generation, 'current', 'artifact.sqlite'),
    );

    try {
      expect(active.storageVersion).toBe(2);
      expect(active.readAuthorization().artifact.revision).toBe(1);
    } finally {
      active.close();
    }

    await expectHttpOverview(host, 1);
  } finally {
    await host?.close();
    await rm(root, { recursive: true, force: true });
  }
});
