import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ScrollRegion, TextArea } from '../../../src/ui/base/index.js';

const previewRows = [
  '缩放时保留输入焦点',
  '滚轮移动原生滚动区',
  'Ctrl + 滚轮缩放画布',
  '拖动标题移动对象',
  '移出视口后保留焦点中的内容',
  '重新定位到远端对象',
  '返回原对象后保留输入',
];

export function useFixtureContent(readOnly: boolean) {
  const [text, setText] = useState('这是用于测试原生输入归属的区域。');

  return useMemo<ReadonlyMap<string, ReactNode>>(
    () =>
      new Map([
        [
          'native',
          <div key="native" className="canvas-fixture-native">
            <TextArea
              label="原生文本框"
              value={text}
              onValueChange={setText}
              readOnly={readOnly}
              rows={2}
            />
            <ScrollRegion axis="vertical" label="原生滚动区" contain>
              <ul>
                {previewRows.map((row) => (
                  <li key={row}>{row}</li>
                ))}
              </ul>
            </ScrollRegion>
          </div>,
        ],
      ]),
    [readOnly, text],
  );
}
