import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  DEFAULT_STYLE,
  LOCAL_ACTOR,
  type Board,
  type BoardElement,
  type Feedback,
  type StudioClient,
  type ToolName,
} from '../../src/contracts/studio';
import { StudioCollaboration } from '../../src/core/shared/collaboration';
import type { ProductActivity } from '../../src/app/product-contract';
import { createStudioToolCall } from '../../src/app/transport/tool-response';

function stubToolCall(respond: (name: ToolName, args: Record<string, unknown>) => unknown) {
  return createStudioToolCall(async (name, args, read) =>
    read(Response.json({ ok: true, data: await respond(name, args) })),
  );
}

vi.mock('../../src/app/features/whiteboard/canvas/WhiteboardCanvas', () => ({
  default: ({
    board,
    onActivityChange,
    onSelectionChange,
    onEditHtml,
    activities,
    documentControls,
  }: {
    board: Board;
    onActivityChange?: (state: ProductActivity) => void;
    onSelectionChange?: (ids: string[]) => void;
    onEditHtml?: (element?: BoardElement) => void;
    activities?: Feedback[];
    documentControls?: ReactNode;
  }) => (
    <section
      aria-label="测试画布"
      data-artifact={board.artifact.id}
      data-activities={activities?.map((item) => item.id).join(',')}
    >
      {documentControls}
      <button
        onClick={() => {
          onSelectionChange?.(['region']);
          onActivityChange?.({
            editingIds: ['region'],
            movingIds: [],
            dirty: true,
            issues: [{ type: 'save', message: '待保存', ids: ['region'] }],
          });
        }}
      >
        编辑区域
      </button>
      <button
        onClick={() => onEditHtml?.(board.elements.find((element) => element.id === 'region'))}
      >
        编辑 HTML
      </button>
    </section>
  ),
}));
import StudioApp from '../../src/app/shell/StudioApp';
import { studioRequest } from '../../src/app/transport/client';
import { whiteboardProduct } from '../../src/app/features/whiteboard/whiteboard';

const makeBoard = (id: string): Board => ({
  artifact: {
    id,
    type: 'whiteboard',
    title: id,
    revision: 0,
    pinned: false,
    createdAt: '',
    updatedAt: '',
  },
  elements: [
    {
      id: 'region',
      type: 'html',
      text: '区域',
      html: '<h1>原文</h1>',
      version: 1,
      sourceRevision: 1,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    },
  ],
  style: DEFAULT_STYLE,
});
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(
    (element) =>
      element.getAttribute('aria-label') === label || element.textContent?.trim() === label,
  );

  if (!found) {
    throw new Error(`Missing ${label}`);
  }

  return found;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

async function change(textarea: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      textarea,
      value,
    );
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function waitUntil(check: () => boolean, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    if (check()) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
    });
  }

  throw new Error('UI did not settle');
}

it('publishes actual activity for this view, passes only processing feedback and clears it when switching artifacts', async () => {
  const board = makeBoard('first');
  const onContext = vi.fn();
  const processing: Feedback = {
    id: 'processing',
    artifactId: 'first',
    type: 'request',
    anchor: { elementIds: ['region'] },
    author: LOCAL_ACTOR,
    status: 'processing',
    text: '修改区域',
    createdAt: '',
    updatedAt: '',
    replies: [],
    processingBy: { ...LOCAL_ACTOR, kind: 'agent' },
  };
  const client: StudioClient = {
    embedded: true,
    call: stubToolCall((name, args) => {
      if (name === 'artifact_feedback') {
        return { feedback: [processing, { ...processing, id: 'resolved', status: 'resolved' }] };
      }

      return name === 'artifact_read' ? makeBoard(String(args?.artifactId)) : { artifacts: [] };
    }),
  };
  await act(async () =>
    root.render(
      <StudioApp
        requestStudio={studioRequest}
        client={client}
        actor={LOCAL_ACTOR}
        initialArtifactId={board.artifact.id}
        onViewContext={onContext}
      />,
    ),
  );
  await waitUntil(() => !!container.querySelector('[aria-label="测试画布"]'));
  expect(container.querySelector('[aria-label="测试画布"]')?.getAttribute('data-activities')).toBe(
    'processing',
  );
  await click('编辑区域');
  const context = onContext.mock.calls.at(-1)?.[0];
  expect(context).toMatchObject({
    artifactId: 'first',
    selectedIds: ['region'],
    editingIds: ['region'],
    movingIds: [],
    dirty: true,
    issues: [{ type: 'save', message: '待保存', ids: ['region'] }],
  });
  await act(async () =>
    root.render(
      <StudioApp
        requestStudio={studioRequest}
        client={client}
        actor={LOCAL_ACTOR}
        initialArtifactId="second"
        onViewContext={onContext}
      />,
    ),
  );
  await waitUntil(
    () =>
      container.querySelector('[aria-label="测试画布"]')?.getAttribute('data-artifact') ===
      'second',
  );
  expect(onContext.mock.calls.at(-1)?.[0]).toMatchObject({
    artifactId: 'second',
    viewId: context.viewId,
    selectedIds: [],
    editingIds: [],
    movingIds: [],
    dirty: false,
    issues: [],
  });
});

it('keeps the confirmed host context during a slow remount and publishes a fresh live identity when ready', async () => {
  const board = makeBoard('resume-board');
  const onContext = vi.fn();
  const collaboration = new StudioCollaboration();
  let allowSession!: (response: Response) => void;
  let allowBoard!: (response: Response) => void;
  const session = new Promise<Response>((resolve) => {
    allowSession = resolve;
  });
  const contents = new Promise<Response>((resolve) => {
    allowBoard = resolve;
  });
  const request: StudioClient['request'] = vi.fn(async (input, options) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/session') {
      return session;
    }
    if (url.pathname === '/api/sync') {
      return Response.json(
        await collaboration.sync(
          board.artifact.id,
          {
            after: url.searchParams.get('after') || undefined,
            wait: Number(url.searchParams.get('wait')),
            peerId: url.searchParams.get('peerId') || undefined,
            peerEpoch: url.searchParams.get('peerEpoch') || undefined,
            signal: options?.signal || undefined,
          },
          LOCAL_ACTOR,
        ),
      );
    }
    if (url.pathname.endsWith('artifact_read')) {
      return contents;
    }
    if (url.pathname.endsWith('artifact_feedback')) {
      return Response.json({ ok: true, data: { feedback: [] } });
    }

    return Response.json({ peers: [], timer: null });
  });
  const client: StudioClient = {
    embedded: true,
    baseUrl: 'http://studio.test',
    request,
    call: stubToolCall(() => ({ artifacts: [] })),
  };
  const retained = {
    artifactId: board.artifact.id,
    viewId: 'old-view',
    selectedIds: ['region'],
    viewport: { x: 40, y: 55, zoom: 0.75 },
  };

  try {
    await act(async () =>
      root.render(
        <StudioApp
          requestStudio={studioRequest}
          client={client}
          actor={LOCAL_ACTOR}
          initialArtifactId={board.artifact.id}
          restoredView={retained}
          onViewContext={onContext}
        />,
      ),
    );
    expect(onContext).not.toHaveBeenCalled();
    await act(async () => allowSession(Response.json({ actor: LOCAL_ACTOR, access: 'local' })));
    await waitUntil(() =>
      vi
        .mocked(request)
        .mock.calls.some(([input]) => String(input).endsWith('/api/tools/artifact_read')),
    );
    expect(onContext).not.toHaveBeenCalled();
    await act(async () => allowBoard(Response.json({ ok: true, data: board })));
    await waitUntil(
      () => !!container.querySelector('[aria-label="测试画布"]') && onContext.mock.calls.length > 0,
    );
    const current = onContext.mock.calls.at(-1)?.[0];
    expect(current).toMatchObject({
      artifactId: retained.artifactId,
      selectedIds: retained.selectedIds,
      viewport: retained.viewport,
    });
    expect(current.viewId).not.toBe(retained.viewId);
    expect(
      vi.mocked(request).mock.calls.some(([input]) => {
        const url = new URL(String(input));

        return url.pathname === '/api/sync' && url.searchParams.get('peerId') === current.viewId;
      }),
    ).toBe(true);
    await click('返回 Luming Studio');
    expect(onContext.mock.calls.at(-1)?.[0]).toBeNull();
  } finally {
    collaboration.close();
  }
});

it('reports source editing and preserves the dirty draft and failure until a successful retry', async () => {
  const board = makeBoard('source-board');
  const onActivity = vi.fn();
  const onChanged = vi.fn();
  const onError = vi.fn();
  let attempts = 0;
  const client: StudioClient = {
    embedded: true,
    call: stubToolCall((name) => {
      if (name === 'artifact_read') {
        return { html: '<h1>原文</h1>' };
      }
      if (++attempts === 1) {
        throw new Error('连接断开');
      }

      return { board };
    }),
  };
  const Editor = whiteboardProduct.Editor;
  await act(async () =>
    root.render(
      <Editor
        document={board}
        actor={LOCAL_ACTOR}
        client={client}
        onChanged={onChanged}
        onError={onError}
        onNotice={() => {}}
        onActivityChange={onActivity}
        onAnnotate={() => {}}
        onSelectionChange={() => {}}
        onViewportChange={() => {}}
        onCursorMove={() => {}}
        presence={[]}
        selfPeerId="test"
      />,
    ),
  );
  await click('编辑 HTML');
  expect(onActivity.mock.calls.at(-1)?.[0]).toMatchObject({ editingIds: ['region'], dirty: false });
  const draft = '<h1>保留我的草稿</h1>';
  await change(container.querySelector('textarea')!, draft);
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(container.querySelector('textarea')?.value).toBe(draft);
  expect(onActivity.mock.calls.at(-1)?.[0]).toMatchObject({
    editingIds: ['region'],
    dirty: true,
    issues: [{ type: 'source-save', message: '连接断开', ids: ['region'] }],
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(onChanged).toHaveBeenCalledWith(board);
  expect(container.querySelector('textarea')).toBeNull();
  expect(onActivity.mock.calls.at(-1)?.[0]).toMatchObject({
    editingIds: [],
    movingIds: [],
    dirty: false,
    issues: [],
  });
});

it('shows real dirty, pending, failed and saved source writes in the header', async () => {
  const board = makeBoard('save-state-board');
  const renderErrors = vi.spyOn(console, 'error');
  let resolveWrite: ((value: { board: Board }) => void) | undefined;
  let rejectWrite: ((error: Error) => void) | undefined;
  const client: StudioClient = {
    embedded: true,
    call: stubToolCall((name, args) => {
      if (name === 'artifact_feedback') {
        return { feedback: [] };
      }
      if (name === 'artifact_read') {
        return args?.mode === 'source' ? { html: '<h1>原文</h1>' } : board;
      }

      return new Promise<{ board: Board }>((resolve, reject) => {
        resolveWrite = resolve;
        rejectWrite = reject;
      });
    }),
  };
  await act(async () =>
    root.render(
      <StudioApp
        requestStudio={studioRequest}
        client={client}
        actor={LOCAL_ACTOR}
        initialArtifactId={board.artifact.id}
      />,
    ),
  );
  await waitUntil(() => !!container.querySelector('[aria-label="测试画布"]'));
  const saveStatus = () => container.querySelector<HTMLElement>('[data-save-status]')!;
  expect(saveStatus().dataset.saveStatus).toBe('saved');
  expect(saveStatus().classList.contains('studio-save-saved')).toBe(true);
  await click('编辑 HTML');
  await change(
    container.querySelector<HTMLTextAreaElement>('#studio-html-source')!,
    '<h1>尚未保存</h1>',
  );
  expect(saveStatus().textContent).toBe('未保存');
  expect(saveStatus().classList.contains('studio-save-dirty')).toBe(true);
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(saveStatus().textContent).toBe('保存中…');
  expect(saveStatus().classList.contains('studio-save-saving')).toBe(true);
  await act(async () => rejectWrite!(new Error('磁盘暂时无法写入')));
  expect(saveStatus().textContent).toBe('保存异常');
  expect(saveStatus().title).toBe('磁盘暂时无法写入');
  expect(container.querySelector<HTMLTextAreaElement>('#studio-html-source')?.value).toBe(
    '<h1>尚未保存</h1>',
  );
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(saveStatus().textContent).toBe('保存中…');
  await act(async () => resolveWrite!({ board }));
  expect(saveStatus().textContent).toBe('已保存');
  expect(saveStatus().title).toBe('已保存');
  expect(saveStatus().getAttribute('aria-label')).toBe('已保存');
  expect(container.querySelector('#studio-html-source')).toBeNull();
  expect(renderErrors.mock.calls.some((args) => String(args[0]).includes('same key'))).toBe(false);
});

it('uses the shared presence channel to start, adjust, pause, resume and reset the room timer', async () => {
  const initialTime = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(initialTime);
  const collaboration = new StudioCollaboration();
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
    const url = new URL(String(_url));
    if (url.pathname === '/api/session') {
      return Response.json({ actor: LOCAL_ACTOR, access: 'local' });
    }
    if (url.pathname === '/api/sync') {
      return Response.json(
        await collaboration.sync(
          'timer-board',
          {
            after: url.searchParams.get('after') || undefined,
            wait: Number(url.searchParams.get('wait')),
            peerId: url.searchParams.get('peerId') || undefined,
            peerEpoch: url.searchParams.get('peerEpoch') || undefined,
            signal: options?.signal || undefined,
          },
          LOCAL_ACTOR,
        ),
      );
    }
    if (url.pathname.startsWith('/api/tools/')) {
      return Response.json({
        ok: true,
        data: url.pathname.endsWith('artifact_feedback')
          ? { feedback: [] }
          : makeBoard('timer-board'),
      });
    }

    const input = options?.body ? JSON.parse(String(options.body)) : undefined;
    const result = input
      ? await collaboration.update('timer-board', input, LOCAL_ACTOR)
      : { peers: [], timer: collaboration.getTimer('timer-board') };

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const client: StudioClient = {
    embedded: true,
    baseUrl: 'http://studio.test',
    token: 'test-token',
    call: stubToolCall((name) =>
      name === 'artifact_feedback' ? { feedback: [] } : makeBoard('timer-board'),
    ),
  };
  await act(async () =>
    root.render(
      <StudioApp
        requestStudio={studioRequest}
        client={client}
        actor={LOCAL_ACTOR}
        initialArtifactId="timer-board"
      />,
    ),
  );
  await waitUntil(() => !!container.querySelector('[aria-label="测试画布"]'));
  const remaining = () => container.querySelector('[aria-label="剩余时间"]')?.textContent;
  const timerStatus = () => container.querySelector('[aria-label="计时状态"]')?.textContent;
  const waitForTimer = async (action: string, check: () => boolean) => {
    try {
      await waitUntil(check, 240);
    } catch (cause) {
      const serviceTimer = JSON.stringify(collaboration.getTimer('timer-board'));
      const actions = request.mock.calls
        .map(([, options]) =>
          options?.body ? JSON.parse(String(options.body)).timer?.action : undefined,
        )
        .filter(Boolean);

      throw new Error(
        `Timer did not settle after ${action}: ${remaining()} / ${timerStatus()} / ${serviceTimer} / ${actions.join(',')}`,
        { cause },
      );
    }
  };
  const clickTimerControl = async (label: string) => {
    await waitForTimer(`waiting for ${label}`, () => !button(label).disabled);
    await click(label);
  };

  await click('共享计时器');
  await clickTimerControl('开始');
  await waitForTimer('start', () => remaining() === '05:00');
  expect(remaining()).toBe('05:00');
  await clickTimerControl('增加一分钟');
  await waitForTimer('adjust', () => remaining() === '06:00');
  expect(collaboration.getTimer('timer-board')).toMatchObject({ durationMs: 300_000 });
  expect(remaining()).toBe('06:00');
  await clickTimerControl('暂停');
  await waitForTimer('pause', () => !!timerStatus()?.includes('已暂停'));
  expect(timerStatus()).toContain('已暂停');
  await clickTimerControl('继续');
  await waitForTimer('resume', () => !!timerStatus()?.includes('计时中'));
  expect(timerStatus()).toContain('计时中');
  await clickTimerControl('暂停');
  await waitForTimer('pause', () => !!timerStatus()?.includes('已暂停'));
  await clickTimerControl('重置');
  await waitForTimer('reset', () => remaining() === undefined);
  expect(container.querySelector('[aria-label="剩余时间"]')).toBeNull();
  expect(collaboration.getTimer('timer-board')).toMatchObject({
    durationMs: 300_000,
    remainingMs: 300_000,
    deadline: null,
    paused: false,
  });
  expect((container.querySelector('[aria-label="计时分钟"]') as HTMLInputElement).value).toBe('05');
  const actions = request.mock.calls
    .flatMap(([, options]) => (options?.body ? [JSON.parse(String(options.body)).timer] : []))
    .filter(Boolean);
  expect(actions).toEqual([
    { action: 'start', durationSeconds: 300 },
    { action: 'adjust', deltaSeconds: 60 },
    { action: 'pause' },
    { action: 'resume' },
    { action: 'pause' },
    { action: 'reset' },
  ]);
});
