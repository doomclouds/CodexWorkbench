import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Paper } from '../src/contracts/types';

const harness = vi.hoisted(() => ({ index: 0, states: [] as unknown[], rpc: vi.fn() }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [harness.states[index], (next: unknown) => { harness.states[index] = typeof next === 'function' ? next(harness.states[index]) : next; }];
  },
  useRef: (current: unknown) => ({ current }), useEffect() {},
}));
vi.mock('../src/app/api', () => ({ callTool: harness.rpc }));
vi.mock('../src/app/ui/AnchoredMenu', () => ({ AnchoredMenu: () => null }));
import { LibraryView } from '../src/app/library/LibraryWorkspace';
import { AnchoredMenu } from '../src/app/ui/AnchoredMenu';

const papers: Paper[] = [
  { id: 'one', path: 'papers/one', title: 'First paper', authors: ['First author'], year: 2024, tags: ['reading'], isRead: false },
  { id: 'two', path: 'papers/two', title: 'Second paper', authors: ['Second author'], year: 2025, tags: [], isRead: true },
];
const props = { active: true, vaultId: 'synthetic', vaultName: 'Synthetic vault', preview: false, refreshToken: 0, pdfParseAvailable: false, onOpen: vi.fn(), onOpenNote: vi.fn(), onOperation: vi.fn() };
function nodes(node: any): ReactElement<Record<string, any>>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
function find(tree: ReactElement, predicate: (node: ReactElement<Record<string, any>>) => boolean) { const node = nodes(tree).find(predicate); if (!node) throw new Error('Expected element missing'); return node; }
function render() { harness.index = 0; return LibraryView(props); }
function setup() { harness.states = [{ items: papers, total: 2 }]; return render(); }
function button(tree: ReactElement, label: string) { return find(tree, node => node.type === 'button' && node.props['aria-label'] === label); }
afterEach(() => { harness.index = 0; harness.states = []; vi.clearAllMocks(); });

describe('library list operations', () => {
  it('shows reading status and the target action independently from the row menu', async () => {
    const tree = setup();
    expect(find(tree, node => node.type === 'th' && node.props.className === 'read-column').props.children).toBe('阅读状态');
    const unread = button(tree, 'First paper：未读，标为已读');
    expect(unread.props.title).toBe('未读；点击标为已读');
    expect(nodes(unread).some(node => node.type === 'span' && node.props.children === '未读')).toBe(true);
    expect(button(tree, 'Second paper：已读，标为未读').props.title).toBe('已读；点击标为未读');
    harness.rpc.mockResolvedValue({}); unread.props.onClick();
    await vi.waitFor(() => expect(harness.rpc).toHaveBeenCalledWith('paper_update', { vaultId: 'synthetic', paperPath: 'papers/one', isRead: true }));
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('anchors one menu to the active trigger and closes it before an item action', () => {
    let tree = setup(); const first = {} as HTMLElement, second = {} as HTMLElement;
    expect(nodes(tree).some(node => node.type === 'details')).toBe(false);
    button(tree, '更多操作：First paper').props.onClick({ currentTarget: first }); tree = render();
    expect(find(tree, node => node.type === AnchoredMenu).props.anchor).toEqual({ element: first });
    expect(button(tree, '更多操作：First paper').props['aria-expanded']).toBe(true);
    button(tree, '更多操作：Second paper').props.onClick({ currentTarget: second }); tree = render();
    expect(nodes(tree).filter(node => node.type === AnchoredMenu)).toHaveLength(1);
    expect(find(tree, node => node.type === AnchoredMenu).props.anchor).toEqual({ element: second });
    expect(button(tree, '更多操作：First paper').props['aria-expanded']).toBe(false);
    find(tree, node => node.type === 'button' && node.props.role === 'menuitem' && node.props.children === '论文笔记').props.onClick();
    expect(props.onOpenNote).toHaveBeenCalledWith('papers/two/NOTES.md');
    expect(nodes(render()).some(node => node.type === AnchoredMenu)).toBe(false);
  });

  it('uses the same closeable menu for library actions and supports trigger toggling', () => {
    let tree = setup(); const trigger = {} as HTMLElement;
    button(tree, '文献库更多操作').props.onClick({ currentTarget: trigger }); tree = render();
    expect(find(tree, node => node.type === AnchoredMenu).props.ariaLabel).toBe('文献库操作');
    button(tree, '文献库更多操作').props.onClick({ currentTarget: trigger });
    expect(nodes(render()).some(node => node.type === AnchoredMenu)).toBe(false);
    tree = render(); button(tree, '更多操作：First paper').props.onClick({ currentTarget: trigger }); tree = render();
    find(tree, node => node.type === AnchoredMenu).props.onClose();
    expect(nodes(render()).some(node => node.type === AnchoredMenu)).toBe(false);
  });
});
