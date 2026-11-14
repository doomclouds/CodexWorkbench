import { expect, it } from 'vitest';
import { diffHistoryText, historyUnitText } from '../src/app/shared/editor-panels/history-diff';

it('keeps text and HTML readable, and includes properties when a change mixes content and geometry', () => {
  expect(historyUnitText({ id: 'a', before: null, after: { id: 'a', type: 'shape', text: '开始', x: 10, version: 1 } })).toEqual(['', '开始']);
  expect(historyUnitText({ id: 'html', before: { html: '<p>旧</p>', x: 0, version: 1 }, after: { html: '<p>新</p>', x: 0, version: 2 } })).toEqual(['<p>旧</p>', '<p>新</p>']);
  const mixed = historyUnitText({ id: 'a', before: { id: 'a', text: '旧', x: 0, version: 1 }, after: { id: 'a', text: '新', x: 10, version: 2 } });
  expect(mixed[0]).toContain('旧'); expect(mixed[1]).toContain('新'); expect(mixed[1]).toContain('"x": 10'); expect(mixed[1]).not.toContain('version'); expect(mixed[1]).not.toContain('"id"');
  const geometry = historyUnitText({ id: 'a', before: { text: '相同', x: 0 }, after: { text: '相同', x: 10 } });
  expect(geometry[0]).toContain('"x": 0'); expect(geometry[1]).toContain('"x": 10'); expect(geometry[1]).not.toContain('相同');
});

it('produces line additions/removals with bounded context and truthful counts', () => {
  const context = Array.from({ length: 50 }, (_, index) => `same-${index}`);
  const result = diffHistoryText([...context, '旧内容', ...context].join('\n'), [...context, '新内容', ...context].join('\n'));
  expect(result.added).toBe(1); expect(result.removed).toBe(1);
  expect(result.lines.filter(line => line.kind === '+').map(line => line.text)).toEqual(['新内容']);
  expect(result.lines.filter(line => line.kind === '-').map(line => line.text)).toEqual(['旧内容']);
  expect(result.lines.filter(line => line.kind === '~').map(line => line.text)).toEqual(['47', '47']);
  expect(diffHistoryText('', '开始').lines).toEqual([{ kind: '+', text: '开始' }]);
  expect(diffHistoryText('结束', '').lines).toEqual([{ kind: '-', text: '结束' }]);
});

it('reports oversized input instead of presenting an empty successful diff', () => {
  const result = diffHistoryText('', 'x'.repeat(1024 * 1024 + 1));
  expect(result.tooLarge).toBe(true); expect(result.lines).toEqual([]);
});
