import { act, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type {
  BoardEditReceipt,
  BoardHistoryExportResult,
  BoardHistoryService,
  BoardHistoryVersion,
  WhiteboardObject,
  WhiteboardScene,
} from '../../src/data/whiteboard/index.js';
import {
  WhiteboardHistorySurface,
  type BoardHistoryPreviewFrame,
  type WhiteboardHistorySurfaceProps,
} from '../../src/surfaces/whiteboard-history/index.js';
import { createControlFixture } from '../support/render-control.js';

const boardId = 'release-board';
const title = '发布白板';
const latestRevision = 3n;
const sourceRevision = 1n;
const objectId = 'archived-frame';
const commandId = 'restore-command';
const scene: WhiteboardScene = {
  boardId,
  title,
  revision: sourceRevision,
  canEdit: false,
  objects: [],
};
const confirmed: BoardEditReceipt = {
  kind: 'applied',
  boardId,
  commandId,
  revision: 4n,
  objects: [],
  removedIds: [],
  order: [],
  payloads: [],
};

let anchor: HTMLButtonElement;
let fixture: ReturnType<typeof createControlFixture>;

function showModal(this: HTMLDialogElement) {
  this.open = true;
}

function closeModal(this: HTMLDialogElement) {
  this.open = false;
}

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { value: showModal, configurable: true },
    close: { value: closeModal, configurable: true },
  });
}

beforeEach(() => {
  fixture = createControlFixture();
  anchor = document.createElement('button');
  anchor.textContent = '版本历史';
  document.body.append(anchor);
});

afterEach(() => {
  fixture.dispose();
  anchor.remove();
});

function version(revision: bigint): BoardHistoryVersion {
  return {
    revision,
    title,
    changedObjectCount: 1,
    kind: 'geometry',
  };
}

function historyMock() {
  return {
    listVersions: vi.fn<BoardHistoryService['listVersions']>().mockResolvedValue({
      currentRevision: latestRevision,
      versions: [version(sourceRevision), version(0n)],
    }),
    getVersionScene: vi
      .fn<BoardHistoryService['getVersionScene']>()
      .mockImplementation(async (_boardId, requestedRevision) => ({
        ...scene,
        revision: requestedRevision,
      })),
    getVersionPayloads: vi.fn<BoardHistoryService['getVersionPayloads']>().mockResolvedValue([]),
    restoreVersion: vi.fn<BoardHistoryService['restoreVersion']>().mockResolvedValue(confirmed),
    getRestoreReceipt: vi
      .fn<BoardHistoryService['getRestoreReceipt']>()
      .mockResolvedValue(undefined),
    exportVersion: vi
      .fn<BoardHistoryService['exportVersion']>()
      .mockResolvedValue({ kind: 'unavailable' }),
  };
}

function button(label: string) {
  const control = Array.from(fixture.host.querySelectorAll('button')).find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === label,
  );

  if (!control) {
    throw new Error('Missing history control ' + label);
  }

  return control;
}

async function selectButton(label: string) {
  await act(async () => {
    button(label).click();
  });
}

async function pressEscape(target: HTMLElement) {
  await act(async () => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
}

async function openPreview() {
  await selectButton('展开版本 1');
  await selectButton('预览版本');
}

function chooseSelection() {
  const select = fixture.host.querySelector('select');
  if (!select) {
    throw new Error('Missing history scope');
  }

  select.value = 'selection';
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

function previewFrame({ scene: snapshot, onSelectionChange }: BoardHistoryPreviewFrame) {
  return (
    <div>
      <span>{'画布快照 ' + snapshot.revision}</span>
      <button type="button" onClick={() => onSelectionChange([objectId])}>
        选择历史对象
      </button>
    </div>
  );
}

type HistoryOverrides = Partial<
  Pick<WhiteboardHistorySurfaceProps, 'boardId' | 'revision' | 'canEdit' | 'colorForAuthor'>
>;

async function mount(
  service: BoardHistoryService,
  initial: HistoryOverrides = {},
  renderPreview = previewFrame,
) {
  const onClose = vi.fn<() => void>();
  const onRestored = vi.fn<WhiteboardHistorySurfaceProps['onRestored']>();
  const onPreviewChange = vi.fn<(active: boolean) => void>();
  const download = vi.fn<WhiteboardHistorySurfaceProps['download']>();

  function Host({
    boardId: identity = boardId,
    revision = latestRevision,
    canEdit = true,
    colorForAuthor,
  }: HistoryOverrides) {
    const [visible, setVisible] = useState(true);

    function handleClose() {
      setVisible(false);
      onClose();
    }

    return (
      <>
        <button type="button" onClick={() => setVisible(true)}>
          打开版本历史
        </button>
        <button type="button" onClick={() => setVisible(false)}>
          关闭版本历史入口
        </button>
        <WhiteboardHistorySurface
          anchor={visible ? anchor : null}
          title={title}
          boardId={identity}
          revision={revision}
          canEdit={canEdit}
          service={service}
          createCommandId={() => commandId}
          onClose={handleClose}
          onRestored={onRestored}
          onPreviewChange={onPreviewChange}
          download={download}
          colorForAuthor={colorForAuthor}
          renderPreview={renderPreview}
        />
      </>
    );
  }

  function render(overrides: HistoryOverrides = {}) {
    fixture.render(<Host {...initial} {...overrides} />);
  }

  await act(async () => render());

  return { download, onClose, onRestored, onPreviewChange, render };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

test('shows both recycle-bin lifecycle actions with their saved times', async () => {
  const service = historyMock();
  const trashedAt = Date.parse('2026-08-05T09:15:00Z');
  const restoredAt = Date.parse('2026-08-05T09:17:00Z');
  service.listVersions.mockResolvedValueOnce({
    currentRevision: latestRevision,
    versions: [
      { ...version(3n), kind: 'restoreTrash', changedObjectCount: 0, savedAtMillis: restoredAt },
      { ...version(2n), kind: 'trash', changedObjectCount: 0, savedAtMillis: trashedAt },
    ],
  });
  await mount(service);

  const restored = button('展开版本 3');
  const trashed = button('展开版本 2');
  expect(restored.textContent).toContain('恢复作品');
  expect(trashed.textContent).toContain('移入回收站');
  expect(restored.querySelector('time')?.dateTime).toBe(new Date(restoredAt).toISOString());
  expect(trashed.querySelector('time')?.dateTime).toBe(new Date(trashedAt).toISOString());
});

test('pages versions and previews the chosen saved scene without changing the live board', async () => {
  const service = historyMock();
  service.listVersions
    .mockResolvedValueOnce({
      currentRevision: latestRevision,
      versions: [version(latestRevision)],
      nextBeforeRevision: latestRevision,
    })
    .mockResolvedValueOnce({
      currentRevision: latestRevision,
      versions: [version(sourceRevision), version(0n)],
    });
  const surface = await mount(service);
  expect(document.activeElement).toBe(button('关闭版本历史'));

  await selectButton('加载更早版本');
  expect(service.listVersions).toHaveBeenLastCalledWith(
    boardId,
    latestRevision,
    expect.any(AbortSignal),
  );
  expect(button('展开版本 3')).toBeDefined();
  expect(button('展开版本 0')).toBeDefined();
  await openPreview();

  expect(fixture.host.textContent).toContain('画布快照 1');
  expect(button('正在预览')).toBeDefined();
  expect(button('返回当前版本')).toBeDefined();
  expect(service.getVersionScene).toHaveBeenLastCalledWith(
    boardId,
    sourceRevision,
    expect.any(AbortSignal),
  );
  expect(service.restoreVersion).not.toHaveBeenCalled();
  expect(surface.onPreviewChange).toHaveBeenCalledWith(true);
  expect(document.activeElement).toBe(button('退出预览'));
  const previewTrigger = button('正在预览');
  await pressEscape(button('退出预览'));
  expect(surface.onPreviewChange).toHaveBeenLastCalledWith(false);
  expect(fixture.host.querySelector('[aria-label="历史版本预览"]')).toBeNull();
  expect(button('预览版本')).toBe(previewTrigger);
  expect(document.activeElement).toBe(previewTrigger);
  expect(surface.onClose).not.toHaveBeenCalled();

  await pressEscape(previewTrigger);
  expect(surface.onClose).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(anchor);
});

test('returns focus to the history entry when the preview source is no longer mounted', async () => {
  const surface = await mount(historyMock());
  await openPreview();
  await selectButton('关闭版本历史入口');
  await pressEscape(button('退出预览'));
  expect(surface.onPreviewChange).toHaveBeenLastCalledWith(false);
  expect(document.activeElement).toBe(anchor);
});

test('retries the same older page, leaves the loaded records visible and advances focus', async () => {
  const service = historyMock();
  const older = deferred<Awaited<ReturnType<BoardHistoryService['listVersions']>>>();
  service.listVersions
    .mockResolvedValueOnce({
      currentRevision: latestRevision,
      versions: [version(latestRevision)],
      nextBeforeRevision: latestRevision,
    })
    .mockRejectedValueOnce(new Error('版本列表暂时不可用。'))
    .mockReturnValueOnce(older.promise);
  await mount(service);

  const footer = button('加载更早版本');
  await act(async () => footer.focus());
  await selectButton('加载更早版本');
  expect(button('重试加载更早版本')).toBe(footer);
  expect(button('展开版本 3')).toBeDefined();
  expect(fixture.host.textContent).toContain('版本列表暂时不可用。');

  await selectButton('重试加载更早版本');
  expect(button('正在加载更早版本…')).toBe(footer);
  expect(footer.getAttribute('aria-busy')).toBe('true');
  expect(document.activeElement).toBe(footer);
  await selectButton('正在加载更早版本…');
  expect(service.listVersions.mock.calls.map(([, before]) => before)).toEqual([
    undefined,
    latestRevision,
    latestRevision,
  ]);

  await act(async () =>
    older.resolve({ currentRevision: latestRevision, versions: [version(1n)] }),
  );
  expect(button('展开版本 3')).toBeDefined();
  expect(document.activeElement).toBe(button('展开版本 1'));
  expect(footer.isConnected).toBe(false);
});

test('refreshes through the already loaded history while preserving an expanded record and focus', async () => {
  const service = historyMock();
  service.listVersions
    .mockResolvedValueOnce({
      currentRevision: latestRevision,
      versions: [version(latestRevision)],
      nextBeforeRevision: latestRevision,
    })
    .mockResolvedValueOnce({
      currentRevision: latestRevision,
      versions: [version(sourceRevision), version(0n)],
    });
  const surface = await mount(service);
  await selectButton('加载更早版本');
  await selectButton('展开版本 1');
  const previewTrigger = button('预览版本');
  await act(async () => previewTrigger.focus());

  const pending = deferred<Awaited<ReturnType<BoardHistoryService['listVersions']>>>();
  service.listVersions
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({
      currentRevision: 4n,
      versions: [version(latestRevision), version(sourceRevision)],
      nextBeforeRevision: sourceRevision,
    })
    .mockResolvedValueOnce({ currentRevision: 4n, versions: [version(0n)] });
  await act(async () => surface.render({ revision: 4n }));
  expect(button('展开版本 0')).toBeDefined();
  expect(button('展开版本 3').textContent).not.toContain('当前版本');
  expect(document.activeElement).toBe(previewTrigger);

  await act(async () =>
    pending.resolve({ currentRevision: 4n, versions: [version(4n)], nextBeforeRevision: 4n }),
  );
  expect(service.listVersions.mock.calls.map(([, before]) => before)).toEqual([
    undefined,
    latestRevision,
    undefined,
    4n,
    sourceRevision,
  ]);
  expect(button('展开版本 4').textContent).toContain('当前版本');
  expect(button('展开版本 0')).toBeDefined();
  expect(button('展开版本 1').getAttribute('aria-expanded')).toBe('true');
  expect(button('预览版本')).toBe(previewTrigger);
  expect(document.activeElement).toBe(previewTrigger);
});

function archivedObject(x: number, geometryVersion: bigint): WhiteboardObject {
  return {
    id: objectId,
    kind: 'shape',
    label: '保留的便签',
    geometry: { x, y: 25, width: 100, height: 80, rotation: 0 },
    geometryVersion,
    locked: false,
  };
}

function changedHistoryMock() {
  const service = historyMock();
  const savedAtMillis = new Date(2020, 0, 2, 10, 2).getTime();
  service.listVersions.mockResolvedValue({
    currentRevision: latestRevision,
    versions: [
      { ...version(latestRevision), savedAtMillis, actorId: '协作者甲' },
      { ...version(sourceRevision), savedAtMillis, actorId: '协作者乙' },
      { ...version(0n), kind: 'baseline' },
    ],
  });
  service.getVersionScene.mockImplementation(async (_id, revision) => ({
    ...scene,
    revision,
    objects: [revision === 0n ? archivedObject(10, 0n) : archivedObject(20, 1n)],
  }));

  return service;
}

test('uses the original grouped record, inspected change, back, preview and restore sequence', async () => {
  const service = changedHistoryMock();
  const surface = await mount(service);
  expect(fixture.host.querySelector('[aria-label="2020年1月2日"]')?.textContent).toContain(
    '协作者甲',
  );
  expect(fixture.host.textContent).toContain('当前版本');
  expect(fixture.host.textContent).not.toContain('预览版本');
  await selectButton('展开版本 1');
  expect(service.getVersionScene).toHaveBeenCalledWith(boardId, 0n, expect.any(AbortSignal));
  expect(service.getVersionScene).toHaveBeenCalledWith(
    boardId,
    sourceRevision,
    expect.any(AbortSignal),
  );
  expect(fixture.host.querySelector('[aria-label="历史版本预览"]')).toBeNull();

  await selectButton('看改动');
  const diff = fixture.host.querySelector('[aria-label="逐行改动"]');
  expect(diff?.querySelector('[data-kind="-"]')?.textContent).toContain('"x": 10');
  expect(diff?.querySelector('[data-kind="+"]')?.textContent).toContain('"x": 20');
  expect(document.activeElement).toBe(button('返回版本历史'));
  await selectButton('返回版本历史');
  expect(button('展开版本 1').getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(button('看改动'));

  await selectButton('预览版本');
  expect(button('正在预览')).toBeDefined();
  await selectButton('恢复为新版本');
  expect(fixture.host.querySelector('dialog[open]')?.textContent).toContain('恢复此版本？');
  expect(service.restoreVersion).not.toHaveBeenCalled();
  await selectButton('确认恢复');
  expect(service.restoreVersion).toHaveBeenCalledWith(
    {
      boardId,
      commandId,
      revision: sourceRevision,
      expectedCurrentRevision: latestRevision,
      scope: { kind: 'whole' },
    },
    expect.any(AbortSignal),
  );
  expect(surface.onRestored).toHaveBeenCalledExactlyOnceWith(confirmed);
  expect(fixture.host.querySelector('[aria-label="历史版本预览"]')).toBeNull();
});

test('shows stored titles for current and initial revisions and preserves the real initial time', async () => {
  const service = historyMock();
  const createdAt = '2020-01-01T04:05:00.000Z';
  service.listVersions.mockResolvedValue({
    currentRevision: latestRevision,
    versions: [
      { ...version(latestRevision), title: '当前白板标题' },
      {
        ...version(0n),
        title: '初始白板标题',
        actorId: 'local',
        kind: 'baseline',
        savedAtMillis: Date.parse(createdAt),
      },
    ],
  });
  await mount(service);

  expect(button('展开版本 3').textContent).toContain('当前白板标题');
  const initial = button('展开版本 0');
  expect(initial.textContent).toContain('初始白板标题');
  expect(initial.textContent).toContain('创建作品');
  expect(initial.querySelector('strong')?.textContent).toBe('本机');
  expect(initial.querySelector('time')?.dateTime).toBe(createdAt);
  expect(button('展开版本 3').querySelector('time')).toBeNull();

  await selectButton('展开版本 0');
  expect(fixture.host.textContent).toContain('此时段没有保留的内容变化。');
  expect(button('预览版本')).toBeDefined();
  expect(button('恢复为新版本')).toBeDefined();
  expect(service.getVersionScene).not.toHaveBeenCalled();
});

test('uses the saved Agent name and avatar in the version and its inspected change', async () => {
  const service = changedHistoryMock();
  const agent = {
    ...version(sourceRevision),
    actorId: 'agent-session-test',
    actorKind: 'agent' as const,
    actorName: 'Agent · 测试署名',
  };
  service.listVersions.mockResolvedValue({
    currentRevision: latestRevision,
    versions: [{ ...version(latestRevision), actorId: '协作者' }, agent, version(0n)],
  });
  await mount(service, {
    colorForAuthor: (actorId) => (actorId === agent.actorId ? '#dc3c3d' : '#785ee8'),
  });

  const row = button('展开版本 1');
  expect(row.querySelector('strong')?.textContent).toBe(agent.actorName);
  expect(row.querySelector('[data-agent] svg')).not.toBeNull();
  expect(row.querySelector<HTMLElement>('[data-agent]')?.style.backgroundColor).toBe(
    'rgb(220, 60, 61)',
  );
  expect(button('展开版本 3').querySelector('[data-agent]')).toBeNull();
  await selectButton('展开版本 1');
  await selectButton('看改动');
  const difference = fixture.host.querySelector('.whiteboard-history__difference-meta');
  expect(difference?.textContent).toContain(agent.actorName);
  expect(difference?.querySelector('[data-agent] svg')).not.toBeNull();
  expect(difference?.querySelector<HTMLElement>('[data-agent]')?.style.backgroundColor).toBe(
    'rgb(220, 60, 61)',
  );
  expect(difference?.textContent).not.toContain(agent.actorId);
});

test('confirms an inspected change as the single object restore scope', async () => {
  const service = changedHistoryMock();
  await mount(service);
  await selectButton('展开版本 1');
  await selectButton('看改动');
  await selectButton('只恢复这一处');
  expect(fixture.host.querySelector('dialog[open]')?.textContent).toContain('只恢复这一处？');
  expect(service.restoreVersion).not.toHaveBeenCalled();
  await selectButton('确认恢复');
  expect(service.restoreVersion).toHaveBeenCalledWith(
    {
      boardId,
      commandId,
      revision: sourceRevision,
      expectedCurrentRevision: latestRevision,
      scope: { kind: 'selection', objectIds: [objectId] },
    },
    expect.any(AbortSignal),
  );
});

test('shows the changed HTML line without quoting or truncating the entire body', async () => {
  const service = changedHistoryMock();
  const retained = '<p>' + '不变的内容'.repeat(410) + '</p>';
  service.getVersionScene.mockImplementation(async (_id, revision) => ({
    ...scene,
    revision,
    objects: [{ ...archivedObject(10, 0n), kind: 'embed', payloadVersion: revision }],
  }));
  service.getVersionPayloads.mockImplementation(async (_id, revision) => {
    const html = retained + (revision === 0n ? '\n<p>旧行</p>' : '\n<p>新行</p>');

    return [
      {
        kind: 'loaded',
        payload: { id: objectId, version: revision, body: { kind: 'embed', value: { html } } },
      },
    ];
  });
  await mount(service);
  await selectButton('展开版本 1');
  await selectButton('看改动');

  const diff = fixture.host.querySelector('[aria-label="逐行改动"]');
  expect(diff?.querySelector('[data-kind="-"]')?.textContent).toContain('<p>旧行</p>');
  expect(diff?.querySelector('[data-kind="+"]')?.textContent).toContain('<p>新行</p>');
  expect(diff?.querySelector('p')).toBeNull();
});

test('freezes the selected restore range and expected current revision at confirmation', async () => {
  const service = historyMock();
  const surface = await mount(service);
  await openPreview();
  await selectButton('选择历史对象');
  await selectButton('恢复此版本');
  await selectButton('恢复所选对象 (1)');
  expect(fixture.host.textContent).toContain('将所选 1 个对象恢复到版本 1。');
  expect(service.restoreVersion).not.toHaveBeenCalled();

  surface.render({ revision: 6n });
  await selectButton('确认恢复');
  expect(service.restoreVersion).toHaveBeenCalledExactlyOnceWith(
    {
      boardId,
      commandId,
      revision: sourceRevision,
      expectedCurrentRevision: latestRevision,
      scope: { kind: 'selection', objectIds: [objectId] },
    },
    expect.any(AbortSignal),
  );
  expect(surface.onRestored).toHaveBeenCalledExactlyOnceWith(confirmed);
  expect(fixture.host.querySelector('[aria-label="历史版本预览"]')).toBeNull();
});

test('exports a historical PNG selection and always uses the whole revision for HTML', async () => {
  const service = historyMock();
  await mount(service);
  await openPreview();
  await selectButton('选择历史对象');
  expect(fixture.host.querySelector('select')).toBeNull();
  await selectButton('导出历史版本');
  act(chooseSelection);
  await selectButton('导出 PNG');
  expect(fixture.host.querySelector('select')).toBeNull();
  await selectButton('导出历史版本');
  await selectButton('导出整板 HTML');

  const commands = service.exportVersion.mock.calls.map(([request]) => request);
  expect(commands).toEqual([
    {
      boardId,
      revision: sourceRevision,
      format: 'png',
      scope: { kind: 'selection', objectIds: [objectId] },
    },
    { boardId, revision: sourceRevision, format: 'html', scope: { kind: 'whole' } },
  ]);
  expect(fixture.host.textContent).toContain('所选历史版本已无法导出。');
});

test('checks the original restore receipt before retrying a transport failure', async () => {
  const service = historyMock();
  service.restoreVersion.mockRejectedValueOnce(new Error('连接中断'));
  service.getRestoreReceipt.mockResolvedValueOnce(undefined).mockResolvedValueOnce(confirmed);
  const surface = await mount(service);
  await openPreview();
  await selectButton('恢复此版本');
  await selectButton('确认恢复');
  expect(fixture.host.textContent).toContain('恢复结果待确认');
  expect(service.getRestoreReceipt).toHaveBeenCalledWith(
    boardId,
    commandId,
    expect.any(AbortSignal),
  );
  await selectButton('核对并重试');
  expect(service.restoreVersion).toHaveBeenCalledOnce();
  expect(service.getRestoreReceipt).toHaveBeenCalledTimes(2);
  expect(surface.onRestored).toHaveBeenCalledExactlyOnceWith(confirmed);
});

test('keeps the original command after both requests fail and verifies it from reopened history', async () => {
  const service = historyMock();
  service.restoreVersion.mockRejectedValueOnce(new Error('恢复连接中断'));
  service.getRestoreReceipt.mockRejectedValueOnce(new Error('回执连接中断'));
  service.getRestoreReceipt.mockResolvedValue(confirmed);
  const surface = await mount(service);
  await openPreview();
  await selectButton('恢复此版本');
  await selectButton('确认恢复');
  expect(fixture.host.textContent).toContain('恢复结果待确认');

  await selectButton('关闭恢复确认');
  expect(fixture.host.querySelector('dialog[open]')).toBeNull();
  expect(fixture.host.textContent).toContain('待核对版本 1');
  await selectButton('退出预览');
  expect(surface.onPreviewChange).toHaveBeenLastCalledWith(false);
  await selectButton('关闭版本历史');
  await selectButton('打开版本历史');
  expect(fixture.host.textContent).toContain('待核对版本 1');
  await selectButton('核对原回执');

  expect(service.restoreVersion).toHaveBeenCalledOnce();
  expect(service.getRestoreReceipt).toHaveBeenCalledTimes(2);
  expect(service.getRestoreReceipt).toHaveBeenLastCalledWith(
    boardId,
    commandId,
    expect.any(AbortSignal),
  );
  expect(surface.onRestored).toHaveBeenCalledExactlyOnceWith(confirmed);
  await selectButton('打开版本历史');
  expect(fixture.host.textContent).not.toContain('核对原回执');
});

test('exits while the restore connection is still pending and ignores a duplicate late response', async () => {
  const original = deferred<BoardEditReceipt>();
  const service = historyMock();
  service.restoreVersion.mockReturnValueOnce(original.promise);
  service.getRestoreReceipt.mockResolvedValueOnce(confirmed);
  const surface = await mount(service);
  await openPreview();
  await selectButton('恢复此版本');
  await selectButton('确认恢复');
  expect(fixture.host.textContent).toContain('正在恢复版本');
  await selectButton('关闭确认');
  expect(service.restoreVersion.mock.calls[0]?.[1]?.aborted).toBe(true);
  await selectButton('退出预览');
  await selectButton('关闭版本历史');
  await selectButton('打开版本历史');
  await selectButton('核对原回执');
  await act(async () => original.resolve(confirmed));

  expect(surface.onRestored).toHaveBeenCalledExactlyOnceWith(confirmed);
  expect(service.getRestoreReceipt).toHaveBeenCalledExactlyOnceWith(
    boardId,
    commandId,
    expect.any(AbortSignal),
  );
});

test('reopens a history menu while a detached receipt lookup still has no reply', async () => {
  const pending = deferred<BoardEditReceipt>();
  const service = historyMock();
  service.restoreVersion.mockRejectedValueOnce(new Error('恢复连接中断'));
  service.getRestoreReceipt.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise);
  service.getRestoreReceipt.mockResolvedValue(confirmed);
  const surface = await mount(service);
  await openPreview();
  await selectButton('恢复此版本');
  await selectButton('确认恢复');
  await selectButton('关闭确认');
  await selectButton('退出预览');
  await selectButton('关闭版本历史');
  await selectButton('打开版本历史');
  await selectButton('核对原回执');
  await selectButton('关闭版本历史入口');
  expect(service.getRestoreReceipt.mock.calls[1]?.[2]?.aborted).toBe(true);

  await selectButton('打开版本历史');
  expect(button('核对原回执').disabled).toBe(false);
  await selectButton('核对原回执');
  await act(async () => pending.resolve(confirmed));
  expect(surface.onRestored).toHaveBeenCalledExactlyOnceWith(confirmed);
});

test('clears recovery and allows a fresh attempt after a definite rejection', async () => {
  const service = historyMock();
  service.restoreVersion.mockResolvedValueOnce({
    kind: 'rejected',
    boardId,
    commandId,
    reason: 'versionUnavailable',
  });
  const surface = await mount(service);
  await openPreview();
  await selectButton('恢复此版本');
  await selectButton('确认恢复');
  expect(fixture.host.textContent).toContain('所选历史版本已无法恢复');
  expect(fixture.host.textContent).not.toContain('待核对版本');
  expect(fixture.host.querySelector('dialog[open]')).toBeNull();
  expect(service.getRestoreReceipt).not.toHaveBeenCalled();
  await selectButton('恢复此版本');
  await selectButton('确认恢复');

  expect(service.restoreVersion).toHaveBeenCalledTimes(2);
  expect(surface.onRestored).toHaveBeenCalledExactlyOnceWith(confirmed);
});

test('cannot publish a restore receipt after the board history session has unmounted', async () => {
  const original = deferred<BoardEditReceipt>();
  const service = historyMock();
  service.restoreVersion.mockReturnValueOnce(original.promise);
  const surface = await mount(service);
  await openPreview();
  await selectButton('恢复此版本');
  await selectButton('确认恢复');
  surface.render({ boardId: 'other-board' });
  expect(service.restoreVersion.mock.calls[0]?.[1]?.aborted).toBe(true);
  await act(async () => original.resolve(confirmed));

  expect(surface.onRestored).not.toHaveBeenCalled();
  expect(fixture.host.textContent).not.toContain('待核对版本');
});

test('aborts scene loading when the board changes and ignores stale successful reads', async () => {
  const oldScene = deferred<WhiteboardScene>();
  const service = historyMock();
  const surface = await mount(service);
  await selectButton('展开版本 1');
  service.getVersionScene.mockReturnValueOnce(oldScene.promise);
  await selectButton('预览版本');
  surface.render({ boardId: 'other-board' });
  expect(service.getVersionScene.mock.lastCall?.[2]?.aborted).toBe(true);
  await act(async () => oldScene.resolve(scene));
  expect(surface.onPreviewChange).not.toHaveBeenCalled();
  expect(fixture.host.querySelector('[aria-label="历史版本预览"]')).toBeNull();
});

test('allows read-only version export and cancels late downloads on preview exit', async () => {
  const exported = deferred<BoardHistoryExportResult>();
  const service = historyMock();
  service.exportVersion.mockReturnValueOnce(exported.promise);
  const surface = await mount(service, { canEdit: false });
  await openPreview();
  expect(fixture.host.textContent).not.toContain('恢复此版本');
  await selectButton('导出历史版本');
  await selectButton('导出 SVG');
  expect(service.exportVersion).toHaveBeenCalledExactlyOnceWith(
    { boardId, revision: sourceRevision, scope: { kind: 'whole' }, format: 'svg' },
    expect.any(AbortSignal),
  );
  await selectButton('退出预览');
  expect(service.exportVersion.mock.calls[0]?.[1]?.aborted).toBe(true);
  await act(async () =>
    exported.resolve({
      kind: 'file',
      file: {
        filename: '历史.svg',
        mimeType: 'image/svg+xml',
        revision: sourceRevision,
        content: new TextEncoder().encode('<svg/>'),
      },
    }),
  );
  expect(surface.download).not.toHaveBeenCalled();
});

test('loads visible payloads only for the displayed version and closes that preview scope', async () => {
  const service = historyMock();
  let lastFrame: BoardHistoryPreviewFrame | undefined;

  await mount(service, {}, (frame) => {
    lastFrame = frame;
    return previewFrame(frame);
  });
  await openPreview();
  if (!lastFrame) {
    throw new Error('Expected an open history preview.');
  }

  const { loadPayloads } = lastFrame;
  const controller = new AbortController();
  await expect(loadPayloads([objectId], controller.signal)).resolves.toEqual([]);
  expect(service.getVersionPayloads).toHaveBeenCalledExactlyOnceWith(
    boardId,
    sourceRevision,
    [objectId],
    expect.any(AbortSignal),
  );
  await selectButton('退出预览');
  expect(service.getVersionPayloads.mock.calls[0]?.[3]?.aborted).toBe(true);
  await expect(loadPayloads([objectId])).rejects.toMatchObject({ name: 'AbortError' });
  expect(service.getVersionPayloads).toHaveBeenCalledOnce();
});
