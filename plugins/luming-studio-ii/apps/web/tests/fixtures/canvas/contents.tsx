import { useMemo, useState, type ReactNode } from 'react';

import { Checkbox, ScrollRegion, TextArea } from '../../../src/ui/base/index.js';

const previewRows = [
  '检查滚动是否停留在原生内容内。',
  '拖动选中文字时，应保留文本选择。',
  '在文本框中输入并按方向键，检查光标移动。',
  '从这个区域移出后，用滚轮平移画布。',
  '按住 Ctrl 或 ⌘ 滚轮缩放画布。',
  '切换平移工具后，拖动原生内容可平移画布。',
  '切换只读后，检查移动与缩放手柄的限制。',
];

const htmlPreview =
  '<!doctype html><html lang="zh-CN"><meta name="color-scheme" content="light dark"><title>布局预览</title><body><h2>版式预览</h2><p>这个嵌入区用于检查内容与画布之间的指针切换。</p></body></html>';

const receiptRows = [
  { operation: '移动', expected: '版本与终点一致' },
  { operation: '缩放', expected: '正文继续挂载' },
  { operation: '放置', expected: '一次操作生成一个对象' },
  { operation: '连线', expected: '端点跟随目标' },
];

interface NativeContentProps {
  readonly readOnly: boolean;
  readonly text: string;
  readonly onTextChange: (text: string) => void;
}

function NativeContent({ readOnly, text, onTextChange }: NativeContentProps) {
  return (
    <div className="canvas-fixture-native">
      <TextArea
        label="原生文本框"
        value={text}
        onValueChange={onTextChange}
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
    </div>
  );
}

function ReceiptTable() {
  return (
    <ScrollRegion axis="both" label="验收记录表格" contain>
      <table className="canvas-fixture-table">
        <thead>
          <tr>
            <th scope="col">操作</th>
            <th scope="col">验收点</th>
          </tr>
        </thead>
        <tbody>
          {receiptRows.map(({ operation, expected }) => (
            <tr key={operation}>
              <th scope="row">{operation}</th>
              <td>{expected}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

export function useFixtureContent(readOnly: boolean) {
  const [text, setText] = useState('在这里输入文字或拖选文本。');
  const [documentText, setDocumentText] = useState('用拖动手柄改变文档容器尺寸。');
  const [reviewed, setReviewed] = useState(false);

  return useMemo(() => {
    const native = <NativeContent readOnly={readOnly} text={text} onTextChange={setText} />;
    const html = (
      <iframe
        title="HTML 内容预览"
        className="canvas-fixture-html"
        sandbox=""
        srcDoc={htmlPreview}
      />
    );
    const document = (
      <div className="canvas-fixture-native">
        <TextArea
          label="纪要正文"
          value={documentText}
          onValueChange={setDocumentText}
          readOnly={readOnly}
          rows={3}
        />
      </div>
    );
    const todo = (
      <div className="canvas-fixture-native">
        <Checkbox
          label="已复核交互"
          checked={reviewed}
          onCheckedChange={setReviewed}
          disabled={readOnly}
        />
      </div>
    );
    const table = <ReceiptTable />;

    return new Map<string, ReactNode>([
      ['native', native],
      ['html', html],
      ['document', document],
      ['todo', todo],
      ['table', table],
    ]);
  }, [readOnly, text, documentText, reviewed]);
}
