// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import StudioApp from '../src/app/StudioApp';
import { LOCAL_ACTOR } from '../src/contracts/studio';
import type { Artifact, StudioClient, ToolName } from '../src/contracts/studio';

let host: HTMLDivElement, root: Root, legacy: Artifact, client: StudioClient;
let calls: { name: ToolName; args: Record<string, unknown> }[];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear(); calls = [];
  legacy = { id: 'legacy-board', type: 'whiteboard', title: '旧版设计讨论', revision: 761, pinned: false, createdAt: '2026-11-18T00:00:00Z', updatedAt: '2026-11-18T01:00:00Z', storageStatus: 'unsupported', thumbnail: '/forbidden-legacy-preview' };
  client = {
    embedded: true,
    async call<T>(name: ToolName, args: Record<string, unknown> = {}) {
      calls.push({ name, args });
      if (name === 'artifact_list') return { artifacts: legacy && !!legacy.trashedAt === !!args.trashed ? [legacy] : [] } as T;
      if (name === 'artifact_manage' && args.action === 'trash') { legacy = { ...legacy, trashedAt: '2026-11-18T02:00:00Z' }; return { artifact: legacy } as T; }
      if (name === 'artifact_manage' && args.action === 'purge') { const id = legacy.id; legacy = undefined!; return { deletedIds: [id], failures: [] } as T; }
      if (name === 'artifact_feedback') return { feedback: [] } as T;
      if (name === 'artifact_read') throw Object.assign(new Error('旧版作品不受支持'), { code: 'UNSUPPORTED_STORAGE' });
      throw new Error(`Unexpected legacy request: ${name}`);
    },
  };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function button(label: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.getAttribute('aria-label') === label || item.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button ${label}: ${host.textContent}`);
  return result;
}
async function click(node: HTMLElement) { await act(async () => node.click()); }
async function until(check: () => boolean) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(check()).toBe(true); });
}
async function mount(artifactId?: string) { await act(async () => root.render(<StudioApp client={client} actor={LOCAL_ACTOR} initialArtifactId={artifactId} />)); }

it.each(['grid', 'list'])('shows an unsupported legacy entry in %s with trash as its sole management action', async layout => {
  localStorage.setItem('agentero-studio-view', layout);
  await mount(); await until(() => !!host.querySelector('.studio-artifact'));
  expect(host.textContent).toContain('旧版作品 · 不受支持');
  expect(button('打开白板：旧版设计讨论').disabled).toBe(true);
  expect(host.querySelector('img')).toBeNull();
  await click(button('打开白板：旧版设计讨论'));
  expect(calls.some(call => call.name === 'artifact_read')).toBe(false);
  await click(button('管理作品：旧版设计讨论'));
  expect([...host.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)).toEqual(['移入回收站']);
  await click(button('移入回收站')); await until(() => !host.querySelector('.studio-artifact'));
  expect(host.textContent).toContain('已移入回收站。'); expect(host.textContent).not.toContain('可以随时恢复');
  await click(button('筛选作品')); await click(button('回收站'));
  await until(() => !!host.querySelector('.studio-artifact'));
  expect(host.querySelector('[aria-label="恢复作品：旧版设计讨论"]')).toBeNull();
  await click(button('清空回收站')); await until(() => !!host.querySelector('[role="dialog"]'));
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('此操作无法恢复');
  expect(calls.some(call => call.name === 'artifact_manage' && call.args.action === 'purge')).toBe(false);
  await click(button('取消')); expect(legacy).toBeDefined();
  await click(button('清空回收站')); await until(() => !!host.querySelector('[role="dialog"]'));
  await click(host.querySelector<HTMLButtonElement>('.studio-purge-confirm')!);
  await until(() => !host.querySelector('.studio-artifact'));
  expect(calls.filter(call => call.name === 'artifact_manage').map(call => call.args.action)).toEqual(['trash', 'purge']);
});

it('explains an unsupported direct link and returns to the usable library without retrying the legacy read', async () => {
  await mount(legacy.id); await until(() => !!host.querySelector('[aria-label="不受支持的作品"]'));
  expect(host.textContent).toContain('旧版作品不受支持');
  expect(host.querySelector('[aria-label="白板画布"]')).toBeNull();
  await click(button('返回作品中心')); await until(() => !!host.querySelector('.studio-artifact'));
  expect(host.querySelector('h1')?.textContent).toBe('作品');
  expect(calls.filter(call => call.name === 'artifact_read')).toHaveLength(1);
});
