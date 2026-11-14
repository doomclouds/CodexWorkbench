// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor, Presence, StudioClient } from '../src/contracts/studio';
import { useStudioSession } from '../src/app/shared/useStudioSession';
import { SessionNotice } from '../src/app/shared/SessionNotice';
import { presenceMembers } from '../src/app/shared/presence-members';

const editor: Actor = { id: 'member-one', name: '小林', kind: 'human', role: 'editor' };
let container: HTMLDivElement, root: Root;
function Fixture({ client }: { client: StudioClient }) {
  const session = useStudioSession(client, editor, 'board-one');
  const [draft, setDraft] = useState('未提交的内容');
  const run = (pending: Promise<unknown>) => { void pending.catch(() => {}); };
  return <><SessionNotice status={session.status} reason={session.reason} onRetry={() => run(session.check())} /><output data-status={session.status}>{session.actor.id}:{session.actor.role}</output><textarea aria-label="草稿" readOnly={session.status !== 'valid'} value={draft} onChange={event => setDraft(event.target.value)} /><button disabled={session.status !== 'valid'} onClick={() => run(session.client.call('artifact_apply', { artifactId: 'board-one' }))}>保存</button><button onClick={() => run(session.client.request!('http://studio.test/api/presence', { method: 'POST' }))}>传输请求</button><button onClick={() => session.revoke('removed')}>移除事件</button><button onClick={() => session.revoke('local-only')}>仅本机事件</button><button onClick={() => session.revoke('role-changed')}>权限事件</button></>;
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
const status = () => container.querySelector('output')?.getAttribute('data-status');
const button = (label: string) => [...container.querySelectorAll('button')].find(node => node.textContent === label)!;
async function click(label: string) { await act(async () => button(label).click()); }
async function render(client: StudioClient) { await act(async () => root.render(<Fixture client={client} />)); }
function source(request: StudioClient['request'], call: StudioClient['call'] = vi.fn().mockResolvedValue({})) { return { baseUrl: 'http://studio.test', token: 'member-secret', embedded: true, request, call }; }

describe('active session authority', () => {
  it('rechecks an authentication failure, applies the current server role, and retains drafts without replaying a write', async () => {
    let actor = editor;
    const request = vi.fn(async () => Response.json({ actor, access: 'lan' }));
    const call = vi.fn().mockRejectedValue(Object.assign(new Error('身份待核对'), { status: 401, code: 'UNAUTHORIZED' }));
    await render(source(request, call));
    actor = { ...editor, role: 'viewer' };
    await click('保存');
    expect(request).toHaveBeenCalledTimes(2);
    expect(status()).toBe('valid'); expect(container.querySelector('output')?.textContent).toBe('member-one:viewer');
    expect(container.querySelector('textarea')?.value).toBe('未提交的内容'); expect(call).toHaveBeenCalledTimes(1);
  });

  it('does not treat an ordinary role FORBIDDEN as removal or start session recovery', async () => {
    const request = vi.fn(async input => new URL(String(input)).pathname === '/api/session' ? Response.json({ actor: editor }) : Response.json({ ok: false, error: { code: 'FORBIDDEN', message: '该角色不能写入。' } }, { status: 403 }));
    const call = vi.fn().mockRejectedValue(Object.assign(new Error('该角色不能写入'), { code: 'FORBIDDEN', status: 403 }));
    await render(source(request, call)); await click('保存'); await click('传输请求');
    expect(status()).toBe('valid'); expect(container.textContent).not.toContain('房主已移除');
    expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/api/session')).toHaveLength(1);
  });

  it('observes authentication details on any request and shows the precise terminal reason', async () => {
    let sessions = 0;
    const request = vi.fn(async input => {
      if (new URL(String(input)).pathname === '/api/session' && ++sessions === 1) return Response.json({ actor: editor });
      return Response.json({ ok: false, error: { code: 'UNAUTHORIZED', details: { reason: 'link-reset' } } }, { status: 401 });
    });
    await render(source(request)); await click('传输请求');
    expect(status()).toBe('denied'); expect(container.textContent).toContain('此分享链接已重置');
    expect(container.textContent).not.toContain('房主已移除'); expect(button('保存').disabled).toBe(true);
  });

  it('ends a trusted removal immediately even when the listener is gone, and makes no further network requests', async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () => Response.json({ actor: editor }));
    await render(source(request)); await click('移除事件');
    expect(status()).toBe('denied'); expect(container.textContent).toContain('房主已移除你的访问权限，请联系房主');
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(request).toHaveBeenCalledTimes(1); expect(container.querySelector('textarea')?.value).toBe('未提交的内容');
  });

  it('does not call local-only removal and ignores a late successful check after a terminal event', async () => {
    let finish: ((response: Response) => void) | undefined;
    const request = vi.fn().mockResolvedValueOnce(Response.json({ actor: editor })).mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    await render(source(request)); await click('权限事件'); expect(status()).toBe('checking');
    await click('仅本机事件'); expect(status()).toBe('denied');
    await act(async () => finish!(Response.json({ actor: editor })));
    expect(status()).toBe('denied'); expect(container.textContent).toContain('仅本机访问'); expect(container.textContent).not.toContain('房主已移除');
  });

  it('retries only authority checks after a network outage and restores the draft and editing role', async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockResolvedValueOnce(Response.json({ actor: editor })).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(Response.json({ actor: editor }));
    const call = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await render(source(request, call)); await click('保存');
    expect(status()).toBe('reconnecting'); expect(button('保存').disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(status()).toBe('valid'); expect(button('保存').disabled).toBe(false);
    expect(call).toHaveBeenCalledTimes(1); expect(container.querySelector('textarea')?.value).toBe('未提交的内容');
  });

  it('discards a pre-change background response instead of restoring stale editor permissions', async () => {
    vi.useFakeTimers(); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let finishOld: ((response: Response) => void) | undefined;
    const request = vi.fn().mockResolvedValueOnce(Response.json({ actor: editor }))
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }))
      .mockResolvedValue(Response.json({ actor: { ...editor, role: 'viewer' } }));
    await render(source(request));
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(request).toHaveBeenCalledTimes(2);
    await click('权限事件'); expect(request).toHaveBeenCalledTimes(3);
    expect(container.querySelector('output')?.textContent).toBe('member-one:viewer');
    await act(async () => finishOld!(Response.json({ actor: editor })));
    expect(container.querySelector('output')?.textContent).toBe('member-one:viewer'); expect(status()).toBe('valid');
  });
});

it('groups by actor ID, excludes every own page, and retains all remote page cursors while choosing the most recent viewport', () => {
  const peer = (peerId: string, actor: Actor, updatedAt: string, viewport?: { x: number; y: number; zoom: number }): Presence => ({ peerId, actor, updatedAt, cursor: { x: 3, y: 4 }, context: { artifactId: 'board-one', viewId: peerId, selectedIds: [], viewport } });
  const remote = { ...editor, id: 'remote' }, other = { ...editor, id: 'same-name' };
  const peers = [peer('self-first', editor, '2026-11-14T10:00:01Z'), peer('self-second', editor, '2026-11-14T10:00:02Z'), peer('remote-old', remote, '2026-11-14T10:00:01Z', { x: 1, y: 1, zoom: 1 }), peer('remote-active', remote, '2026-11-14T10:00:03Z', { x: 2, y: 3, zoom: 2 }), peer('remote-no-view', remote, '2026-11-14T10:00:04Z'), peer('other', other, '2026-11-14T10:00:02Z')];
  const members = presenceMembers(peers, editor.id);
  expect(members.map(member => member.actor.id)).toEqual(['remote', 'same-name']);
  expect(members[0]?.peer.peerId).toBe('remote-active'); expect(members[0]?.peers).toHaveLength(3);
  expect(peers).toHaveLength(6); expect(members[0]?.peers.every(page => page.cursor?.x === 3)).toBe(true);
});
